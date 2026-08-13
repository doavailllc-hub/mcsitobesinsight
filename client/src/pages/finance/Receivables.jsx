import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  AlertTriangle,
  WalletCards,
  Clock3
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

const money = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

export default function Receivables() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    invoice_count: 0,
    outstanding: 0,
    overdue: 0
  });
  const [query, setQuery] = useState('');

  const load = async () => {
    const [list, totals] =
      await Promise.all([
        api.get('/finance/receivables'),
        api.get(
          '/finance/receivables-summary'
        )
      ]);

    setRows(list.data || []);
    setSummary(
      totals.data || {
        invoice_count: 0,
        outstanding: 0,
        overdue: 0
      }
    );
  };

  useEffect(() => {
    load().catch(() => {
      setRows([]);
    });
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

  return (
    <>
      <section
        className="finance-grid"
        style={{
          gridTemplateColumns:
            'repeat(3,minmax(0,1fr))'
        }}
      >
        <Stat
          icon={WalletCards}
          label="Open receivables"
          value={summary.invoice_count || 0}
          note="Outstanding invoices"
        />

        <Stat
          icon={Clock3}
          label="Outstanding amount"
          value={money(
            summary.outstanding
          )}
          note="Current unpaid balance"
        />

        <Stat
          icon={AlertTriangle}
          label="Overdue amount"
          value={money(summary.overdue)}
          note="Past due date"
        />
      </section>

      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="Search receivables"
            value={query}
            onChange={e =>
              setQuery(e.target.value)
            }
          />
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
                <th>Due date</th>
                <th>Invoice total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Aging</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => (
                <tr key={row.invoice_id}>
                  <td>
                    <strong>
                      {row.invoice_number}
                    </strong>
                  </td>

                  <td>
                    {row.company_name}
                  </td>

                  <td>
                    {row.customer_name}
                  </td>

                  <td>
                    {row.due_date || '—'}
                  </td>

                  <td>
                    {money(
                      row.total_amount,
                      row.currency
                    )}
                  </td>

                  <td>
                    {money(
                      row.paid_amount,
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
                      className={`finance-badge ${
                        row.receivable_status ===
                        'overdue'
                          ? 'rejected'
                          : 'pending'
                      }`}
                    >
                      {row.receivable_status ===
                      'overdue'
                        ? `${row.days_overdue} days overdue`
                        : 'Outstanding'}
                    </span>
                  </td>

                  <td>
                    <div className="finance-actions">
                      <Link
                        to={`/finance/invoices/${row.invoice_id}`}
                        className="secondary-btn"
                        style={{
                          textDecoration: 'none'
                        }}
                      >
                        View
                      </Link>

                      <Link
                        to={`/finance/payments?invoice=${row.invoice_id}`}
                        className="primary-btn"
                        style={{
                          textDecoration: 'none'
                        }}
                      >
                        Receive
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!filtered.length && (
            <div className="finance-empty">
              No outstanding receivables.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note
}) {
  return (
    <div className="finance-stat">
      <div
        style={{
          display: 'flex',
          justifyContent:
            'space-between'
        }}
      >
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
