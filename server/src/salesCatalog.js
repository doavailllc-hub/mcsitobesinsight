const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };

export async function ensureSalesCatalog(q) {
  await q(`CREATE TABLE IF NOT EXISTS sales_categories (
    id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, name VARCHAR(180) NOT NULL,
    UNIQUE KEY uq_sales_category(company_id,name), FOREIGN KEY(company_id) REFERENCES companies(id))`);
  await q(`CREATE TABLE IF NOT EXISTS sales_people (
    id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, name VARCHAR(180) NOT NULL,
    phone VARCHAR(40), email VARCHAR(180), UNIQUE KEY uq_sales_person(company_id,name),
    FOREIGN KEY(company_id) REFERENCES companies(id))`);
  await q(`CREATE TABLE IF NOT EXISTS sales_catalog_items (
    id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, category_id INT NULL,
    name VARCHAR(180) NOT NULL, description TEXT, unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0, UNIQUE KEY uq_sales_item(company_id,name),
    FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(category_id) REFERENCES sales_categories(id))`);
  await q(`CREATE TABLE IF NOT EXISTS sales_invoice_people (
    invoice_id INT PRIMARY KEY, salesperson_id INT NOT NULL, salesperson_name VARCHAR(180) NOT NULL,
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(salesperson_id) REFERENCES sales_people(id))`);
}

export async function validateSalesperson(q, companyId, value) {
  if (value == null || value === '') return null;
  const [person] = await q('SELECT id,name FROM sales_people WHERE id=? AND company_id=?', [value, companyId]);
  if (!person) fail('Select a salesperson belonging to this company.');
  return person;
}

export async function saveInvoiceSalesperson(conn, invoiceId, person) {
  if (person) {
    await conn.query(`INSERT INTO sales_invoice_people(invoice_id,salesperson_id,salesperson_name)
      VALUES (?,?,?) ON DUPLICATE KEY UPDATE salesperson_id=VALUES(salesperson_id),salesperson_name=VALUES(salesperson_name)`,
    [invoiceId, person.id, person.name]);
  } else {
    await conn.query('DELETE FROM sales_invoice_people WHERE invoice_id=?', [invoiceId]);
  }
}

export function registerSalesCatalog(app, { q, safe, requireSalesPermission, hasEffectivePermission, companyIdsFromAccess, audit }) {
  const checkCompany = (req, id, permission) => {
    if (!Number.isInteger(id) || id <= 0) fail('Select a company.');
    if (!hasEffectivePermission(req.access, permission, id)) {
      const error = new Error('You do not have sales access to this company.'); error.statusCode = 403; throw error;
    }
  };
  app.get('/api/sales-catalog/companies', requireSalesPermission('finance.view'), safe(async (req,res) => {
    const rows = await q("SELECT id,name,currency FROM companies WHERE status='active' ORDER BY name");
    const ids = companyIdsFromAccess(req.access);
    res.json(rows.filter(row => req.access.globalRole === 'group_admin' || (ids.includes(Number(row.id)) && hasEffectivePermission(req.access,'finance.view',row.id))));
  }));
  app.get('/api/sales-catalog', requireSalesPermission('finance.view'), safe(async (req,res) => {
    const id = Number(req.query.company_id); checkCompany(req,id,'finance.view');
    const [categories, people, items] = await Promise.all([
      q('SELECT * FROM sales_categories WHERE company_id=? ORDER BY name',[id]),
      q('SELECT * FROM sales_people WHERE company_id=? ORDER BY name',[id]),
      q(`SELECT i.*,c.name category_name FROM sales_catalog_items i LEFT JOIN sales_categories c ON c.id=i.category_id WHERE i.company_id=? ORDER BY i.name`,[id])
    ]);
    res.json({ categories, people, items });
  }));
  for (const [kind, table] of Object.entries({ categories: 'sales_categories', people: 'sales_people', items: 'sales_catalog_items' })) {
    for (const editing of [false,true]) {
      app[editing ? 'put' : 'post'](`/api/sales-catalog/${kind}${editing ? '/:id' : ''}`, requireSalesPermission(editing ? 'finance.edit' : 'finance.create'), safe(async (req,res) => {
        const companyId = Number(req.body.company_id);
        checkCompany(req,companyId,editing ? 'finance.edit' : 'finance.create');
        const name = String(req.body.name || '').trim();
        if (!name || name.length > 180) fail('Name is required and must be at most 180 characters.');
        let fields = ['name']; let values = [name];
        if (kind === 'people') {
          const phone = String(req.body.phone || '').trim(), email = String(req.body.email || '').trim();
          if (phone.length > 40 || email.length > 180 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail('Enter valid contact details.');
          fields.push('phone','email'); values.push(phone,email);
        }
        if (kind === 'items') {
          const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
          if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) fail('Select a valid category.');
          if (categoryId && !(await q('SELECT id FROM sales_categories WHERE id=? AND company_id=?',[categoryId,companyId])).length) fail('Select a category belonging to this company.');
          const price = Number(req.body.unit_price), tax = Number(req.body.tax_rate ?? 0);
          if (!Number.isFinite(price) || price < 0 || price > 9999999999999.99 || !Number.isFinite(tax) || tax < 0 || tax > 100) fail('Enter a valid price and tax rate between 0 and 100.');
          fields.push('category_id','description','unit_price','tax_rate');
          values.push(categoryId,String(req.body.description || '').trim(),price,tax);
        }
        if (editing && !(await q(`SELECT id FROM ${table} WHERE id=? AND company_id=?`,[req.params.id,companyId])).length) return res.status(404).json({message:'Record not found.'});
        try {
          const result = editing
            ? await q(`UPDATE ${table} SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=? AND company_id=?`,[...values,req.params.id,companyId])
            : await q(`INSERT INTO ${table}(company_id,${fields.join(',')}) VALUES (${[companyId,...values].map(() => '?').join(',')})`,[companyId,...values]);
          await audit(req,editing ? 'Updated sales catalog' : 'Created sales catalog entry',table,name);
          res.status(editing ? 200 : 201).json({id:editing ? Number(req.params.id) : result.insertId});
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({message:'This name already exists for the selected company.'});
          throw error;
        }
      }));
    }
  }
}
