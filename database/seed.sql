USE insight_mcsitobes;
SET FOREIGN_KEY_CHECKS=0;
TRUNCATE TABLE company_shareholders; TRUNCATE TABLE products; TRUNCATE TABLE finance_transactions; TRUNCATE TABLE bank_accounts; TRUNCATE TABLE reminders; TRUNCATE TABLE offices; TRUNCATE TABLE payroll; TRUNCATE TABLE employees; TRUNCATE TABLE assets; TRUNCATE TABLE domains; TRUNCATE TABLE email_accounts; TRUNCATE TABLE social_accounts; TRUNCATE TABLE credentials; TRUNCATE TABLE documents; TRUNCATE TABLE people; TRUNCATE TABLE user_company_access; TRUNCATE TABLE audit_logs; TRUNCATE TABLE companies;
SET FOREIGN_KEY_CHECKS=1;

INSERT INTO companies (id,name,legal_name,company_type,industry,is_parent,parent_company_id,sanleo_share,country,currency,status) VALUES
(1,'Sanleo Capital','Sanleo Capital','Holding Company','Investment & Group Management',1,NULL,100,'India','INR','active'),
(2,'MCSITOBES Technologies','MCSITOBES Technologies','Subsidiary / Partner Company','Technology & Software',0,1,60,'India','INR','active'),
(3,'Sqotin Private Limited','Sqotin Private Limited','Subsidiary / Partner Company','Clothing & Apparel',0,1,80,'India','INR','active'),
(4,'Servia Travels','Servia Travels','Subsidiary / Partner Company','Travel & Tourism',0,1,80,'India','INR','active'),
(5,'Tofado Private Limited','Tofado Private Limited','Joint Venture','Web ERP & Business Software',0,1,50,'India','INR','active'),
(6,'Gharse','Gharse','Joint Venture / App','Homely Food Delivery',0,1,50,'India','INR','active');

INSERT INTO company_shareholders(company_id,shareholder_name,shareholder_type,share_percent) VALUES
(2,'Sanleo Capital','Company',60),(2,'Sanal','Individual',40),
(3,'Sanleo Capital','Company',80),(3,'Murshid','Individual',10),(3,'Afsal','Individual',10),
(4,'Sanleo Capital','Company',80),(4,'Afsal','Individual',20),
(5,'Sanleo Capital','Company',50),(5,'Jothish','Individual',50),
(6,'Sanleo Capital','Company',50),(6,'Dr. Anees','Individual',50);

INSERT INTO people(name,position,primary_company_id) VALUES
('Sanal','Shareholder',2),('Murshid','Shareholder',3),('Afsal','Partner / Shareholder',4),('Jothish','Partner / Shareholder',5),('Dr. Anees','Partner / Shareholder',6);

INSERT INTO products(company_id,name,category,description,status) VALUES
(2,'Daysiz','Project Management Software','Project and work management platform.','Active'),
(2,'Hospital Management Software','Healthcare Software','Hospital and employee health management platform.','Active'),
(2,'Insight360','Business Management Software','Internal business and operational management platform.','Active'),
(5,'Tofado ERP','Web ERP','Web-based ERP and business management product.','Active'),
(6,'Gharse App','Food Delivery','Homely food delivery marketplace application.','Active');

INSERT INTO finance_transactions(company_id,date,type,category,description,amount) VALUES
(2,'2026-08-01','expense','Software','Cloud and software subscriptions',18500),(2,'2026-08-05','income','Services','Software services income',125000),(3,'2026-08-03','expense','Inventory','Clothing inventory purchase',76000),(4,'2026-08-04','income','Travel','Travel booking revenue',98000),(5,'2026-08-06','expense','Hosting','ERP infrastructure',22000),(6,'2026-08-07','expense','Development','Application development',35000);

INSERT INTO reminders(company_id,title,category,due_date,priority,status) VALUES
(2,'MCSITOBES monthly salary','HR','2026-08-15','High','pending'),(4,'Servia office rent','Office Rent','2026-08-19','High','pending'),(5,'tofado.com domain review','Domain','2026-08-24','Medium','pending'),(3,'Sqotin license renewal check','Compliance','2026-09-02','High','pending'),(6,'Gharse monthly operating review','Operations','2026-09-05','Medium','pending');

INSERT INTO offices(company_id,name,city,monthly_rent,rent_due_day,lease_start,lease_end) VALUES
(2,'MCSITOBES Main Office','Calicut',45000,5,'2026-01-01','2027-01-01'),(4,'Servia Travels Office','Calicut',30000,5,'2026-01-01','2026-12-31');

INSERT INTO employees(company_id,employee_code,name,designation,joining_date,salary,email) VALUES
(2,'MCS-001','Sample Employee','Software Engineer','2026-01-10',45000,'employee@mcsitobes.local'),(4,'SER-001','Sample Travel Executive','Travel Executive','2026-02-01',30000,'executive@servia.local');
INSERT INTO payroll(employee_id,month,gross_salary,deduction,net_salary,status) VALUES (1,'2026-08',45000,0,45000,'Pending'),(2,'2026-08',30000,0,30000,'Pending');

INSERT INTO assets(company_id,asset_code,name,category,assigned_to,status) VALUES
(2,'MCS-IT-001','Dell Business Laptop','Laptop','Sample Employee','Assigned'),(4,'SER-IT-001','Office Desktop','Desktop','Front Office','Assigned');
INSERT INTO domains(company_id,domain,registrar,expiry_date,auto_renew,status) VALUES
(2,'mcsitobes.com','Registrar','2027-04-10',1,'Active'),(5,'tofado.com','Registrar','2027-01-17',1,'Active'),(4,'serviago.com','Registrar','2027-04-04',1,'Active');
INSERT INTO email_accounts(company_id,email,provider,assigned_to,status) VALUES
(2,'info@mcsitobes.com','Google Workspace','General','Active'),(4,'contact@serviago.com','Google Workspace','General','Active');
INSERT INTO social_accounts(company_id,platform,username,manager,status) VALUES
(2,'LinkedIn','MCSITOBES','Marketing','Active'),(4,'Instagram','servia.go','Marketing','Active');
INSERT INTO credentials(company_id,service_name,username,url,twofa_owner,encrypted_secret) VALUES
(2,'AWS','admin','https://aws.amazon.com','IT Admin','ENCRYPT_ON_SERVER'),(5,'GitHub','tofado-team','https://github.com','IT Admin','ENCRYPT_ON_SERVER');
INSERT INTO documents(company_id,name,category,expiry_date,confidential) VALUES
(2,'Company Registration Certificate.pdf','Corporate',NULL,1),(4,'Office Lease Agreement.pdf','Office','2026-12-31',1);
