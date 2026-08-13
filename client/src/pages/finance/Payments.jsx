import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import {
  Link,
  useSearchParams
} from 'react-router-dom';
import { api, getPermissions, getUser } from '../../lib/api';

const money = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const emptyForm = {
  company_id: '',
  invoice_id: '',
  payment_date: '',
  amount: '',
  currency: 'INR',
  payment_method: 'bank_transfer',
  reference_number: '',
  notes: ''
};

export default function Payments() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();

  const user = getUser();
  const permissions = new Set(
    getPermissions()
  );

  const isGroupAdmin =
    user?.role === 'group_admin';

  const canCreate =
    isGroupAdmin ||
    permissions.has('finance.create');

  const canEdit =
    isGroupAdmin ||
    permissions.has('finance.edit');

  const load = async () => {
    try {
      const response =
        await api.get('/customer-payments');

      setRows(response.data || []);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const invoiceId =
      searchParams.get('invoice');

    if (invoiceId && canCreate) {
      openCreate(invoiceId);
    }
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter(row =>
        JSON.stringify(row)
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [rows, query]
  );

  const openCreate = async (
    preferredInvoiceId = ''
  ) => {
    setError('');

    try {
      const [companyResponse, invoiceResponse] =
        await Promise.all([
          api.get('/company-options'),
          api.get('/sales-invoices')
        ]);

      const availableInvoices =
        (invoiceResponse.data || []).filter(
          invoice =>
            [
              'issued',
              'partially_paid'
            ].includes(invoice.status) &&
            Number(
              invoice.balance_amount || 0
            ) > 0
        );

      setCompanies(
        companyResponse.data || []
      );

      setInvoices(availableInvoices);

      let nextForm = {
        ...emptyForm,
        payment_date:
          new Date()
            .toISOString()
            .slice(0, 10)
      };

      if (preferredInvoiceId) {
        const invoice =
          availableInvoices.find(
            item =>
              Number(item.id) ===
              Number(
                preferredInvoiceId
              )
          );

        if (invoice) {
          nextForm = {
            ...nextForm,
            company_id:
              invoice.company_id,
            invoice_id:
              invoice.id,
            currency:
              invoice.currency || 'INR',
            amount:
              invoice.balance_amount
          };
        }
      }

      setForm(nextForm);
      setOpen(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Unable to load payment options.'
      );
    }
  };

  const selectInvoice = invoiceId => {
    const invoice = invoices.find(
      item =>
        Number(item.id) ===
        Number(invoiceId)
    );

    setForm(current => ({
      ...current,
      invoice_id: invoiceId,
      company_id:
        invoice?.company_id ||
        current.company_id,
      currency:
        invoice?.currency ||
        current.currency,
      amount:
        invoice?.balance_amount ||
        current.amount
    }));
  };

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await api.post(
        '/customer-payments',
        form
      );

      setOpen(false);
      await load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.detail ||
        'Unable to record payment.'
      );
    } finally {
      setSaving(false);
    }
  };

  const reverse = async row => {
    if (
      !window.confirm(
        `Reverse payment #${row.id}?`
      )
    ) {
      return;
    }

    try {
      await api.delete(
        `/customer-payments/${row.id}`
      );

      await load();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        'Unable to reverse payment.'
      );
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="Search payments"
            value={query}
            onChange={e =>
              setQuery(e.target.value)
            }
          />
        </div>

        {canCreate && (
          <button
            className="primary-btn"
            onClick={() => openCreate()}
          >
            <Plus size={16} />
            Record payment
          </button>
        )}
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
                <th>Date</th>
                <th>Company</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Received by</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => (
                <tr key={row.id}>
                  <td>
                    {row.payment_date}
                  </td>

                  <td>
                    {row.company_name}
                  </td>

                  <td>
                    {row.invoice_id ? (
                      <Link
                        to={`/finance/invoices/${row.invoice_id}`}
                      >
                        {row.invoice_number ||
                          `Invoice #${row.invoice_id}`}
                      </Link>
                    ) : (
                      'Unallocated'
                    )}
                  </td>

                  <td>
                    {row.customer_name ||
                      '—'}
                  </td>

                  <td
                    style={{
                      textTransform:
                        'capitalize'
                    }}
                  >
                    {row.payment_method?.replaceAll(
                      '_',
                      ' '
                    )}
                  </td>

                  <td>
                    {row.reference_number ||
                      '—'}
                  </td>

                  <td>
                    {row.received_by_name ||
                      '—'}
                  </td>

                  <td className="finance-money">
                    {money(
                      row.amount,
                      row.currency
                    )}
                  </td>

                  <td>
                    {canEdit && (
                      <button
                        className="finance-icon-btn danger"
                        title="Reverse payment"
                        onClick={() =>
                          reverse(row)
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!filtered.length && (
            <div className="finance-empty">
              No payments recorded.
            </div>
          )}
        </div>
      </section>

      {open && (
        <div
          className="finance-modal-backdrop"
          onMouseDown={e =>
            e.target === e.currentTarget &&
            !saving &&
            setOpen(false)
          }
        >
          <form
            className="finance-modal"
            onSubmit={save}
          >
            <div className="invoice-modal-head">
              <div>
                <p className="eyebrow">
                  CUSTOMER PAYMENT
                </p>
                <h2>
                  Record payment
                </h2>
              </div>

              <button
                type="button"
                className="finance-icon-btn"
                onClick={() =>
                  setOpen(false)
                }
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
              <Field label="Invoice">
                <select
                  value={form.invoice_id}
                  onChange={e =>
                    selectInvoice(
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    Unallocated payment
                  </option>

                  {invoices.map(invoice => (
                    <option
                      key={invoice.id}
                      value={invoice.id}
                    >
                      {invoice.invoice_number}
                      {' — '}
                      {invoice.customer_name}
                      {' — '}
                      {money(
                        invoice.balance_amount,
                        invoice.currency
                      )}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Company *">
                <select
                  required
                  value={form.company_id}
                  onChange={e =>
                    setForm({
                      ...form,
                      company_id:
                        e.target.value
                    })
                  }
                  disabled={
                    Boolean(
                      form.invoice_id
                    )
                  }
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

              <Field label="Payment date *">
                <input
                  required
                  type="date"
                  value={form.payment_date}
                  onChange={e =>
                    setForm({
                      ...form,
                      payment_date:
                        e.target.value
                    })
                  }
                />
              </Field>

              <Field label="Amount *">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={e =>
                    setForm({
                      ...form,
                      amount:
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

              <Field label="Payment method">
                <select
                  value={
                    form.payment_method
                  }
                  onChange={e =>
                    setForm({
                      ...form,
                      payment_method:
                        e.target.value
                    })
                  }
                >
                  <option value="bank_transfer">
                    Bank transfer
                  </option>
                  <option value="cash">
                    Cash
                  </option>
                  <option value="card">
                    Card
                  </option>
                  <option value="cheque">
                    Cheque
                  </option>
                  <option value="upi">
                    UPI
                  </option>
                  <option value="other">
                    Other
                  </option>
                </select>
              </Field>

              <Field label="Reference number">
                <input
                  value={
                    form.reference_number
                  }
                  onChange={e =>
                    setForm({
                      ...form,
                      reference_number:
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
            </div>

            <div className="finance-modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  setOpen(false)
                }
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={saving}
              >
                {saving
                  ? 'Saving...'
                  : 'Record payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
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
