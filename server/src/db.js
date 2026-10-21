import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv'; dotenv.config();
const ssl=process.env.DB_CA_PATH?{ca:fs.readFileSync(path.resolve(process.env.DB_CA_PATH)),rejectUnauthorized:true}:undefined;
export const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'insight_mcsitobes',ssl,waitForConnections:true,connectionLimit:10,dateStrings:true});
