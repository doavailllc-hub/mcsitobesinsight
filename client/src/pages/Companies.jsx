import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  Download,
  Globe2,
  ImagePlus,
  Landmark,
  Layers3,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, getPermissions, getUser } from "../lib/api";

const empty = {
  name: "",
  legal_name: "",
  company_type: "Subsidiary / Partner Company",
  industry: "",
  sanleo_share: "",
  country: "India",
  currency: "INR",
  status: "active",
  shareholders: [
    {
      shareholder_name: "Sanleo Capital",
      shareholder_type: "Company",
      share_percent: "",
    },
  ],
};
const tones = ["indigo", "blue", "green", "orange", "rose"];
const initials = (n) =>
  String(n || "CO")
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();

export default function Companies() {
  const [rows, setRows] = useState([]),
    [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [status, setStatus] = useState("all"),
    [open, setOpen] = useState(false),
    [form, setForm] = useState(empty),
    [editingId, setEditingId] = useState(null),
    [logoFile, setLogoFile] = useState(null),
    [logoPreview, setLogoPreview] = useState(""),
    [saving, setSaving] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const user = getUser(),
    permissions = new Set(getPermissions()),
    canManage =
      user?.role === "group_admin" || permissions.has("companies.manage");
  const load = async () => {
    setLoading(true);
    try {
      setRows((await api.get("/companies")).data || []);
    } catch (e) {
      setError(e.response?.data?.message || "Unable to load companies.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const filtered = useMemo(
    () =>
      rows.filter(
        (c) =>
          (status === "all" || c.status === status) &&
          (type === "all" ||
            (type === "subsidiary"
              ? String(c.company_type).toLowerCase().includes("subsidiary")
              : String(c.company_type).toLowerCase().includes("joint"))) &&
          (!query ||
            [c.name, c.legal_name, c.industry, c.country]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [rows, query, type, status],
  );
  const active = rows.filter((c) => c.status === "active").length,
    joint = rows.filter((c) =>
      String(c.company_type).toLowerCase().includes("joint"),
    ).length,
    avg = rows.length
      ? rows.reduce((s, c) => s + Number(c.sanleo_share || 0), 0) / rows.length
      : 0;
  const create = () => {
    setEditingId(null);
    setForm(empty);
    setLogoFile(null);
    setLogoPreview("");
    setError("");
    setOpen(true);
  };
  const edit = async (id) => {
    try {
      const d = (await api.get(`/companies/${id}`)).data,
        c = d.company || {},
        shares = d.shareholders || [];
      setForm({
        name: c.name || "",
        legal_name: c.legal_name || "",
        company_type: c.company_type || empty.company_type,
        industry: c.industry || "",
        sanleo_share: c.sanleo_share ?? "",
        country: c.country || "India",
        currency: c.currency || "INR",
        status: c.status || "active",
        shareholders: shares.length
          ? shares.map((s) => ({
              shareholder_name: s.shareholder_name,
              shareholder_type: s.shareholder_type,
              share_percent: s.share_percent,
            }))
          : [
              {
                shareholder_name: "Sanleo Capital",
                shareholder_type: "Company",
                share_percent: c.sanleo_share ?? "",
              },
            ],
      });
      setEditingId(id);
      setLogoFile(null);
      setLogoPreview(c.logo_url || "");
      setError("");
      setOpen(true);
    } catch (e) {
      window.alert(e.response?.data?.message || "Unable to load company.");
    }
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
  const addShare = () =>
    setForm((f) => ({
      ...f,
      shareholders: [
        ...f.shareholders,
        {
          shareholder_name: "",
          shareholder_type: "Individual",
          share_percent: "",
        },
      ],
    }));
  const removeShare = (i) =>
    setForm((f) => ({
      ...f,
      shareholders: f.shareholders.filter((_, x) => x !== i),
    }));
  const total = form.shareholders.reduce(
    (s, x) => s + Number(x.share_percent || 0),
    0,
  );
  const chooseLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError("Company logo must be 3 MB or smaller.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setError("");
  };
  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (Math.abs(total - 100) > 0.001)
      return setError(
        `Ownership must total 100%. Current allocation is ${total.toFixed(2)}%.`,
      );
    setSaving(true);
    try {
      const payload = {
        ...form,
        sanleo_share: Number(form.sanleo_share),
        legal_name: form.legal_name || form.name,
        shareholders: form.shareholders
          .filter((s) => s.shareholder_name.trim())
          .map((s) => ({ ...s, share_percent: Number(s.share_percent) })),
      };
      let companyId = editingId;
      if (editingId) await api.put(`/companies/${editingId}`, payload);
      else companyId = (await api.post("/companies", payload)).data.id;
      if (logoFile) {
        const body = new FormData();
        body.append("logo", logoFile);
        await api.post(`/companies/${companyId}/logo`, body);
      }
      setOpen(false);
      await load();
    } catch (e) {
      setError(
        e.response?.data?.message ||
          e.response?.data?.detail ||
          "Unable to save company.",
      );
    } finally {
      setSaving(false);
    }
  };
  const remove = async (c) => {
    if (
      !window.confirm(
        `Delete ${c.name}? Related records may block deletion; deactivate it instead if historical data must be retained.`,
      )
    )
      return;
    try {
      await api.delete(`/companies/${c.id}`);
      await load();
    } catch (e) {
      window.alert(
        e.response?.data?.message ||
          e.response?.data?.detail ||
          "Unable to delete company.",
      );
    }
  };
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`,
      data = [
        [
          "Company",
          "Legal name",
          "Type",
          "Industry",
          "Ownership",
          "Country",
          "Currency",
          "Status",
        ],
        ...filtered.map((c) => [
          c.name,
          c.legal_name,
          c.company_type,
          c.industry,
          c.sanleo_share,
          c.country,
          c.currency,
          c.status,
        ]),
      ],
      url = URL.createObjectURL(
        new Blob(
          [`\uFEFF${data.map((r) => r.map(esc).join(",")).join("\n")}`],
          { type: "text/csv" },
        ),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "company-portfolio.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="page companies-workspace">
      <header className="companies-hero">
        <div className="companies-hero-icon">
          <Landmark size={25} />
        </div>
        <div>
          <p className="eyebrow">GROUP STRUCTURE</p>
          <h1>Companies</h1>
          <p>
            Manage operating companies, legal profiles and ownership across the
            group.
          </p>
        </div>
        {canManage ? (
          <button onClick={create}>
            <Plus size={17} /> Add company
          </button>
        ) : (
          <span>
            <ShieldCheck size={15} /> Read-only access
          </span>
        )}
      </header>
      <section className="companies-stats">
        <CoStat
          icon={Building2}
          label="Portfolio companies"
          value={rows.length}
          note="Operating entities"
          tone="indigo"
        />
        <CoStat
          icon={Globe2}
          label="Active companies"
          value={active}
          note={`${rows.length - active} inactive`}
          tone="green"
        />
        <CoStat
          icon={Layers3}
          label="Joint ventures"
          value={joint}
          note="Partnership entities"
          tone="blue"
        />
        <CoStat
          icon={Users}
          label="Average ownership"
          value={`${avg.toFixed(0)}%`}
          note="Sanleo holding"
          tone="amber"
        />
      </section>
      <div className="companies-toolbar">
        <div className="companies-search">
          <Search size={16} />
          <input
            placeholder="Search company, industry or country"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All company types</option>
          <option value="subsidiary">Subsidiaries</option>
          <option value="joint">Joint ventures</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={exportCsv}>
          <Download size={15} /> Export
        </button>
      </div>
      {loading ? (
        <div className="companies-loading">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} />
          ))}
        </div>
      ) : (
        <section className="companies-portfolio-grid">
          {filtered.map((c, i) => (
            <article className="company-portfolio-card" key={c.id}>
              <div className="company-portfolio-top">
                <div className={`company-portfolio-logo ${tones[i % 5]}`}>
                  {c.logo_url ? <img src={c.logo_url} alt={`${c.name} logo`} /> : initials(c.name)}
                </div>
                <span className={`company-life ${c.status}`}>
                  <i />
                  {c.status}
                </span>
              </div>
              <span className="company-kind">{c.company_type}</span>
              <h2>{c.name}</h2>
              <p>{c.industry || "Industry not specified"}</p>
              <div className="company-ownership">
                <div>
                  <span>Sanleo ownership</span>
                  <strong>{Number(c.sanleo_share || 0).toFixed(0)}%</strong>
                </div>
                <div>
                  <i style={{ width: `${c.sanleo_share}%` }} />
                </div>
              </div>
              <div className="company-meta">
                <span>
                  <small>COUNTRY</small>
                  <strong>{c.country || "—"}</strong>
                </span>
                <span>
                  <small>CURRENCY</small>
                  <strong>{c.currency || "—"}</strong>
                </span>
              </div>
              <div className="company-portfolio-footer">
                <Link to={`/companies/${c.id}`}>
                  Open workspace <ArrowUpRight size={14} />
                </Link>
                {canManage && (
                  <div>
                    <button title="Edit" onClick={() => edit(c.id)}>
                      <Pencil size={14} />
                    </button>
                    <button title="Delete" onClick={() => remove(c)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="companies-empty">
              <Building2 size={25} />
              <strong>No companies found</strong>
              <span>Change your portfolio filters or add a company.</span>
            </div>
          )}
        </section>
      )}
      {open && (
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
                <h2>{editingId ? "Edit company" : "Add company"}</h2>
                <span>
                  Legal profile, operating context and ownership structure.
                </span>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {error && <div className="company-form-error">{error}</div>}
            <section className="company-form-section">
              <h3>Company information</h3>
              <label className="company-logo-upload">
                <span className="company-logo-preview">{logoPreview ? <img src={logoPreview} alt="Company logo preview" /> : <ImagePlus size={22} />}</span>
                <span><strong>{logoFile ? logoFile.name : 'Add company logo'}</strong><small>PNG, JPG, WebP or SVG · maximum 3 MB</small></span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={chooseLogo} />
              </label>
              <div className="company-form-grid">
                <Field label="Company name" required>
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
                <Field label="Industry" required>
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
                <Field label="Sanleo share %" required>
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.sanleo_share}
                    onChange={(e) => setField("sanleo_share", e.target.value)}
                  />
                </Field>
                <Field label="Lifecycle status">
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
                  <p>All shareholder percentages must total 100%.</p>
                </div>
                <button type="button" onClick={addShare}>
                  <Plus size={14} /> Add shareholder
                </button>
              </div>
              <div className="ownership-total">
                <span>Allocated ownership</span>
                <strong
                  className={
                    Math.abs(total - 100) < 0.001 ? "valid" : "invalid"
                  }
                >
                  {total.toFixed(2)}%
                </strong>
                <div>
                  <i style={{ width: `${Math.min(100, total)}%` }} />
                </div>
              </div>
              <div className="shareholder-editor">
                {form.shareholders.map((s, i) => (
                  <div key={i}>
                    <input
                      placeholder="Shareholder name"
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
                      step="0.01"
                      placeholder="%"
                      value={s.share_percent}
                      onChange={(e) =>
                        setShare(i, "share_percent", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => removeShare(i)}
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
                disabled={saving || Math.abs(total - 100) > 0.001}
              >
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Create company"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function CoStat({ icon: Icon, label, value, note, tone }) {
  return (
    <div className="companies-stat">
      <div className={`companies-stat-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </div>
  );
}
function Field({ label, required, children }) {
  return (
    <label className="company-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
