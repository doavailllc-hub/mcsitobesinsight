import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  FileText,
  WalletCards
} from 'lucide-react';
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { api } from '../../lib/api';

const money = value =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

export default function FinanceOverview() {
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState([]);
  const [invoiceRows, setInvoiceRows] = useState([]);
  const [receivableSummary, setReceivableSummary] =
    useState({
      invoice_count: 0,
      outstanding: 0,
      overdue: 0
    });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/finance'),
      api
        .get('/finance-approvals/pending')
        .catch(() => ({ data: [] })),
      api
        .get('/sales-invoices')
        .catch(() => ({ data: [] })),
      api
        .get('/finance/receivables-summary')
        .catch(() => ({
          data: {
            invoice_count: 0,
            outstanding: 0,
            overdue: 0
          }
        }))
    ])
      .then(
        ([
          finance,
          approvals,
          invoices,
          receivables
        ]) => {
          setRows(finance.data || []);
          setPending(
            approvals.data || []
          );
          setInvoiceRows(
            invoices.data || []
          );
          setReceivableSummary(
            receivables.data || {
              invoice_count: 0,
              outstanding: 0,
              overdue: 0
            }
          );
        }
      )
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const approved = rows.filter(
      row =>
        (row.approval_status ||
          'approved') === 'approved'
    );

    const income = approved
      .filter(row => row.type === 'income')
      .reduce(
        (sum, row) =>
          sum + Number(row.amount || 0),
        0
      );

    const expenses = approved
      .filter(row => row.type === 'expense')
      .reduce(
        (sum, row) =>
          sum + Number(row.amount || 0),
        0
      );

    return {
      income,
      expenses,
      net: income - expenses
    };
  }, [rows]);

  const companies = useMemo(() => {
    const map = {};

    rows
      .filter(
        row =>
          (row.approval_status ||
            'approved') ===
          'approved'
      )
      .forEach(row => {
        const key =
          row.company_name || 'Company';

        map[key] ||= {
          income: 0,
          expense: 0
        };

        if (row.type === 'income') {
          map[key].income +=
            Number(row.amount || 0);
        }

        if (row.type === 'expense') {
          map[key].expense +=
            Number(row.amount || 0);
        }
      });

    return Object.entries(map).map(
      ([name, values]) => ({
        name,
        ...values,
        net:
          values.income -
          values.expense
      })
    );
  }, [rows]);

  const monthlyActivity = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        month: date.toLocaleDateString('en-IN', { month: 'short' }),
        income: 0,
        expense: 0,
        net: 0
      };
    });
    const byMonth = Object.fromEntries(months.map(month => [month.key, month]));

    rows
      .filter(row => (row.approval_status || 'approved') === 'approved')
      .forEach(row => {
        const month = byMonth[String(row.date || '').slice(0, 7)];
        if (!month) return;
        if (row.type === 'income') month.income += Number(row.amount || 0);
        if (row.type === 'expense') month.expense += Number(row.amount || 0);
      });

    return months.map(month => ({ ...month, net: month.income - month.expense }));
  }, [rows]);

  if (loading) {
    return (
      <div className="finance-card">
        Loading finance overview...
      </div>
    );
  }

  return (
    <>
      <section className="finance-grid">
        <Stat
          icon={ArrowUpRight}
          label="Approved income"
          value={money(stats.income)}
          note="Approved transactions"
        />

        <Stat
          icon={ArrowDownRight}
          label="Approved expenses"
          value={money(stats.expenses)}
          note="Approved transactions"
        />

        <Stat
          icon={WalletCards}
          label="Receivables"
          value={money(
            receivableSummary.outstanding
          )}
          note={`${receivableSummary.invoice_count || 0} open invoices`}
        />

        <Stat
          icon={Clock3}
          label="Pending approvals"
          value={pending.length}
          note="Transactions waiting for review"
        />
      </section>

      <section className="finance-grid finance-grid-secondary">
        <Stat
          icon={CircleDollarSign}
          label="Net cash movement"
          value={money(stats.net)}
          note="Income less expenses"
        />

        <Stat
          icon={FileText}
          label="Sales invoices"
          value={invoiceRows.length}
          note="Draft, issued and paid"
        />

        <Stat
          icon={Clock3}
          label="Overdue receivables"
          value={money(
            receivableSummary.overdue
          )}
          note="Past due balance"
        />
      </section>

      <section className="finance-card finance-quick-chart">
        <div className="finance-chart-head">
          <div>
            <p className="eyebrow">CASH FLOW QUICK VIEW</p>
            <h2>Income and expenses</h2>
            <span>Approved transactions over the last six months</span>
          </div>
          <div className={`finance-chart-net ${stats.net < 0 ? 'negative' : ''}`}>
            <span>Overall net movement</span>
            <strong>{money(stats.net)}</strong>
          </div>
        </div>

        <div className="finance-chart-area" role="img" aria-label="Six-month income, expense and net movement chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyActivity} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#eef1f5" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} width={58} tick={{ fill: '#98a2b3', fontSize: 10 }} tickFormatter={compactMoney} />
              <Tooltip content={<FinanceChartTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
              <Bar dataKey="income" name="Income" fill="#219a72" radius={[5, 5, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" name="Expense" fill="#e47b68" radius={[5, 5, 0, 0]} maxBarSize={28} />
              <Line dataKey="net" name="Net movement" type="monotone" stroke="#4962b1" strokeWidth={2.5} dot={{ r: 3, fill: '#4962b1' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="finance-two">
        <div className="finance-card">
          <h2>Recent transactions</h2>

          <div style={{ overflowX: 'auto' }}>
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Company</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>

              <tbody>
                {rows.slice(0, 7).map(row => (
                  <tr key={row.id}>
                    <td>
                      {row.date || '—'}
                    </td>

                    <td>
                      {row.company_name ||
                        '—'}
                    </td>

                    <td>
                      {row.description ||
                        row.category ||
                        '—'}
                    </td>

                    <td>
                      <span
                        className={`finance-badge ${
                          row.approval_status ||
                          'approved'
                        }`}
                      >
                        {row.approval_status ||
                          'approved'}
                      </span>
                    </td>

                    <td className="finance-money">
                      {money(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!rows.length && (
              <div className="finance-empty">
                No finance transactions yet.
              </div>
            )}
          </div>
        </div>

        <div className="finance-card">
          <h2>Company performance</h2>

          {companies
            .slice(0, 6)
            .map(company => (
              <div
                key={company.name}
                style={{
                  padding: '10px 0',
                  borderBottom:
                    '1px solid #f2f4f7'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    gap: 12
                  }}
                >
                  <strong
                    style={{
                      fontSize: 13
                    }}
                  >
                    {company.name}
                  </strong>

                  <strong
                    style={{
                      fontSize: 13
                    }}
                  >
                    {money(company.net)}
                  </strong>
                </div>

                <div
                  style={{
                    color: '#667085',
                    fontSize: 11,
                    marginTop: 5
                  }}
                >
                  Income{' '}
                  {money(company.income)}
                  {' · '}
                  Expense{' '}
                  {money(company.expense)}
                </div>
              </div>
            ))}

          {!companies.length && (
            <div className="finance-empty">
              No approved activity to summarize.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const compactMoney = value => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(0)}K`;
  return `₹${amount}`;
};

function FinanceChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="finance-chart-tooltip">
      <strong>{label}</strong>
      {payload.map(item => (
        <span key={item.dataKey}>
          <i style={{ background: item.color }} />
          {item.name}
          <b>{money(item.value)}</b>
        </span>
      ))}
    </div>
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
            'space-between',
          alignItems: 'center'
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
