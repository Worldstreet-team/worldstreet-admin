import { PrivyClient } from '@privy-io/node';
import config from './index.js';

const privy = new PrivyClient({
  appId: config.privyAppId,
  appSecret: config.privyAppSecret,
});

export const authorizationPrivateKey = config.privyAuthorizationPrivateKey;

export default privy;
