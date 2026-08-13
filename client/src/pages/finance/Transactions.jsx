import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  CalendarDays,
  Building2,
  ReceiptText,
  IndianRupee,
  FileText
} from 'lucide-react';

import {
  api,
  getPermissions,
  getUser
} from '../../lib/api';

const money = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const emptyForm = {
  company_id: '',
  date: '',
  type: 'expense',
  category: '',
  description: '',
  amount: '',
  currency: 'INR'
};

export default function Transactions() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const user = getUser();
  const permissions = new Set(getPermissions());

  const isGroupAdmin =
    user?.role === 'group_admin';

  const canCreate =
    isGroupAdmin ||
    permissions.has('finance.create');

  const canEdit =
    isGroupAdmin ||
    permissions.has('finance.edit');

  const canDelete =
    isGroupAdmin ||
    permissions.has('finance.delete');

  const load = async () => {
    try {
      const response = await api.get('/finance');
      setRows(response.data || []);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return rows.filter(row => {
      const rowStatus =
        row.approval_status || 'approved';

      const matchesStatus =
        status === 'all' ||
        rowStatus === status;

      if (!matchesStatus) return false;

      if (!needle) return true;

      return [
        row.date,
        row.company_name,
        row.type,
        row.category,
        row.description,
        row.amount,
        row.approval_status
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, query, status]);

  const loadCompanies = async () => {
    const response =
      await api.get('/company-options');

    setCompanies(response.data || []);
  };

  const startAdd = async () => {
    setError('');

    try {
      await loadCompanies();

      setEditingId(null);
      setForm({
        ...emptyForm,
        date: new Date()
          .toISOString()
          .slice(0, 10)
      });

      setOpen(true);
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
          'Unable to load companies.'
      );
    }
  };

  const startEdit = async row => {
    const rowStatus =
      row.approval_status || 'approved';

    if (rowStatus === 'approved') {
      return;
    }

    setError('');

    try {
      const [optionsResponse, detailResponse] =
        await Promise.all([
          api.get('/company-options'),
          api.get(`/finance/${row.id}`)
        ]);

      setCompanies(
        optionsResponse.data || []
      );

      const detail =
        detailResponse.data || {};

      setForm({
        company_id:
          detail.company_id || '',
        date:
          detail.date || '',
        type:
          detail.type || 'expense',
        category:
          detail.category || '',
        description:
          detail.description || '',
        amount:
          detail.amount || '',
        currency:
          detail.currency || 'INR'
      });

      setEditingId(row.id);
      setOpen(true);
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
          'Unable to load transaction.'
      );
    }
  };

  const closeModal = () => {
    if (saving) return;

    setOpen(false);
    setEditingId(null);
    setError('');
    setForm(emptyForm);
  };

  const change = (key, value) => {
    setForm(current => ({
      ...current,
      [key]: value
    }));
  };

  const save = async event => {
    event.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = {
        ...form,
        company_id: Number(
          form.company_id
        ),
        amount: Number(form.amount)
      };

      if (editingId) {
        await api.put(
          `/finance/${editingId}`,
          payload
        );
      } else {
        await api.post(
          '/finance',
          payload
        );
      }

      closeModal();
      await load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          'Unable to save transaction.'
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async row => {
    const rowStatus =
      row.approval_status || 'approved';

    if (rowStatus === 'approved') {
      return;
    }

    if (
      !window.confirm(
        'Delete this transaction?'
      )
    ) {
      return;
    }

    try {
      await api.delete(
        `/finance/${row.id}`
      );

      await load();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
          'Unable to delete transaction.'
      );
    }
  };

  const resubmit = async row => {
    try {
      await api.put(
        `/finance/${row.id}/resubmit`
      );

      await load();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
          'Unable to resubmit transaction.'
      );
    }
  };

  return (
    <>
      <div className="finance-page-toolbar">
        <div className="finance-page-search">
          <Search size={17} />

          <input
            value={query}
            onChange={event =>
              setQuery(event.target.value)
            }
            placeholder="Search transactions..."
          />
        </div>

        <div className="finance-page-actions">
          <select
            className="finance-status-filter"
            value={status}
            onChange={event =>
              setStatus(event.target.value)
            }
          >
            <option value="all">
              All statuses
            </option>

            <option value="pending">
              Pending
            </option>

            <option value="approved">
              Approved
            </option>

            <option value="rejected">
              Rejected
            </option>
          </select>

          {canCreate && (
            <button
              className="primary-btn"
              onClick={startAdd}
            >
              <Plus size={16} />
              New transaction
            </button>
          )}
        </div>
      </div>

      <section className="finance-list-card">
        <div className="finance-table-scroll">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Company</th>
                <th>Type</th>
                <th>Category</th>
                <th>Description</th>
                <th>Status</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => {
                const rowStatus =
                  row.approval_status ||
                  'approved';

                return (
                  <tr key={row.id}>
                    <td>
                      {row.date || '—'}
                    </td>

                    <td>
                      {row.company_name ||
                        '—'}
                    </td>

                    <td>
                      <span className="finance-type">
                        {row.type || '—'}
                      </span>
                    </td>

                    <td>
                      {row.category || '—'}
                    </td>

                    <td className="finance-description-cell">
                      {row.description ||
                        '—'}
                    </td>

                    <td>
                      <span
                        className={`finance-badge ${rowStatus}`}
                      >
                        {rowStatus}
                      </span>
                    </td>

                    <td className="finance-money">
                      {money(
                        row.amount,
                        row.currency
                      )}
                    </td>

                    <td>
                      <div className="finance-actions">
                        {rowStatus ===
                          'rejected' &&
                          canEdit && (
                            <button
                              className="finance-icon-btn"
                              title="Resubmit"
                              onClick={() =>
                                resubmit(row)
                              }
                            >
                              <RotateCcw
                                size={15}
                              />
                            </button>
                          )}

                        {rowStatus !==
                          'approved' &&
                          canEdit && (
                            <button
                              className="finance-icon-btn"
                              title="Edit"
                              onClick={() =>
                                startEdit(row)
                              }
                            >
                              <Pencil
                                size={15}
                              />
                            </button>
                          )}

                        {rowStatus !==
                          'approved' &&
                          canDelete && (
                            <button
                              className="finance-icon-btn danger"
                              title="Delete"
                              onClick={() =>
                                remove(row)
                              }
                            >
                              <Trash2
                                size={15}
                              />
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!filtered.length && (
          <div className="finance-empty">
            No transactions found.
          </div>
        )}
      </section>

      {open && (
        <div
          className="finance-modal-backdrop"
          onMouseDown={event => {
            if (
              event.target ===
                event.currentTarget &&
              !saving
            ) {
              closeModal();
            }
          }}
        >
          <form
            className="finance-transaction-modal"
            onSubmit={save}
          >
            <header className="finance-transaction-modal-head">
              <div>
                <p className="eyebrow">
                  FINANCE
                </p>

                <h2>
                  {editingId
                    ? 'Edit transaction'
                    : 'New transaction'}
                </h2>

                <p>
                  {editingId
                    ? 'Update the transaction details below.'
                    : 'Add a new financial transaction for approval.'}
                </p>
              </div>

              <button
                type="button"
                className="finance-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            {error && (
              <div className="finance-error">
                {error}
              </div>
            )}

            <div className="finance-transaction-form-grid">
              <Field
                label="Company"
                required
                icon={Building2}
              >
                <select
                  required
                  value={form.company_id}
                  onChange={event =>
                    change(
                      'company_id',
                      event.target.value
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

              <Field
                label="Date"
                required
                icon={CalendarDays}
              >
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={event =>
                    change(
                      'date',
                      event.target.value
                    )
                  }
                />
              </Field>

              <Field
                label="Type"
                required
                icon={ReceiptText}
              >
                <select
                  required
                  value={form.type}
                  onChange={event =>
                    change(
                      'type',
                      event.target.value
                    )
                  }
                >
                  <option value="expense">
                    Expense
                  </option>

                  <option value="income">
                    Income
                  </option>

                  <option value="capital">
                    Capital
                  </option>

                  <option value="loan">
                    Loan
                  </option>

                  <option value="intercompany">
                    Intercompany
                  </option>
                </select>
              </Field>

              <Field
                label="Category"
                required
                icon={FileText}
              >
                <input
                  required
                  value={form.category}
                  onChange={event =>
                    change(
                      'category',
                      event.target.value
                    )
                  }
                  placeholder="e.g. Rent, Fuel, Software"
                />
              </Field>

              <Field
                label="Amount"
                required
                icon={IndianRupee}
              >
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.amount}
                  onChange={event =>
                    change(
                      'amount',
                      event.target.value
                    )
                  }
                  placeholder="0.00"
                />
              </Field>

              <Field label="Currency">
                <select
                  value={form.currency}
                  onChange={event =>
                    change(
                      'currency',
                      event.target.value
                    )
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

              <div className="finance-transaction-field-full">
                <Field label="Description">
                  <textarea
                    value={form.description}
                    onChange={event =>
                      change(
                        'description',
                        event.target.value
                      )
                    }
                    placeholder="Enter transaction description..."
                  />
                </Field>
              </div>
            </div>

            <div className="finance-transaction-info">
              <div className="finance-transaction-info-icon">
                !
              </div>

              <p>
                New transactions are submitted as
                <strong> Pending </strong>
                and must be approved before they
                become locked financial records.
              </p>
            </div>

            <footer className="finance-transaction-modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={closeModal}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-btn"
                disabled={saving}
              >
                {saving
                  ? 'Saving...'
                  : editingId
                  ? 'Update transaction'
                  : 'Create transaction'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  icon: Icon,
  children
}) {
  return (
    <label className="finance-transaction-field">
      <span className="finance-transaction-label">
        {Icon && <Icon size={14} />}
        {label}
        {required && (
          <em>*</em>
        )}
      </span>

      {children}
    </label>
  );
}
