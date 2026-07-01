import dotenv from 'dotenv';
import { initializeDatabase } from './index';
import { seedDatabase } from './seed';

dotenv.config();

initializeDatabase();
seedDatabase();
console.log('Database initialized and seeded successfully.');
