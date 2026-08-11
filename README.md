# Insight MCSITOBES

Internal multi-company management ERP for Sanleo Capital and its group companies.

## Included companies
- Sanleo Capital — parent holding company
- MCSITOBES Technologies — Sanleo Capital 60%, Sanal 40%
- Sqotin Private Limited — Sanleo Capital 80%, Murshid 10%, Afsal 10%
- Servia Travels — Sanleo Capital 80%, Afsal 20%
- Tofado Private Limited — Sanleo Capital 50%, Jothish 50%
- Gharse — Sanleo Capital 50%, Dr. Anees 50%

MCSITOBES products seeded: Daysiz, Hospital Management Software, Insight360.

**Base currency: INR (₹).**

## Stack
- React + Vite
- Node.js + Express
- MySQL
- JWT authentication
- Responsive internal ERP interface

## Main modules
Dashboard, Companies & Ownership, Key People, Products, Finance, Bank Accounts, Employees, Payroll, Reminders, Offices/Rent, Assets, Domains, Email Accounts, Social Media, Credentials Vault, Files, Users/Access, Audit Log, Settings.

## Local setup

### 1. MySQL
Run:
```sql
SOURCE database/schema.sql;
SOURCE database/seed.sql;
```
Or import both files using MySQL Workbench / phpMyAdmin.

### 2. Backend
```bash
cd server
cp .env.example .env
npm install
npm run seed
npm run dev
```
Default API: `http://localhost:5000`

### 3. Frontend
Open another terminal:
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
Open `http://localhost:5173`

### Starter login
- Email: `admin@insight.local`
- Password: `Admin@123`

Change this password before deployment.

## Production notes
Before production, add a strong `JWT_SECRET`, HTTPS, database backups, encrypted credential storage (KMS or application-level AES-GCM), S3 private file storage with signed URLs, 2FA, full RBAC enforcement, rate limiting and secure secret management.

## Architecture
Nearly every operational record belongs to a `company_id`, allowing each group company to have isolated data while Sanleo group administrators can access consolidated views. `user_company_access` is included for company-level login/access control expansion.
