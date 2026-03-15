import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import config from '../config/index.js';
import ChainCursor from '../models/ChainCursor.js';
import DepositRequest from '../models/DepositRequest.js';
import Wallet from '../models/Wallet.js';
import { disburse } from './disbursementService.js';
import { TOKENS, DEPOSIT_STATUS } from '../utils/constants.js';

// ── Providers (reuse same pattern as balanceService) ────────
const evmProviders = {
  ethereum: new ethers.JsonRpcProvider(config.ethereumRpcUrl),
};

const solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

// ERC-20 Transfer event topic
const TRANSFER_EVENT_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Tokens to watch on each chain
const EVM_WATCH_TOKENS = ['USDC', 'USDT'];
const SOLANA_WATCH_TOKENS = ['USDC', 'USDT'];

// How far back to scan on first run (no existing cursor)
const EVM_INITIAL_LOOKBACK = 1000; // ~3-4 hours on Ethereum
const SOLANA_INITIAL_SIGNATURES = 100;

// ── Helpers ─────────────────────────────────────────────────

/**
 * Get or create a ChainCursor for a wallet.
 */
const getOrCreateCursor = async (wallet) => {
  let cursor = await ChainCursor.findOne({ walletId: wallet._id });
  if (!cursor) {
    cursor = await ChainCursor.create({
      walletId: wallet._id,
      chain: wallet.chain,
    });
  }
  return cursor;
};

/**
 * Compare two amounts at integer level (×10^decimals) to avoid float issues.
 */
const amountsMatch = (a, b, decimals) => {
  const intA = Math.round(parseFloat(a) * Math.pow(10, decimals));
  const intB = Math.round(parseFloat(b) * Math.pow(10, decimals));
  return intA === intB;
};

/**
 * Atomically match an on-chain transfer to a pending DepositRequest and disburse.
 */
const matchAndDisburse = async ({ fromAddress, amount, token, chain, treasuryWalletId, txHash }) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) return;

  // Normalize EVM addresses to checksummed form for comparison
  const normalizedFrom = chain !== 'solana'
    ? ethers.getAddress(fromAddress)
    : fromAddress;

  // Convert on-chain amount to human-readable
  const humanAmount = parseFloat(amount);

  // Find pending deposits that could match.
  // We query broadly and then filter by amount to avoid float comparison in Mongo.
  const candidates = await DepositRequest.find({
    status: DEPOSIT_STATUS.PENDING,
    depositChain: chain,
    depositToken: token,
    treasuryWalletId,
    expiresAt: { $gt: new Date() },
  });

  for (const candidate of candidates) {
    // EVM: case-insensitive address comparison via checksum normalization
    const candidateAddr = chain !== 'solana'
      ? ethers.getAddress(candidate.userWalletAddress)
      : candidate.userWalletAddress;

    if (candidateAddr !== normalizedFrom) continue;
    if (!amountsMatch(candidate.depositAmount, humanAmount, tokenInfo.decimals)) continue;

    // Atomic status transition: only succeeds if still pending (prevents double-processing)
    const updated = await DepositRequest.findOneAndUpdate(
      { _id: candidate._id, status: DEPOSIT_STATUS.PENDING },
      {
        $set: {
          status: DEPOSIT_STATUS.VERIFIED,
          depositTxHash: txHash,
          verifiedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Another poll cycle or admin already processed this deposit
      continue;
    }

    console.log(`[Watcher] Matched deposit ${updated._id} ← tx ${txHash} (${amount} ${token} on ${chain})`);

    // Trigger auto-disbursement
    try {
      const result = await disburse(updated._id);
      console.log(`[Watcher] Disbursed ${updated._id} → tx ${result.tx.txHash}`);
    } catch (err) {
      console.error(`[Watcher] Disbursement failed for ${updated._id}:`, err.message);
      // deposit status is already set to 'failed' by disburse() on error
    }

    // One deposit per tx hash — break after match
    return;
  }

  // No match — this transfer doesn't correspond to any pending deposit
  console.log(`[Watcher] No match for ${amount} ${token} from ${fromAddress} on ${chain} (tx: ${txHash})`);
};

// ── Ethereum Polling ────────────────────────────────────────

export const pollEthereum = async () => {
  const receiveWallets = await Wallet.find({
    chain: 'ethereum',
    purpose: 'receive',
    isActive: true,
  });

  if (receiveWallets.length === 0) return;

  const provider = evmProviders.ethereum;
  const currentBlock = await provider.getBlockNumber();
  const safeBlock = currentBlock - config.requiredConfirmationsEth;

  for (const wallet of receiveWallets) {
    const cursor = await getOrCreateCursor(wallet);
    const fromBlock = cursor.lastBlock != null
      ? cursor.lastBlock + 1
      : Math.max(0, safeBlock - EVM_INITIAL_LOOKBACK);

    if (fromBlock > safeBlock) continue;

    // Pad the wallet address to 32 bytes for the indexed `to` parameter
    const paddedAddress = ethers.zeroPadValue(wallet.address, 32);

    for (const token of EVM_WATCH_TOKENS) {
      const contractAddress = TOKENS[token]?.ethereum;
      if (!contractAddress) continue;

      try {
        const logs = await provider.getLogs({
          address: contractAddress,
          topics: [
            TRANSFER_EVENT_TOPIC,
            null,           // from (any sender)
            paddedAddress,  // to (our receive wallet)
          ],
          fromBlock,
          toBlock: safeBlock,
        });

        for (const log of logs) {
          const from = ethers.getAddress('0x' + log.topics[1].slice(26));
          const rawAmount = BigInt(log.data);
          const humanAmount = ethers.formatUnits(rawAmount, TOKENS[token].decimals);

          await matchAndDisburse({
            fromAddress: from,
            amount: humanAmount,
            token,
            chain: 'ethereum',
            treasuryWalletId: wallet._id,
            txHash: log.transactionHash,
          });
        }
      } catch (err) {
        console.error(`[Watcher] Error polling ETH logs for ${token}:`, err.message);
      }
    }

    // Update cursor to the safe block we just scanned through
    cursor.lastBlock = safeBlock;
    await cursor.save();
  }

  console.log(`[Watcher] ETH poll complete — scanned up to block ${safeBlock}`);
};

// ── Solana Polling ──────────────────────────────────────────

export const pollSolana = async () => {
  const receiveWallets = await Wallet.find({
    chain: 'solana',
    purpose: 'receive',
    isActive: true,
  });

  if (receiveWallets.length === 0) return;

  for (const wallet of receiveWallets) {
    const cursor = await getOrCreateCursor(wallet);
    const walletPubkey = new PublicKey(wallet.address);

    for (const token of SOLANA_WATCH_TOKENS) {
      const mintAddress = TOKENS[token]?.solana;
      if (!mintAddress) continue;

      const mintPubkey = new PublicKey(mintAddress);

      try {
        // Derive the ATA for this wallet + token mint
        const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);

        // Fetch recent signatures for this ATA
        const sigOptions = { limit: SOLANA_INITIAL_SIGNATURES };
        if (cursor.lastSignature) {
          sigOptions.until = cursor.lastSignature;
        }

        const signatures = await solanaConnection.getSignaturesForAddress(ata, sigOptions);

        if (signatures.length === 0) continue;

        // Process oldest-first
        const ordered = [...signatures].reverse();

        for (const sigInfo of ordered) {
          if (sigInfo.err) continue; // skip failed txs

          let parsed;
          try {
            parsed = await solanaConnection.getParsedTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            });
          } catch {
            continue;
          }

          if (!parsed?.meta || parsed.meta.err) continue;

          // Look for SPL token transfers to our ATA
          const innerInstructions = parsed.meta.innerInstructions || [];
          const allInstructions = [
            ...(parsed.transaction.message.instructions || []),
            ...innerInstructions.flatMap((ii) => ii.instructions || []),
          ];

          for (const ix of allInstructions) {
            if (ix.parsed?.type !== 'transfer' && ix.parsed?.type !== 'transferChecked') continue;
            if (ix.program !== 'spl-token') continue;

            const info = ix.parsed.info;
            const destination = info.destination || info.account;

            // Check this transfer is to our ATA
            if (destination !== ata.toBase58()) continue;

            // Extract amount
            const rawAmount = info.tokenAmount
              ? parseFloat(info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount)
              : parseFloat(info.amount) / Math.pow(10, TOKENS[token].decimals);

            // Resolve sender: the 'source' is a token account, we need its owner
            const source = info.source || info.authority;

            // Try to find the owner from pre/post token balances
            let senderOwner = info.authority; // authority is the signer/owner for simple transfers
            if (!senderOwner) {
              const preBalances = parsed.meta.preTokenBalances || [];
              const sourceBalance = preBalances.find(
                (b) => b.mint === mintAddress && b.owner && b.uiTokenAmount,
              );
              if (sourceBalance) senderOwner = sourceBalance.owner;
            }

            if (!senderOwner || rawAmount <= 0) continue;

            await matchAndDisburse({
              fromAddress: senderOwner,
              amount: rawAmount,
              token,
              chain: 'solana',
              treasuryWalletId: wallet._id,
              txHash: sigInfo.signature,
            });
          }
        }

        // Update cursor with the newest signature (first element — newest)
        cursor.lastSignature = signatures[0].signature;
      } catch (err) {
        console.error(`[Watcher] Error polling SOL signatures for ${token}:`, err.message);
      }
    }

    await cursor.save();
  }

  console.log('[Watcher] SOL poll complete');
};
