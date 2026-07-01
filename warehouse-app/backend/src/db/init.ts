import dotenv from 'dotenv';
import { initializeDatabase } from './index';
import { seedDatabase } from './seed';

dotenv.config();

async function main(): Promise<void> {
  await initializeDatabase();
  await seedDatabase();
  console.log('Database initialized and seeded successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
