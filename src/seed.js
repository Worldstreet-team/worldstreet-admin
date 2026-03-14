import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import config from './config/index.js';
import User from './models/User.js';

const SEED_USERNAME = process.env.SEED_USERNAME || 'superadmin';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'changeme123';

async function seed() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('✅ MongoDB connected');

    const existing = await User.findOne({ username: SEED_USERNAME });
    if (existing) {
      console.log(`⚠️  User "${SEED_USERNAME}" already exists. Skipping seed.`);
      process.exit(0);
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, saltRounds);

    await User.create({
      username: SEED_USERNAME,
      passwordHash,
      role: 'superadmin',
    });

    console.log(`✅ Superadmin "${SEED_USERNAME}" created successfully.`);
    console.log('⚠️  Change the default password immediately!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
}

seed();
