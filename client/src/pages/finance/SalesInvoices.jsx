import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Send,
  Ban,
  X,
  Trash2,
  Download
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, getPermissions, getUser } from '../../lib/api';
import SalesCatalog from './SalesCatalog';
import './sales.css';
import { downloadSalesInvoicePdf } from './invoicePdf';

const money = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const emptyItem = {
  item_name: '',
  description: '',
  quantity: 1,
  unit_price: '',
  tax_rate: 0
};

const emptyForm = {
  company_id: '',
  salesperson_id: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  customer_address: '',
  invoice_date: '',
  due_date: '',
  currency: 'INR',
  discount_amount: 0,
  notes: '',
  terms: '',
  items: [{ ...emptyItem }]
};

export default function SalesInvoices({ frontdesk = false, defaultCompanyId = null, onView } = {}) {
  const [tab, setTab] = useState('invoices');
  const [catalog, setCatalog] = useState({items:[],categories:[],people:[]});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const user = getUser();
  const permissions = new Set(getPermissions());
  const isGroupAdmin = user?.role === 'group_admin';
  const isFrontdesk = frontdesk && user?.role === 'frontdesk';
  const canCreate = isGroupAdmin || isFrontdesk || permissions.has('finance.create');
  const canEdit = isGroupAdmin || isFrontdesk || permissions.has('finance.edit');

  const load = async () => {
    try {
      setError('');
      const response = await api.get('/sales-invoices');
      setRows(response.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load sales invoices.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let active = true;
    setCatalog({items:[],categories:[],people:[]});
    if (!open || !form.company_id) return;
    setCatalogLoading(true);
    api.get('/sales-catalog',{params:{company_id:form.company_id}}).then(({data}) => {if(active) setCatalog(data);})
      .catch(err => {if(active) setError(err.response?.data?.message || 'Unable to load items and salespeople.');})
      .finally(() => {if(active) setCatalogLoading(false);});
    return () => {active=false;};
  },[open,form.company_id]);

  const filtered = useMemo(() => {
    return rows.filter(row => {
      const rowStatus = row.display_status || row.status;
      const matchesStatus =
        status === 'all' || rowStatus === status;

      const haystack = JSON.stringify(row).toLowerCase();
      const matchesSearch =
        haystack.includes(query.toLowerCase());

      return matchesStatus && matchesSearch;
    });
  }, [rows, query, status]);

  const openCreate = async () => {
    setError('');
    try {
      const response = await api.get('/sales-catalog/companies');
      setCompanies(response.data || []);
      setEditingId(null);
      setForm({
        ...emptyForm,
        company_id: response.data?.some(company => Number(company.id) === Number(defaultCompanyId)) ? defaultCompanyId : '',
        currency: response.data?.find(company => Number(company.id) === Number(defaultCompanyId))?.currency || 'INR',
        invoice_date: new Date().toLocaleDateString('en-CA'),
        items: [{ ...emptyItem }]
      });
      setOpen(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Unable to load company options.'
      );
    }
  };

  const openEdit = async row => {
    if (row.status !== 'draft') return;

    setError('');
    try {
      const [companyResponse, detailResponse] =
        await Promise.all([
          api.get('/sales-catalog/companies'),
          api.get(`/sales-invoices/${row.id}`)
        ]);

      setCompanies(companyResponse.data || []);

      const detail = detailResponse.data || {};
      const invoice = detail.invoice || {};

      setForm({
        salesperson_id: invoice.salesperson_id || '',
        company_id: invoice.company_id || '',
        customer_name: invoice.customer_name || '',
        customer_email: invoice.customer_email || '',
        customer_phone: invoice.customer_phone || '',
        customer_address: invoice.customer_address || '',
        invoice_date: invoice.invoice_date || '',
        due_date: invoice.due_date || '',
        currency: invoice.currency || 'INR',
        discount_amount: invoice.discount_amount || 0,
        notes: invoice.notes || '',
        terms: invoice.terms || '',
        items:
          detail.items?.length
            ? detail.items.map(item => ({
                item_name: item.item_name || '',
                description: item.description || '',
                quantity: item.quantity || 1,
                unit_price: item.unit_price || '',
                tax_rate: item.tax_rate || 0
              }))
            : [{ ...emptyItem }]
      });

      setEditingId(row.id);
      setOpen(true);
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        'Unable to load invoice.'
      );
    }
  };

  const setItem = (index, key, value) => {
    setForm(current => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index
          ? { ...item, [key]: value }
          : item
      )
    }));
  };

  const addItem = () => {
    setForm(current => ({
      ...current,
      items: [
        ...current.items,
        { ...emptyItem }
      ]
    }));
  };

  const removeItem = index => {
    setForm(current => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, i) => i !== index)
    }));
  };

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((sum, item) => {
      return (
        sum +
        Number(item.quantity || 0) *
          Number(item.unit_price || 0)
      );
    }, 0);

    const tax = form.items.reduce((sum, item) => {
      const line =
        Number(item.quantity || 0) *
        Number(item.unit_price || 0);

      return (
        sum +
        line *
          (Number(item.tax_rate || 0) / 100)
      );
    }, 0);

    const discount =
      Number(form.discount_amount || 0);

    return {
      subtotal,
      tax,
      total: Math.max(
        0,
        subtotal + tax - discount
      )
    };
  }, [form]);

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (editingId) {
        await api.put(
          `/sales-invoices/${editingId}`,
          form
        );
      } else {
        await api.post(
          '/sales-invoices',
          form
        );
      }

      setOpen(false);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.detail ||
        'Unable to save invoice.'
      );
    } finally {
      setSaving(false);
    }
  };

  const issue = async row => {
    if (
      !window.confirm(
        `Issue invoice ${row.invoice_number}?`
      )
    ) {
      return;
    }

    try {
      await api.put(
        `/sales-invoices/${row.id}/issue`
      );
      await load();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        'Unable to issue invoice.'
      );
    }
  };

  const cancel = async row => {
    if (
      !window.confirm(
        `Cancel invoice ${row.invoice_number}?`
      )
    ) {
      return;
    }

    try {
      await api.put(
        `/sales-invoices/${row.id}/cancel`
      );
      await load();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        'Unable to cancel invoice.'
      );
    }
  };

  const downloadInvoice = async row => {
    try {
      const response = await api.get(
        `/sales-invoices/${row.id}`
      );

      await downloadSalesInvoicePdf(
        response.data
      );
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        'Unable to download invoice.'
      );
    }
  };


  return (
    <div className="sales-workspace">
      <nav className="sales-tabs" aria-label="Sales sections">{[['invoices','Invoices'],['items','Items'],['categories','Categories'],['people','Salespeople']].map(([key,label]) => <button key={key} className={tab===key?'active':''} onClick={() => {setTab(key);setError('');}}>{label}</button>)}</nav>
      {tab !== 'invoices' ? <SalesCatalog key={tab} kind={tab} defaultCompanyId={defaultCompanyId} canCreate={canCreate} canEdit={canEdit}/> : <>
      {error && !open && <div role="alert" className="error">{error}</div>}
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="Search invoice, customer or company"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="finance-filter">
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partially_paid">
              Partially paid
            </option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">
              Cancelled
            </option>
          </select>

          {canCreate && (
            <button
              className="primary-btn"
              onClick={openCreate}
            >
              <Plus size={16} />
              New invoice
            </button>
          )}
        </div>
      </div>

      <section
        className="finance-card"
        style={{
          padding: 0,
          overflow: 'hidden'
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="finance-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Company</th>
                <th>Customer</th>
                <th>Invoice date</th>
                <th>Due date</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => {
                const displayStatus =
                  row.display_status ||
                  row.status ||
                  'draft';

                return (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.invoice_number}
                      </strong>
                    </td>

                    <td>
                      {row.company_name || '—'}
                    </td>

                    <td>
                      {row.customer_name || '—'}
                    </td>

                    <td>
                      {row.invoice_date || '—'}
                    </td>

                    <td>
                      {row.due_date || '—'}
                    </td>

                    <td className="finance-money">
                      {money(
                        row.total_amount,
                        row.currency
                      )}
                    </td>

                    <td className="finance-money">
                      {money(
                        row.balance_amount,
                        row.currency
                      )}
                    </td>

                    <td>
                      <span
                        className={`finance-badge ${displayStatus}`}
                      >
                        {displayStatus.replaceAll(
                          '_',
                          ' '
                        )}
                      </span>
                    </td>

                    <td>
                      <div className="finance-actions">
                        {onView ? <button className="finance-icon-btn" title="View invoice" onClick={() => onView(row.id)}><Eye size={15} /></button> : <Link
                          to={`/finance/invoices/${row.id}`}
                          className="finance-icon-btn"
                          title="View invoice"
                        >
                          <Eye size={15} />
                        </Link>}

                        <button
                          type="button"
                          className="finance-icon-btn"
                          title="Download PDF"
                          onClick={() =>
                            downloadInvoice(row)
                          }
                        >
                          <Download size={15} />
                        </button>

                        {canEdit &&
                          row.status === 'draft' && (
                            <button
                              className="finance-icon-btn"
                              title="Edit draft"
                              onClick={() =>
                                openEdit(row)
                              }
                            >
                              <Pencil size={15} />
                            </button>
                          )}

                        {canEdit &&
                          row.status === 'draft' && (
                            <button
                              className="finance-icon-btn"
                              title="Issue invoice"
                              onClick={() =>
                                issue(row)
                              }
                            >
                              <Send size={15} />
                            </button>
                          )}

                        {canEdit &&
                          ![
                            'paid',
                            'cancelled'
                          ].includes(
                            row.status
                          ) &&
                          Number(
                            row.paid_amount || 0
                          ) === 0 && (
                            <button
                              className="finance-icon-btn danger"
                              title="Cancel invoice"
                              onClick={() =>
                                cancel(row)
                              }
                            >
                              <Ban size={15} />
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!filtered.length && (
            <div className="finance-empty">
              No invoices found.
            </div>
          )}
        </div>
      </section>

      {open && (
        <div
          className="finance-modal-backdrop sales-modal-backdrop"
          onMouseDown={e =>
            e.target === e.currentTarget &&
            !saving &&
            setOpen(false)
          }
        >
          <form
            className="finance-modal invoice-modal"
            role="dialog" aria-modal="true" aria-label={editingId ? 'Edit draft invoice' : 'New sales invoice'}
            onSubmit={save}
          >
            <div className="invoice-modal-head">
              <div>
                <p className="eyebrow">
                  SALES INVOICE
                </p>
                <h2>
                  {editingId
                    ? 'Edit draft invoice'
                    : 'New sales invoice'}
                </h2>
              </div>

              <button
                type="button"
                className="finance-icon-btn"
                onClick={() => setOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            {error && (
              <div className="finance-error">
                {error}
              </div>
            )}

            <div className="invoice-form-grid">
              <Field label="Company *">
                <select
                  required
                  value={form.company_id}
                  onChange={e =>
                    setForm({
                      ...form,
                      company_id: e.target.value,
                      salesperson_id: '',
                      items: [{...emptyItem}],
                      currency: companies.find(company => String(company.id) === e.target.value)?.currency || 'INR'
                    })
                  }
                  disabled={Boolean(editingId)}
                >
                  <option value="">
                    Select company
                  </option>
                  {companies.map(company => (
                    <option
                      key={company.id}
                      value={company.id}
                    >
                      {company.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Salesperson">
                <select value={form.salesperson_id || ''} disabled={!form.company_id || catalogLoading} onChange={e => setForm({...form,salesperson_id:e.target.value})}>
                  <option value="">{catalogLoading ? 'Loading?' : 'No salesperson assigned'}</option>
                  {catalog.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Customer name *">
                <input
                  required
                  value={form.customer_name}
                  onChange={e =>
                    setForm({
                      ...form,
                      customer_name:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Customer email">
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={e =>
                    setForm({
                      ...form,
                      customer_email:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Customer phone">
                <input
                  value={form.customer_phone}
                  onChange={e =>
                    setForm({
                      ...form,
                      customer_phone:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Invoice date *">
                <input
                  required
                  type="date"
                  value={form.invoice_date}
                  onChange={e =>
                    setForm({
                      ...form,
                      invoice_date:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Due date">
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e =>
                    setForm({
                      ...form,
                      due_date:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Currency">
                <select
                  value={form.currency}
                  onChange={e =>
                    setForm({
                      ...form,
                      currency:
                        e.target.value
                    })
                  }
                >
                  <option value="INR">
                    INR
                  </option>
                  <option value="SAR">
                    SAR
                  </option>
                  <option value="AED">
                    AED
                  </option>
                  <option value="USD">
                    USD
                  </option>
                </select>
              </Field>

              <Field label="Discount amount">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.discount_amount
                  }
                  onChange={e =>
                    setForm({
                      ...form,
                      discount_amount:
                        e.target.value
                    })
                  }
                />
              </Field>

              <div
                style={{
                  gridColumn: '1 / -1'
                }}
              >
                <Field label="Customer address">
                  <textarea
                    value={
                      form.customer_address
                    }
                    onChange={e =>
                      setForm({
                        ...form,
                        customer_address:
                          e.target.value
                      })
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="invoice-items-head">
              <div>
                <strong>Invoice items</strong>
                <span>
                  Add services or products
                  being billed.
                </span>
              </div>

              <button
                type="button"
                className="secondary-btn"
                onClick={addItem}
              >
                <Plus size={15} />
                Add item
              </button>
            </div>

            <div className="invoice-items">
              {form.items.map((item,index) => {
                const line = Number(item.quantity || 0)*Number(item.unit_price || 0)*(1+Number(item.tax_rate || 0)/100);
                return <div className="sales-item-row" key={index}>
                  <label className="invoice-field sales-category-picker"><span>Category filter</span><select value={item.category_id || ''} onChange={e => setForm(current => ({...current,items:current.items.map((row,i) => i===index ? {...row,category_id:e.target.value,catalog_id:''} : row)}))}><option value="">All categories</option>{catalog.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="invoice-field sales-item-picker"><span>Saved item / service</span><select disabled={!form.company_id || catalogLoading} value={item.catalog_id || ''} onChange={e => {
                    const selected=catalog.items.find(row => String(row.id)===e.target.value);
                    setForm(current => ({...current,items:current.items.map((row,i) => i!==index ? row : selected ? {...row,catalog_id:selected.id,category_id:selected.category_id || '',item_name:selected.name,description:selected.description || '',unit_price:selected.unit_price,tax_rate:selected.tax_rate} : {...row,catalog_id:''})}));
                  }}><option value="">{catalogLoading ? 'Loading?' : 'Custom item / select saved item'}</option>{catalog.items.filter(row => !item.category_id || String(row.category_id)===String(item.category_id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
                  <label className="invoice-field sales-item-name"><span>Item / service *</span><input value={item.item_name} onChange={e => setItem(index,'item_name',e.target.value)} placeholder="Item or service name" required/></label>
                  <label className="invoice-field sales-item-description"><span>Description</span><input value={item.description} onChange={e => setItem(index,'description',e.target.value)} placeholder="Optional details"/></label>
                  <label className="invoice-field"><span>Quantity *</span><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={e => setItem(index,'quantity',e.target.value)} required/></label>
                  <label className="invoice-field"><span>Unit price *</span><input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => setItem(index,'unit_price',e.target.value)} placeholder="0.00" required/></label>
                  <label className="invoice-field"><span>Tax (%)</span><input type="number" min="0" max="100" step="0.01" value={item.tax_rate} onChange={e => setItem(index,'tax_rate',e.target.value)}/></label>
                  <div className="sales-line-total"><span>Line total<strong>{money(line,form.currency)}</strong></span><button type="button" className="finance-icon-btn danger" aria-label={`Remove item ${index+1}`} onClick={() => removeItem(index)} disabled={form.items.length===1}><Trash2 size={16}/></button></div>
                </div>;
              })}
            </div>

            <div className="invoice-summary">
              <div>
                <span>Subtotal</span>
                <strong>
                  {money(
                    totals.subtotal,
                    form.currency
                  )}
                </strong>
              </div>

              <div>
                <span>Tax</span>
                <strong>
                  {money(
                    totals.tax,
                    form.currency
                  )}
                </strong>
              </div>

              <div>
                <span>Discount</span>
                <strong>
                  {money(
                    form.discount_amount,
                    form.currency
                  )}
                </strong>
              </div>

              <div className="invoice-total">
                <span>Total</span>
                <strong>
                  {money(
                    totals.total,
                    form.currency
                  )}
                </strong>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div
                style={{
                  gridColumn: '1 / -1'
                }}
              >
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={e =>
                      setForm({
                        ...form,
                        notes:
                          e.target.value
                      })
                    }
                  />
                </Field>
              </div>

              <div
                style={{
                  gridColumn: '1 / -1'
                }}
              >
                <Field label="Terms">
                  <textarea
                    value={form.terms}
                    onChange={e =>
                      setForm({
                        ...form,
                        terms:
                          e.target.value
                      })
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="finance-modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={saving}
              >
                {saving
                  ? 'Saving...'
                  : editingId
                  ? 'Update draft'
                  : 'Create draft'}
              </button>
            </div>
          </form>
        </div>
      )}
      </>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="invoice-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
