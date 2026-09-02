import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const file = process.argv[2];
if (!file) throw new Error('Migration file path is required.');

const sql = await fs.readFile(file, 'utf8');
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true
});

try {
  await connection.query(sql);
  console.log(`Applied migration: ${file}`);
} finally {
  await connection.end();
}
