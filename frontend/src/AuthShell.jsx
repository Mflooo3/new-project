import { useCallback, useEffect, useMemo, useState } from "react";
import App from "./App";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  authLogin,
  authConfirmPasswordReset,
  authLogout,
  authMe,
  authRequestPasswordReset,
  authRegister,
  authRequestOtp,
  authTotpDisable,
  authTotpSetupStart,
  authTotpSetupVerify,
  authTotpStatus,
  authVerifyOtp,
  adminGetPlatformFlags,
  adminUpdatePlatformFlags,
  clearStoredAuth,
  getStoredAuth,
  onAuthStateChange,
  setStoredAuth,
} from "./api";

function toCurrency(value) {
  return Number(value || 0).toFixed(4);
}

function toDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

const PAGE_CHOICES = [
  { key: "v1", label: "v1" },
  { key: "v2", label: "v2" },
  { key: "xintel", label: "xintel" },
];

const SESSION_VERIFY_TIMEOUT_MS = 12000;

function normalizePageAccess(pages, accessVersion = "v1") {
  const version = String(accessVersion || "v1").toLowerCase();
  const set = new Set((Array.isArray(pages) ? pages : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  if (set.has("xintel")) set.add("v2");
  if (set.has("v2")) set.add("v1");
  if (version === "v2") {
    set.add("v1");
    set.add("v2");
    set.add("xintel");
  } else if (version === "v1") {
    set.clear();
    set.add("v1");
  } else if (!set.size) {
    set.add("v1");
  }
  return PAGE_CHOICES.map((row) => row.key).filter((key) => set.has(key));
}

function buildCsv(rows, fields) {
  const header = fields.map((field) => field.label).join(",");
  const lines = rows.map((row) =>
    fields
      .map((field) => {
        const raw = row?.[field.key];
        const text = raw === null || raw === undefined ? "" : String(raw);
        return `"${text.replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

function AuthScreen({ onAuthenticated }) {
  const [tab, setTab] = useState("login");
  const [loginMethod, setLoginMethod] = useState("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [registerForm, setRegisterForm] = useState({ full_name: "", email: "", password: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "", otp_code: "", totp_code: "" });
  const [resetRequestForm, setResetRequestForm] = useState({ email: "" });
  const [resetConfirmForm, setResetConfirmForm] = useState({ token: "", new_password: "" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    const authMode = (params.get("auth") || "").trim().toLowerCase();
    const token = (params.get("token") || "").trim();
    const email = (params.get("email") || "").trim();
    if (email) {
      setResetRequestForm((prev) => ({ ...prev, email }));
      setLoginForm((prev) => ({ ...prev, email }));
    }
    if (authMode === "reset" || token) {
      setTab("reset");
      if (token) {
        setResetConfirmForm((prev) => ({ ...prev, token }));
      }
    }
  }, []);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setError("");
    setNotice("");
    if (nextTab !== "login") {
      setTotpRequired(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setTotpRequired(false);
    try {
      const res = await authRegister(registerForm);
      setNotice(res?.message || "Your registration was submitted and is pending admin approval.");
      setRegisterForm({ full_name: "", email: "", password: "" });
      setTab("login");
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let authPayload;
      if (loginMethod === "password") {
        authPayload = await authLogin({
          email: loginForm.email,
          password: loginForm.password,
          totp_code: loginForm.totp_code || undefined,
        });
      } else {
        authPayload = await authVerifyOtp({ email: loginForm.email, code: loginForm.otp_code, purpose: "login" });
      }
      onAuthenticated(authPayload);
    } catch (err) {
      const message = err.message || "Login failed";
      if (loginMethod === "password" && /authenticator code required/i.test(message)) {
        setTotpRequired(true);
      }
      if (/authenticator-enabled accounts must sign in/i.test(message)) {
        setLoginMethod("password");
        setTotpRequired(true);
        setNotice("This account has Authenticator MFA enabled. Use Email + Password with authenticator code.");
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await authRequestOtp({ email: loginForm.email, purpose: "login" });
      const devCode = res?.dev_code ? ` (DEV OTP: ${res.dev_code})` : "";
      setNotice(`${res?.message || "OTP issued"}${devCode}`);
    } catch (err) {
      setError(err.message || "Failed to request OTP");
    } finally {
      setBusy(false);
    }
  };

  const submitResetRequest = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await authRequestPasswordReset({ email: resetRequestForm.email });
      setNotice(res?.message || "If the account exists, reset instructions were sent by email.");
      setResetRequestForm({ email: "" });
    } catch (err) {
      setError(err.message || "Failed to send password reset email.");
    } finally {
      setBusy(false);
    }
  };

  const submitResetConfirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await authConfirmPasswordReset({
        token: resetConfirmForm.token,
        new_password: resetConfirmForm.new_password,
      });
      setNotice(res?.message || "Password was reset successfully. You can login now.");
      setResetConfirmForm((prev) => ({ ...prev, new_password: "" }));
      switchTab("login");
      if (typeof window !== "undefined") {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("auth");
        cleanUrl.searchParams.delete("token");
        cleanUrl.searchParams.delete("email");
        window.history.replaceState({}, "", cleanUrl.toString());
      }
    } catch (err) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Secure Access</h1>
        <p>Registration + admin approval is required before login.</p>
        <div className="auth-tabs">
          <button className={tab === "login" ? "is-active" : ""} onClick={() => switchTab("login")} type="button">Login</button>
          <button className={tab === "register" ? "is-active" : ""} onClick={() => switchTab("register")} type="button">Register</button>
        </div>

        {tab === "register" ? (
          <form onSubmit={submitRegister} className="auth-form">
            <label>
              Full Name
              <input
                value={registerForm.full_name}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, full_name: event.target.value }))}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={registerForm.email}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={registerForm.password}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={busy}>Submit Registration</button>
          </form>
        ) : tab === "forgot" ? (
          <form onSubmit={submitResetRequest} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={resetRequestForm.email}
                onChange={(event) => setResetRequestForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={busy}>Send Reset Link</button>
          </form>
        ) : tab === "reset" ? (
          <form onSubmit={submitResetConfirm} className="auth-form">
            <label>
              Reset Token
              <input
                value={resetConfirmForm.token}
                onChange={(event) => setResetConfirmForm((prev) => ({ ...prev, token: event.target.value }))}
                required
              />
            </label>
            <label>
              New Password
              <input
                type="password"
                value={resetConfirmForm.new_password}
                onChange={(event) => setResetConfirmForm((prev) => ({ ...prev, new_password: event.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={busy}>Update Password</button>
          </form>
        ) : (
          <form onSubmit={submitLogin} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <div className="auth-methods">
              <button
                type="button"
                className={loginMethod === "password" ? "is-active" : ""}
                onClick={() => {
                  setLoginMethod("password");
                  setError("");
                }}
              >
                Email + Password
              </button>
              <button
                type="button"
                className={loginMethod === "otp" ? "is-active" : ""}
                onClick={() => {
                  setLoginMethod("otp");
                  setTotpRequired(false);
                  setError("");
                }}
              >
                Email OTP
              </button>
            </div>
            {loginMethod === "password" ? (
              <>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Authenticator Code {totpRequired ? "(required)" : "(if enabled)"}
                  <input
                    value={loginForm.totp_code}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, totp_code: event.target.value }))}
                    required={totpRequired}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  OTP
                  <input
                    value={loginForm.otp_code}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, otp_code: event.target.value }))}
                    required
                  />
                </label>
                <button type="button" onClick={requestOtp} disabled={busy || !loginForm.email}>
                  Request OTP
                </button>
              </>
            )}
            <button type="submit" disabled={busy}>Login</button>
            <div className="auth-secondary-actions">
              <button type="button" onClick={() => switchTab("forgot")} disabled={busy}>
                Forgot Password?
              </button>
              <button type="button" onClick={() => switchTab("reset")} disabled={busy}>
                Reset Password
              </button>
            </div>
          </form>
        )}

        {error ? <p className="auth-error">{error}</p> : null}
        {notice ? <p className="auth-notice">{notice}</p> : null}
      </div>
    </div>
  );
}

function AdminConsole({ me }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [usage, setUsage] = useState([]);
  const [usageSummary, setUsageSummary] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [platformFlags, setPlatformFlags] = useState({ openai_enabled: true, x_api_enabled: true, updated_at: null });
  const [savingPlatformFlags, setSavingPlatformFlags] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", slug: "" });
  const [newUser, setNewUser] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "user",
    access_version: "v1",
    tenant_id: "",
    auth_method: "hybrid",
    status: "approved",
  });
  const [filters, setFilters] = useState({ status: "", version: "", tenant_id: "", query_text: "" });
  const [approvalDrafts, setApprovalDrafts] = useState({});

  const isSuperAdmin = me?.role === "super_admin";

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("limit", "800");
      if (filters.status) query.set("status", filters.status);
      if (filters.version) query.set("version", filters.version);
      if (filters.tenant_id) query.set("tenant_id", filters.tenant_id);
      if (filters.query_text) query.set("query_text", filters.query_text);

      const [statsRes, usersRes, tenantsRes, usageRes, usageSummaryRes, auditRes, sessionsRes, platformFlagsRes] = await Promise.all([
        apiGet("/admin/dashboard/stats"),
        apiGet(`/admin/users?${query.toString()}`),
        apiGet("/admin/tenants"),
        apiGet("/admin/api-usage?limit=300"),
        apiGet("/admin/api-usage/summary"),
        apiGet("/admin/audit-logs?limit=400"),
        apiGet("/admin/sessions/active?limit=500"),
        isSuperAdmin ? adminGetPlatformFlags().catch(() => null) : Promise.resolve(null),
      ]);
      setStats(statsRes);
      setUsers(usersRes || []);
      setTenants(tenantsRes || []);
      setUsage(usageRes || []);
      setUsageSummary(usageSummaryRes || []);
      setAuditLogs(auditRes || []);
      setActiveSessions(sessionsRes || []);
      if (platformFlagsRes && typeof platformFlagsRes === "object") {
        setPlatformFlags((prev) => ({ ...prev, ...platformFlagsRes }));
      }
    } catch (err) {
      setError(err.message || "Failed loading admin data");
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.tenant_id, filters.version, filters.query_text, isSuperAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const tenantById = useMemo(() => {
    const map = {};
    for (const row of tenants) map[row.id] = row;
    return map;
  }, [tenants]);

  const applyUserAction = async (fn) => {
    setError("");
    try {
      await fn();
      await loadAll();
    } catch (err) {
      setError(err.message || "Action failed");
    }
  };

  const updatePlatformFlag = async (key, enabled) => {
    if (!isSuperAdmin) return;
    setSavingPlatformFlags(true);
    setError("");
    try {
      const payload =
        key === "openai_enabled"
          ? { openai_enabled: Boolean(enabled) }
          : { x_api_enabled: Boolean(enabled) };
      const next = await adminUpdatePlatformFlags(payload);
      setPlatformFlags((prev) => ({ ...prev, ...(next || payload) }));
      await loadAll();
    } catch (err) {
      setError(err.message || "Failed to update platform flags");
    } finally {
      setSavingPlatformFlags(false);
    }
  };

  const resolveDraftAccessVersion = (row, draft) => draft?.access_version || row?.access_version || "v1";

  const resolveDraftPageAccess = (row, draft) => {
    const version = resolveDraftAccessVersion(row, draft);
    const base = Array.isArray(draft?.page_access) && draft.page_access.length ? draft.page_access : row?.page_access || [];
    return normalizePageAccess(base, version);
  };

  const updateDraftPages = (row, pageKey, checked) => {
    setApprovalDrafts((prev) => {
      const draft = prev[row.id] || {};
      const version = resolveDraftAccessVersion(row, draft);
      const basePages = resolveDraftPageAccess(row, draft);
      const nextPages = new Set(basePages);
      if (checked) nextPages.add(pageKey);
      else nextPages.delete(pageKey);
      const normalized = normalizePageAccess([...nextPages], version);
      return {
        ...prev,
        [row.id]: {
          ...draft,
          access_version: version,
          page_access: normalized,
        },
      };
    });
  };

  const approveUser = async (userId) => {
    const draft = approvalDrafts[userId] || {};
    const tenantId = Number(draft.tenant_id || tenants[0]?.id || 0);
    const accessVersion = draft.access_version || "v1";
    const pageAccess = normalizePageAccess(draft.page_access, accessVersion);
    if (!tenantId) {
      setError("Create/select a tenant before approval.");
      return;
    }
    await applyUserAction(() =>
      apiPatch(`/admin/users/${userId}/approve`, {
        tenant_id: tenantId,
        access_version: accessVersion,
        page_access: pageAccess,
        role: draft.role || "user",
      })
    );
  };

  const saveUserPageAccess = async (row) => {
    const draft = approvalDrafts[row.id] || {};
    const version = resolveDraftAccessVersion(row, draft);
    const pageAccess = resolveDraftPageAccess(row, draft);
    await applyUserAction(async () => {
      if (version !== row.access_version) {
        await apiPatch(`/admin/users/${row.id}/access-version`, { access_version: version });
      }
      await apiPatch(`/admin/users/${row.id}/page-access`, { page_access: pageAccess });
    });
  };

  const createAdminUser = async () => {
    const tenantValue = isSuperAdmin ? Number(newUser.tenant_id || 0) || null : me?.tenant_id || null;
    const accessVersion = newUser.access_version || "v1";
    const payload = {
      full_name: newUser.full_name.trim(),
      email: newUser.email.trim(),
      password: newUser.password || null,
      role: newUser.role || "user",
      access_version: accessVersion,
      page_access: normalizePageAccess([], accessVersion),
      tenant_id: tenantValue,
      auth_method: newUser.auth_method || "hybrid",
      status: newUser.status || "approved",
    };
    if (!payload.full_name || !payload.email) {
      setError("Name and email are required.");
      return;
    }
    await applyUserAction(async () => {
      await apiPost("/admin/users", payload);
      setNewUser({
        full_name: "",
        email: "",
        password: "",
        role: "user",
        access_version: "v1",
        tenant_id: "",
        auth_method: "hybrid",
        status: "approved",
      });
    });
  };

  const deleteUser = async (row) => {
    const ok = window.confirm(`Delete user ${row.email}? This action cannot be undone.`);
    if (!ok) return;
    await applyUserAction(() => apiDelete(`/admin/users/${row.id}`));
  };

  const exportUsageCsv = () => {
    const csv = buildCsv(usage, [
      { key: "id", label: "id" },
      { key: "user_id", label: "user_id" },
      { key: "tenant_id", label: "tenant_id" },
      { key: "provider", label: "provider" },
      { key: "endpoint", label: "endpoint" },
      { key: "usage_units", label: "usage_units" },
      { key: "cost", label: "cost" },
      { key: "request_id", label: "request_id" },
      { key: "created_at", label: "created_at" },
    ]);
    downloadText(`api-usage-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="admin-console">
      <div className="admin-toolbar">
        <h2>Admin Console</h2>
        <button onClick={loadAll} type="button">Refresh</button>
      </div>
      {error ? <div className="admin-error">{error}</div> : null}

      {stats ? (
        <div className="admin-cards">
          <div className="admin-card"><span>Total Users</span><strong>{stats.total_users}</strong></div>
          <div className="admin-card"><span>Pending</span><strong>{stats.pending_users}</strong></div>
          <div className="admin-card"><span>Approved</span><strong>{stats.approved_users}</strong></div>
          <div className="admin-card"><span>Active</span><strong>{stats.active_users}</strong></div>
          <div className="admin-card"><span>Suspended</span><strong>{stats.suspended_users}</strong></div>
          <div className="admin-card"><span>Inactive</span><strong>{stats.inactive_users}</strong></div>
          <div className="admin-card"><span>V1 Users</span><strong>{stats.v1_users}</strong></div>
          <div className="admin-card"><span>V2 Users</span><strong>{stats.v2_users}</strong></div>
          <div className="admin-card"><span>Live Users</span><strong>{stats.live_active_users || 0}</strong></div>
          <div className="admin-card"><span>Live Sessions</span><strong>{stats.live_active_sessions || 0}</strong></div>
          <div className="admin-card"><span>API Usage</span><strong>{stats.total_api_usage}</strong></div>
          <div className="admin-card"><span>API Cost</span><strong>${toCurrency(stats.total_api_cost)}</strong></div>
        </div>
      ) : null}

      {isSuperAdmin ? (
        <section className="admin-section">
          <h3>Platform API Controls</h3>
          <div className="admin-filters">
            <label className="admin-inline-checkbox">
              <input
                type="checkbox"
                checked={Boolean(platformFlags.openai_enabled)}
                disabled={savingPlatformFlags}
                onChange={(event) => updatePlatformFlag("openai_enabled", event.target.checked)}
              />
              OpenAI API Enabled
            </label>
            <label className="admin-inline-checkbox">
              <input
                type="checkbox"
                checked={Boolean(platformFlags.x_api_enabled)}
                disabled={savingPlatformFlags}
                onChange={(event) => updatePlatformFlag("x_api_enabled", event.target.checked)}
              />
              X API Enabled
            </label>
            <span className="admin-meta">Updated: {toDate(platformFlags.updated_at)}</span>
          </div>
        </section>
      ) : null}

      <section className="admin-section">
        <h3>User Filters</h3>
        <div className="admin-filters">
          <input
            placeholder="Search user"
            value={filters.query_text}
            onChange={(event) => setFilters((prev) => ({ ...prev, query_text: event.target.value }))}
          />
          <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
            <option value="">All Status</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="suspended">suspended</option>
            <option value="inactive">inactive</option>
          </select>
          <select value={filters.version} onChange={(event) => setFilters((prev) => ({ ...prev, version: event.target.value }))}>
            <option value="">All Versions</option>
            <option value="v1">v1</option>
            <option value="v2">v2</option>
          </select>
          <select
            value={filters.tenant_id}
            onChange={(event) => setFilters((prev) => ({ ...prev, tenant_id: event.target.value }))}
            disabled={!isSuperAdmin}
          >
            <option value="">All Tenants</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
          <button onClick={loadAll} type="button">Apply</button>
        </div>
      </section>

      <section className="admin-section">
        <h3>Create User</h3>
        <div className="admin-filters">
          <input
            placeholder="Full name"
            value={newUser.full_name}
            onChange={(event) => setNewUser((prev) => ({ ...prev, full_name: event.target.value }))}
          />
          <input
            placeholder="Email"
            type="email"
            value={newUser.email}
            onChange={(event) => setNewUser((prev) => ({ ...prev, email: event.target.value }))}
          />
          <input
            placeholder="Password"
            type="password"
            value={newUser.password}
            onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))}
          />
          <select
            value={newUser.role}
            onChange={(event) => setNewUser((prev) => ({ ...prev, role: event.target.value }))}
            disabled={!isSuperAdmin}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
            {isSuperAdmin ? <option value="super_admin">super_admin</option> : null}
          </select>
          <select
            value={newUser.access_version}
            onChange={(event) => setNewUser((prev) => ({ ...prev, access_version: event.target.value }))}
          >
            <option value="v1">v1</option>
            <option value="v2">v2</option>
          </select>
          <select
            value={newUser.auth_method}
            onChange={(event) => setNewUser((prev) => ({ ...prev, auth_method: event.target.value }))}
          >
            <option value="hybrid">hybrid</option>
            <option value="password">password</option>
            <option value="email_otp">email_otp</option>
            <option value="mobile_auth">mobile_auth</option>
          </select>
          <select
            value={newUser.status}
            onChange={(event) => setNewUser((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="approved">approved</option>
            <option value="pending">pending</option>
            <option value="inactive">inactive</option>
          </select>
          <select
            value={newUser.tenant_id}
            onChange={(event) => setNewUser((prev) => ({ ...prev, tenant_id: event.target.value }))}
            disabled={!isSuperAdmin}
          >
            <option value="">Tenant</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
          <button type="button" onClick={createAdminUser}>Create User</button>
        </div>
      </section>

      <section className="admin-section">
        <h3>Users</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Role</th>
                <th>Version</th>
                <th>TOTP</th>
                <th>Pages</th>
                <th>Tenant</th>
                <th>Last Login</th>
                <th>Last Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr className="table-empty-row">
                  <td colSpan={12}>لا يوجد مستخدمون مطابقون للفلاتر الحالية.</td>
                </tr>
              ) : null}
              {users.map((row) => {
                const draft = approvalDrafts[row.id] || {};
                return (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.full_name}</td>
                    <td>{row.email}</td>
                    <td>{row.status}</td>
                    <td>{row.role}</td>
                    <td>{row.access_version}</td>
                    <td>{row.totp_enabled ? "enabled" : "disabled"}</td>
                    <td>
                      <div className="admin-page-access">
                        {(resolveDraftPageAccess(row, draft).length ? resolveDraftPageAccess(row, draft) : ["v1"]).map((pageKey) => (
                          <span key={`${row.id}-page-chip-${pageKey}`} className="admin-page-chip">
                            {pageKey}
                          </span>
                        ))}
                        <div className="admin-page-checkboxes">
                          {PAGE_CHOICES.map((choice) => (
                            <label key={`${row.id}-page-${choice.key}`}>
                              <input
                                type="checkbox"
                                checked={resolveDraftPageAccess(row, draft).includes(choice.key)}
                                onChange={(event) => updateDraftPages(row, choice.key, event.target.checked)}
                              />
                              {choice.label}
                            </label>
                          ))}
                        </div>
                        {row.status !== "pending" ? (
                          <button type="button" onClick={() => saveUserPageAccess(row)}>
                            Save Pages
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>{row.tenant_id ? tenantById[row.tenant_id]?.name || row.tenant_id : "-"}</td>
                    <td>{toDate(row.last_login_at)}</td>
                    <td>{toDate(row.last_active_at)}</td>
                    <td>
                      <div className="admin-actions">
                        {row.status === "pending" ? (
                          <>
                            <select
                              value={draft.tenant_id || ""}
                              onChange={(event) =>
                                setApprovalDrafts((prev) => ({ ...prev, [row.id]: { ...prev[row.id], tenant_id: Number(event.target.value || 0) } }))
                              }
                            >
                              <option value="">Tenant</option>
                              {tenants.map((tenant) => (
                                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                              ))}
                            </select>
                            <select
                              value={resolveDraftAccessVersion(row, draft)}
                              onChange={(event) =>
                                setApprovalDrafts((prev) => {
                                  const current = prev[row.id] || {};
                                  const nextVersion = event.target.value;
                                  return {
                                    ...prev,
                                    [row.id]: {
                                      ...current,
                                      access_version: nextVersion,
                                      page_access: normalizePageAccess(current.page_access || row.page_access, nextVersion),
                                    },
                                  };
                                })
                              }
                            >
                              <option value="v1">v1</option>
                              <option value="v2">v2</option>
                            </select>
                            <select
                              value={draft.role || "user"}
                              onChange={(event) =>
                                setApprovalDrafts((prev) => ({ ...prev, [row.id]: { ...prev[row.id], role: event.target.value } }))
                              }
                            >
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                              <option value="super_admin">super_admin</option>
                            </select>
                            <button type="button" onClick={() => approveUser(row.id)}>Approve</button>
                            <button type="button" onClick={() => applyUserAction(() => apiPatch(`/admin/users/${row.id}/reject`, { reason: "Rejected by admin" }))}>Reject</button>
                            <button type="button" onClick={() => deleteUser(row)}>Delete</button>
                          </>
                        ) : (
                          <>
                            <select
                              value={resolveDraftAccessVersion(row, draft)}
                              onChange={(event) =>
                                setApprovalDrafts((prev) => {
                                  const current = prev[row.id] || {};
                                  const nextVersion = event.target.value;
                                  return {
                                    ...prev,
                                    [row.id]: {
                                      ...current,
                                      access_version: nextVersion,
                                      page_access: normalizePageAccess(current.page_access || row.page_access, nextVersion),
                                    },
                                  };
                                })
                              }
                            >
                              <option value="v1">v1</option>
                              <option value="v2">v2</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                applyUserAction(async () => {
                                  const nextVersion = resolveDraftAccessVersion(row, draft);
                                  if (nextVersion !== row.access_version) {
                                    await apiPatch(`/admin/users/${row.id}/access-version`, { access_version: nextVersion });
                                  }
                                })
                              }
                            >
                              Save Version
                            </button>
                            <button type="button" onClick={() => applyUserAction(() => apiPatch(`/admin/users/${row.id}/suspend`, {}))}>Suspend</button>
                            <button type="button" onClick={() => applyUserAction(() => apiPatch(`/admin/users/${row.id}/reactivate`, {}))}>Reactivate</button>
                            <button type="button" onClick={() => applyUserAction(() => apiPatch(`/admin/users/${row.id}/auth-reset`, { reset_password: false, reset_otp: true }))}>Reset Auth</button>
                            <button type="button" onClick={() => applyUserAction(() => apiPatch(`/admin/users/${row.id}/auth-reset`, { reset_password: false, reset_otp: false, reset_totp: true }))}>Reset TOTP</button>
                            <button type="button" onClick={() => deleteUser(row)}>Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h3>Tenants</h3>
        <div className="admin-tenants">
          <ul>
            {tenants.length === 0 ? <li className="table-empty-row">لا توجد مساحات (Tenants) مضافة بعد.</li> : null}
            {tenants.map((tenant) => (
              <li key={tenant.id}>
                <strong>{tenant.name}</strong> ({tenant.slug}) - {tenant.status}
              </li>
            ))}
          </ul>
          {isSuperAdmin ? (
            <div className="admin-create-tenant">
              <input
                placeholder="Tenant name"
                value={newTenant.name}
                onChange={(event) => setNewTenant((prev) => ({ ...prev, name: event.target.value }))}
              />
              <input
                placeholder="tenant-slug"
                value={newTenant.slug}
                onChange={(event) => setNewTenant((prev) => ({ ...prev, slug: event.target.value }))}
              />
              <button
                type="button"
                onClick={() =>
                  applyUserAction(async () => {
                    await apiPost("/admin/tenants", { ...newTenant, status: "active" });
                    setNewTenant({ name: "", slug: "" });
                  })
                }
              >
                Create Tenant
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>API Usage</h3>
          <button type="button" onClick={exportUsageCsv}>Export CSV</button>
        </div>
        <div className="admin-grid-2">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Tenant</th>
                  <th>Calls</th>
                  <th>Units</th>
                  <th>Cost</th>
                </tr>
              </thead>
            <tbody>
                {usageSummary.length === 0 ? (
                  <tr className="table-empty-row">
                    <td colSpan={5}>لا توجد بيانات استخدام ضمن النطاق الحالي.</td>
                  </tr>
                ) : null}
                {usageSummary.map((row, idx) => (
                  <tr key={`${row.user_id}-${row.tenant_id}-${idx}`}>
                    <td>{row.user_id || "-"}</td>
                    <td>{row.tenant_id || "-"}</td>
                    <td>{row.calls}</td>
                    <td>{row.usage_units}</td>
                    <td>${toCurrency(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Provider</th>
                  <th>Endpoint</th>
                  <th>Units</th>
                  <th>Cost</th>
                </tr>
              </thead>
            <tbody>
                {usage.length === 0 ? (
                  <tr className="table-empty-row">
                    <td colSpan={6}>لا توجد سجلات استدعاء API بعد.</td>
                  </tr>
                ) : null}
                {usage.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td>{toDate(row.created_at)}</td>
                    <td>{row.user_id || "-"}</td>
                    <td>{row.provider}</td>
                    <td>{row.endpoint}</td>
                    <td>{row.usage_units}</td>
                    <td>${toCurrency(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="admin-section">
        <h3>Active Live Sessions</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Session ID</th>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Tenant</th>
                <th>Version</th>
                <th>Pages</th>
                <th>IP</th>
                <th>Last Seen</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.length === 0 ? (
                <tr className="table-empty-row">
                  <td colSpan={10}>لا توجد جلسات نشطة حاليًا.</td>
                </tr>
              ) : null}
              {activeSessions.map((row) => (
                <tr key={`${row.session_id}-${row.user_id}`}>
                  <td>{row.session_id}</td>
                  <td>{row.full_name}</td>
                  <td>{row.email}</td>
                  <td>{row.role}</td>
                  <td>{row.tenant_id || "-"}</td>
                  <td>{row.access_version}</td>
                  <td>{(row.page_access || []).join(", ") || "-"}</td>
                  <td>{row.ip_address || "-"}</td>
                  <td>{toDate(row.last_seen_at)}</td>
                  <td>{toDate(row.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h3>Audit Logs</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Tenant</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr className="table-empty-row">
                  <td colSpan={6}>لا توجد سجلات تدقيق ضمن النطاق الحالي.</td>
                </tr>
              ) : null}
              {auditLogs.map((row) => (
                <tr key={row.id}>
                  <td>{toDate(row.created_at)}</td>
                  <td>{row.action}</td>
                  <td>{row.actor_user_id || "-"}</td>
                  <td>{row.target_user_id || "-"}</td>
                  <td>{row.tenant_id || "-"}</td>
                  <td>{row.metadata_json || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {loading ? <div className="admin-loading">Loading...</div> : null}
    </div>
  );
}

function SecuritySettings({ me, onProfileRefresh }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState(null);
  const [setupForm, setSetupForm] = useState({ password: "", code: "" });
  const [disableForm, setDisableForm] = useState({ password: "", code: "" });
  const [setupPayload, setSetupPayload] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await authTotpStatus();
      setStatus(row);
    } catch (err) {
      setError(err.message || "Failed loading TOTP status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runAction = async (fn) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await loadStatus();
      await onProfileRefresh?.();
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    await runAction(async () => {
      const payload = await authTotpSetupStart({ password: setupForm.password });
      setSetupPayload(payload);
      setNotice("Authenticator setup started. Scan QR and verify the 6-digit code.");
    });
  };

  const verifySetup = async () => {
    await runAction(async () => {
      await authTotpSetupVerify({ code: setupForm.code });
      setSetupPayload(null);
      setSetupForm({ password: "", code: "" });
      setNotice("Two-factor authentication enabled successfully.");
    });
  };

  const disableTotp = async () => {
    await runAction(async () => {
      await authTotpDisable({ password: disableForm.password, code: disableForm.code || undefined });
      setDisableForm({ password: "", code: "" });
      setSetupPayload(null);
      setNotice("Two-factor authentication disabled.");
    });
  };

  return (
    <div className="admin-console">
      <div className="admin-toolbar">
        <h2>Security Settings</h2>
        <button onClick={loadStatus} type="button">Refresh</button>
      </div>
      {loading ? <div className="admin-loading">Loading...</div> : null}
      {error ? <div className="admin-error">{error}</div> : null}
      {notice ? <div className="auth-notice">{notice}</div> : null}

      <section className="admin-section">
        <h3>Two-Factor Authentication (TOTP)</h3>
        <div className="admin-cards">
          <div className="admin-card"><span>Status</span><strong>{status?.enabled ? "Enabled" : "Disabled"}</strong></div>
          <div className="admin-card"><span>Enabled At</span><strong>{toDate(status?.enabled_at)}</strong></div>
          <div className="admin-card"><span>Last Used</span><strong>{toDate(status?.last_used)}</strong></div>
          <div className="admin-card"><span>User</span><strong>{me?.email || "-"}</strong></div>
        </div>
      </section>

      {!status?.enabled ? (
        <section className="admin-section">
          <h3>Enable Two-Factor Authentication</h3>
          <div className="admin-filters">
            <input
              type="password"
              placeholder="Confirm password"
              value={setupForm.password}
              onChange={(event) => setSetupForm((prev) => ({ ...prev, password: event.target.value }))}
            />
            <button type="button" onClick={startSetup} disabled={busy || !setupForm.password}>
              Generate QR
            </button>
          </div>
          {setupPayload ? (
            <div className="admin-tenants">
              <p><strong>Manual key:</strong> {setupPayload.manual_entry_key}</p>
              <img src={setupPayload.qr_code_data_url} alt="TOTP QR" style={{ maxWidth: "220px", background: "#fff", padding: "6px", borderRadius: "8px" }} />
              <div className="admin-filters">
                <input
                  placeholder="Enter authenticator code"
                  value={setupForm.code}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, code: event.target.value }))}
                />
                <button type="button" onClick={verifySetup} disabled={busy || !setupForm.code}>
                  Verify & Enable
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="admin-section">
          <h3>Disable Two-Factor Authentication</h3>
          <div className="admin-filters">
            <input
              type="password"
              placeholder="Confirm password"
              value={disableForm.password}
              onChange={(event) => setDisableForm((prev) => ({ ...prev, password: event.target.value }))}
            />
            <input
              placeholder="Current authenticator code"
              value={disableForm.code}
              onChange={(event) => setDisableForm((prev) => ({ ...prev, code: event.target.value }))}
            />
            <button type="button" onClick={disableTotp} disabled={busy || !disableForm.password || !disableForm.code}>
              Disable TOTP
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default function AuthShell() {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [me, setMe] = useState(auth?.user || null);
  const [view, setView] = useState("workspace");
  const [loadingMe, setLoadingMe] = useState(Boolean(auth?.access_token));
  const [sessionError, setSessionError] = useState("");
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const pushAuthDiag = useCallback((stage, extra = {}) => {
    if (import.meta.env.PROD || typeof window === "undefined") return;
    const current = Array.isArray(window.__AUTH_DIAGNOSTICS__) ? window.__AUTH_DIAGNOSTICS__ : [];
    const next = [...current, { stage, at: new Date().toISOString(), ...extra }].slice(-120);
    window.__AUTH_DIAGNOSTICS__ = next;
  }, []);

  const refreshProfile = useCallback(async () => {
    const activeAuth = getStoredAuth() || auth;
    if (!activeAuth?.access_token) {
      throw new Error("No active session token");
    }
    const timeoutPromise = new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error("Session verification timed out."));
      }, SESSION_VERIFY_TIMEOUT_MS);
    });
    pushAuthDiag("session_verify_started");
    const user = await Promise.race([authMe(), timeoutPromise]);
    setMe(user);
    setAuth((prev) => {
      const merged = { ...(prev || activeAuth || {}), user };
      setStoredAuth(merged);
      return merged;
    });
    setSessionError("");
    pushAuthDiag("session_verify_completed", { user_id: user?.id, tenant_id: user?.tenant_id });
    return user;
  }, [auth?.access_token, pushAuthDiag]);

  useEffect(() => {
    const unsubscribe = onAuthStateChange((nextAuth) => {
      pushAuthDiag("auth_state_changed", { has_token: Boolean(nextAuth?.access_token) });
      setAuth(nextAuth || null);
      if (!nextAuth?.access_token) {
        setMe(null);
        setLoadingMe(false);
        setSessionError("");
        setView("workspace");
        return;
      }
      if (nextAuth?.user) {
        setMe(nextAuth.user);
      }
    });
    return unsubscribe;
  }, [pushAuthDiag]);

  useEffect(() => {
    let active = true;
    if (!auth?.access_token) {
      setMe(null);
      setLoadingMe(false);
      setSessionError("");
      return undefined;
    }
    setLoadingMe(true);
    setSessionError("");
    refreshProfile()
      .catch((err) => {
        if (!active) return;
        const message = err?.message || "Session verification failed";
        if (/timed out/i.test(String(message))) {
          pushAuthDiag("session_verify_timeout", { message });
        } else {
          pushAuthDiag("session_verify_failed", { message });
        }
        if (/401|403|unauthorized|Authentication required|token|session/i.test(String(message))) {
          clearStoredAuth();
          setAuth(null);
          setMe(null);
          setSessionError("");
          return;
        }
        setSessionError(message);
      })
      .finally(() => {
        if (active) setLoadingMe(false);
      });
    return () => {
      active = false;
    };
  }, [auth?.access_token, refreshProfile]);

  const handleAuthenticated = (payload) => {
    setAuth(payload);
    setMe(payload?.user || null);
    setSessionError("");
    setView("workspace");
  };

  const handleLogout = () => {
    pushAuthDiag("logout_invoked");
    const refreshToken = auth?.refresh_token || getStoredAuth()?.refresh_token || null;
    clearStoredAuth();
    setAuth(null);
    setMe(null);
    setSessionError("");
    setLoadingMe(false);
    setView("workspace");
    void authLogout(refreshToken);
    pushAuthDiag("logout_completed");
  };

  const retryVerification = () => {
    if (!auth?.access_token) return;
    pushAuthDiag("session_verify_retry");
    setLoadingMe(true);
    setSessionError("");
    refreshProfile()
      .catch((err) => {
        const message = err?.message || "Session verification failed";
        setSessionError(message);
      })
      .finally(() => setLoadingMe(false));
  };

  if (auth?.access_token && !me) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Verifying session...</h1>
          <p>{sessionError || "Checking your identity and workspace access."}</p>
          <div className="auth-tabs">
            <button type="button" onClick={retryVerification} disabled={loadingMe}>
              Retry
            </button>
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </div>
          {loadingMe ? <p className="admin-loading">Verifying session...</p> : null}
        </div>
      </div>
    );
  }

  if (!auth?.access_token || !me) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="secure-shell">
      <header className="secure-header">
        <div className="secure-user">
          <strong>{me.full_name}</strong>
          <span>{me.email}</span>
          <span>role: {me.role}</span>
          <span>tenant: {me.tenant_id || "-"}</span>
          <span>version: {me.access_version}</span>
          <span>pages: {(me.page_access || []).join(", ") || "-"}</span>
          <span>status: {me.status}</span>
        </div>
        <div className="secure-actions">
          <button type="button" className={view === "workspace" ? "is-active" : ""} onClick={() => setView("workspace")}>
            Workspace
          </button>
          <button type="button" className={view === "security" ? "is-active" : ""} onClick={() => setView("security")}>
            Security
          </button>
          {isAdmin ? (
            <button type="button" className={view === "admin" ? "is-active" : ""} onClick={() => setView("admin")}>
              Admin Console
            </button>
          ) : null}
          <button type="button" onClick={handleLogout}>Logout</button>
        </div>
      </header>
      {loadingMe ? (
        <div className="admin-loading">
          Verifying session...
          <button type="button" className="btn btn-small btn-ghost" onClick={retryVerification}>
            Retry
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      ) : null}
      {sessionError ? <div className="admin-error">{sessionError}</div> : null}
      {view === "admin" && isAdmin ? <AdminConsole me={me} /> : null}
      {view === "security" ? <SecuritySettings me={me} onProfileRefresh={refreshProfile} /> : null}
      {view === "workspace" ? <App currentUser={me} /> : null}
    </div>
  );
}
