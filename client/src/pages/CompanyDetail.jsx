import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Globe2,
  Landmark,
  Layers3,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, getPermissions, getUser } from "../lib/api";

const blank = {
  shareholder_name: "",
  shareholder_type: "Individual",
  share_percent: "",
};
export default function CompanyDetail() {
  const { id } = useParams(),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [open, setOpen] = useState(false),
    [form, setForm] = useState(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const user = getUser(),
    permissions = new Set(getPermissions()),
    canManage =
      user?.role === "group_admin" || permissions.has("companies.manage");
  const load = async () => {
    setLoading(true);
    try {
      setData((await api.get(`/companies/${id}`)).data);
      setLoadError("");
    } catch (e) {
      setLoadError(e.response?.data?.message || "Unable to load company.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [id]);
  const total = useMemo(
    () =>
      (data?.shareholders || []).reduce(
        (s, x) => s + Number(x.share_percent || 0),
        0,
      ),
    [data],
  );
  const formTotal = (form?.shareholders || []).reduce(
    (s, x) => s + Number(x.share_percent || 0),
    0,
  );
  const edit = () => {
    const c = data.company,
      s = data.shareholders || [];
    setForm({
      name: c.name || "",
      legal_name: c.legal_name || "",
      company_type: c.company_type || "Subsidiary / Partner Company",
      industry: c.industry || "",
      sanleo_share: c.sanleo_share ?? "",
      country: c.country || "India",
      currency: c.currency || "INR",
      status: c.status || "active",
      shareholders: s.length
        ? s.map((x) => ({
            shareholder_name: x.shareholder_name,
            shareholder_type: x.shareholder_type,
            share_percent: x.share_percent,
          }))
        : [
            {
              ...blank,
              shareholder_name: "Sanleo Capital",
              shareholder_type: "Company",
              share_percent: c.sanleo_share ?? "",
            },
          ],
    });
    setError("");
    setOpen(true);
  };
  const setField = (key, value) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "sanleo_share")
        next.shareholders = f.shareholders.map((s, i) =>
          i === 0 ? { ...s, share_percent: value } : s,
        );
      return next;
    });
  const setShare = (i, key, value) =>
    setForm((f) => ({
      ...f,
      shareholders: f.shareholders.map((s, x) =>
        x === i ? { ...s, [key]: value } : s,
      ),
    }));
  const save = async (e) => {
    e.preventDefault();
    if (Math.abs(formTotal - 100) > 0.001)
      return setError(
        `Ownership must total 100%. Current allocation is ${formTotal.toFixed(2)}%.`,
      );
    setSaving(true);
    try {
      await api.put(`/companies/${id}`, {
        ...form,
        sanleo_share: Number(form.sanleo_share),
        legal_name: form.legal_name || form.name,
        shareholders: form.shareholders
          .filter((s) => s.shareholder_name.trim())
          .map((s) => ({ ...s, share_percent: Number(s.share_percent) })),
      });
      await load();
      setOpen(false);
    } catch (e) {
      setError(e.response?.data?.message || "Unable to update company.");
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <div className="page company-detail-page">
        <div className="company-detail-loading" />
      </div>
    );
  if (loadError || !data?.company)
    return (
      <div className="page company-detail-page">
        <Link className="company-detail-back" to="/companies">
          <ArrowLeft size={15} />
          Companies
        </Link>
        <div className="company-detail-error">
          <ShieldCheck size={21} />
          <div>
            <strong>Company unavailable</strong>
            <span>{loadError || "Company not found."}</span>
          </div>
        </div>
      </div>
    );
  const c = data.company,
    shares = data.shareholders || [],
    products = data.products || [];
  return (
    <div className="page company-detail-page">
      <Link className="company-detail-back" to="/companies">
        <ArrowLeft size={15} />
        Back to companies
      </Link>
      <header className="company-detail-hero">
        <div className="company-detail-logo">
          {c.logo_url ? <img src={c.logo_url} alt={`${c.name} logo`} /> : c.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="eyebrow">COMPANY WORKSPACE</p>
          <h1>{c.name}</h1>
          <p>
            {c.industry || "Industry not specified"} ·{" "}
            {c.company_type || "Company"}
          </p>
        </div>
        <div className="company-detail-actions">
          <span className={`company-life ${c.status}`}>
            <i />
            {c.status}
          </span>
          {canManage ? (
            <button onClick={edit}>
              <Pencil size={15} />
              Edit company
            </button>
          ) : (
            <span className="detail-readonly">
              <ShieldCheck size={14} />
              Read-only
            </span>
          )}
        </div>
      </header>
      <section className="company-detail-stats">
        <DetailStat
          icon={Building2}
          label="Sanleo ownership"
          value={`${Number(c.sanleo_share || 0).toFixed(0)}%`}
          note="Group holding"
        />
        <DetailStat
          icon={Users}
          label="Shareholders"
          value={shares.length}
          note={`${total.toFixed(0)}% allocated`}
        />
        <DetailStat
          icon={Layers3}
          label="Products"
          value={products.length}
          note="Registered portfolio"
        />
        <DetailStat
          icon={Globe2}
          label="Operating market"
          value={c.country || "—"}
          note={c.currency || "Currency not set"}
        />
      </section>
      <div className="company-detail-grid">
        <section className="company-detail-card profile">
          <CardHead
            title="Company profile"
            note="Legal and operating information"
          />
          <div className="company-profile-grid">
            <ProfileItem label="Legal name" value={c.legal_name || c.name} />
            <ProfileItem label="Company type" value={c.company_type} />
            <ProfileItem label="Industry" value={c.industry} />
            <ProfileItem label="Parent company" value="Sanleo Capital" />
            <ProfileItem label="Country" value={c.country} />
            <ProfileItem label="Currency" value={c.currency} />
            <ProfileItem
              label="Registration number"
              value={c.registration_no}
            />
            <ProfileItem label="Website" value={c.website} link />
          </div>
        </section>
        <section className="company-detail-card ownership">
          <CardHead
            title="Ownership structure"
            note={`${total.toFixed(2)}% allocated`}
          />
          <div className="ownership-ring">
            <div
              style={{
                background: `conic-gradient(#6765b2 ${Math.min(100, Number(c.sanleo_share || 0))}%,#e9eaf0 0)`,
              }}
            >
              <span>
                <strong>{Number(c.sanleo_share || 0).toFixed(0)}%</strong>
                <small>Sanleo</small>
              </span>
            </div>
          </div>
          <div className="ownership-list">
            {shares.map((s, i) => (
              <div key={s.id || i}>
                <i className={`share-tone-${i % 4}`} />
                <span>
                  <strong>{s.shareholder_name}</strong>
                  <small>{s.shareholder_type}</small>
                </span>
                <b>{Number(s.share_percent || 0).toFixed(2)}%</b>
              </div>
            ))}
            {!shares.length && <p>No shareholders registered.</p>}
          </div>
        </section>
        <section className="company-detail-card products">
          <CardHead
            title="Product portfolio"
            note={`${products.length} products registered`}
            action={
              <Link to="/products">
                View portfolio <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="detail-product-grid">
            {products.map((p, i) => (
              <article key={p.id}>
                <div className={`detail-product-icon tone-${i % 4}`}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <strong>{p.name}</strong>
                  <span>{p.category || "Uncategorized"}</span>
                  <p>{p.description || "No description added."}</p>
                </div>
                <span
                  className={`product-status status-${String(p.status).toLowerCase()}`}
                >
                  <i />
                  {p.status}
                </span>
              </article>
            ))}
            {!products.length && (
              <div className="detail-products-empty">
                <Layers3 size={20} />
                No products registered for this company.
              </div>
            )}
          </div>
        </section>
      </div>
      {open && form && (
        <div
          className="company-modal-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && !saving && setOpen(false)
          }
        >
          <form className="company-modal" onSubmit={save}>
            <div className="company-modal-head">
              <div>
                <p className="eyebrow">COMPANY WORKFLOW</p>
                <h2>Edit company</h2>
                <span>Update the legal profile and ownership structure.</span>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {error && <div className="company-form-error">{error}</div>}
            <section className="company-form-section">
              <h3>Company information</h3>
              <div className="company-form-grid">
                <Field label="Company name">
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </Field>
                <Field label="Legal name">
                  <input
                    value={form.legal_name}
                    onChange={(e) => setField("legal_name", e.target.value)}
                  />
                </Field>
                <Field label="Industry">
                  <input
                    required
                    value={form.industry}
                    onChange={(e) => setField("industry", e.target.value)}
                  />
                </Field>
                <Field label="Company type">
                  <select
                    value={form.company_type}
                    onChange={(e) => setField("company_type", e.target.value)}
                  >
                    <option>Subsidiary / Partner Company</option>
                    <option>Joint Venture</option>
                    <option>Joint Venture / App</option>
                    <option>App</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Country">
                  <input
                    value={form.country}
                    onChange={(e) => setField("country", e.target.value)}
                  />
                </Field>
                <Field label="Currency">
                  <select
                    value={form.currency}
                    onChange={(e) => setField("currency", e.target.value)}
                  >
                    {["INR", "SAR", "AED", "USD"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Sanleo share %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step=".01"
                    value={form.sanleo_share}
                    onChange={(e) => setField("sanleo_share", e.target.value)}
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(e) => setField("status", e.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
              </div>
            </section>
            <section className="company-form-section">
              <div className="ownership-form-head">
                <div>
                  <h3>Ownership structure</h3>
                  <p>Percentages must total 100%.</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      shareholders: [...f.shareholders, { ...blank }],
                    }))
                  }
                >
                  <Plus size={14} />
                  Add shareholder
                </button>
              </div>
              <div className="ownership-total">
                <span>Allocated ownership</span>
                <strong
                  className={
                    Math.abs(formTotal - 100) < 0.001 ? "valid" : "invalid"
                  }
                >
                  {formTotal.toFixed(2)}%
                </strong>
                <div>
                  <i style={{ width: `${Math.min(100, formTotal)}%` }} />
                </div>
              </div>
              <div className="shareholder-editor">
                {form.shareholders.map((s, i) => (
                  <div key={i}>
                    <input
                      value={s.shareholder_name}
                      onChange={(e) =>
                        setShare(i, "shareholder_name", e.target.value)
                      }
                    />
                    <select
                      value={s.shareholder_type}
                      onChange={(e) =>
                        setShare(i, "shareholder_type", e.target.value)
                      }
                    >
                      <option>Company</option>
                      <option>Individual</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step=".01"
                      value={s.share_percent}
                      onChange={(e) =>
                        setShare(i, "share_percent", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          shareholders: f.shareholders.filter(
                            (_, x) => x !== i,
                          ),
                        }))
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <div className="company-modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={saving || Math.abs(formTotal - 100) > 0.001}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function DetailStat({ icon: Icon, label, value, note }) {
  return (
    <div className="company-detail-stat">
      <Icon size={18} />
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </div>
  );
}
function CardHead({ title, note, action }) {
  return (
    <div className="company-detail-card-head">
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {action}
    </div>
  );
}
function ProfileItem({ label, value, link }) {
  return (
    <div>
      <span>{label}</span>
      {link && value ? (
        <a href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <strong>{value || "—"}</strong>
      )}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="company-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
