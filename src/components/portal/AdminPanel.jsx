import { useState, useEffect, useCallback } from 'react';
import RefreshButton from '../RefreshButton';

const ADMIN_API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

// ════════════════════════════════════════
//   ADMIN TAX SECTION
// ════════════════════════════════════════

function AdminTaxSection({ isMobile, glass, authHeaders }) {
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [fundSummary, setFundSummary] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [msg, setMsg] = useState('');

  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();

  const [error, setError] = useState('');

  const fetchFundSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const [sumRes, allocRes] = await Promise.all([
        fetch(`${API}/admin/tax/fund-summary/${taxYear}`, { headers: authHeaders }),
        fetch(`${API}/admin/tax/allocations/${taxYear}`, { headers: authHeaders }),
      ]);
      if (sumRes.ok) { const d = await sumRes.json(); setFundSummary(d.summary || null); }
      else { console.warn('[TaxAdmin] Fund summary fetch failed:', sumRes.status); }
      if (allocRes.ok) { const d = await allocRes.json(); setAllocations(d.allocations || []); }
      else { console.warn('[TaxAdmin] Allocations fetch failed:', allocRes.status); }
    } catch (err) { console.error('[TaxAdmin] Fetch error:', err); setError(err.message); }
    setLoading(false);
  };

  useEffect(() => { fetchFundSummary(); }, [taxYear]);

  const computeAllocations = async () => {
    setComputing(true);
    setMsg('');
    setError('');
    try {
      const r = await fetch(`${API}/admin/tax/allocations/${taxYear}`, { method: 'POST', headers: authHeaders });
      if (r.ok) {
        const d = await r.json();
        setAllocations(d.allocations || []);
        setFundSummary(d.fundTotals || fundSummary);
        setMsg(`K-1 allocations computed for ${d.allocations?.length || 0} investors`);
        setTimeout(() => setMsg(''), 4000);
      } else {
        const errData = await r.json().catch(() => ({}));
        setError(errData.error || `Server returned ${r.status}`);
      }
    } catch (err) { setError(`Network error: ${err.message}`); }
    setComputing(false);
  };

  const fs = fundSummary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>§ Fund Tax Administration</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={taxYear} onChange={e => setTaxYear(parseInt(e.target.value))} style={{
            padding: '8px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(30,30,34,0.9)', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none',
          }}>
            {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={computeAllocations} disabled={computing} style={{
            padding: '8px 18px', borderRadius: 12, border: 'none', cursor: computing ? 'wait' : 'pointer',
            background: 'linear-gradient(135deg, #A855F7, #7C3AED)', color: '#fff', fontSize: 12, fontWeight: 700,
            opacity: computing ? 0.6 : 1,
          }}>
            {computing ? 'Computing...' : 'Compute K-1 Allocations'}
          </button>
        </div>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(34,197,94,0.1)', color: '#22C55E', fontSize: 12 }}>{msg}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 12 }}>⚠ {error}</div>}

      {loading && <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.3)' }}>Loading fund tax data...</div>}

      {/* Fund-Level Summary (Form 1065) */}
      {!loading && fundSummary && (
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 14 }}>Fund Summary — Form 1065 Data</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Net Gain/Loss', value: fs.netGainLoss, color: (fs.netGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Short-Term G/L', value: fs.shortTermGainLoss, color: (fs.shortTermGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Long-Term G/L', value: fs.longTermGainLoss, color: (fs.longTermGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Total Trades', value: fs.totalTransactions, color: '#00D4FF', noPrefix: true },
            ].map((k, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 14, background: 'rgba(30,30,34,0.5)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.noPrefix ? '' : '$'}{typeof k.value === 'number' ? k.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            <span>Wash Sales: <b style={{ color: '#F59E0B' }}>{fs.washSaleEvents || 0}</b> (${(fs.totalWashSaleDisallowed || 0).toLocaleString()} disallowed)</span>
            <span>Crypto: <b style={{ color: '#00D4FF' }}>{fs.byAssetClass?.crypto?.trades || 0}</b> trades (${(fs.byAssetClass?.crypto?.gainLoss || 0).toLocaleString()})</span>
            <span>Equity: <b style={{ color: '#A855F7' }}>{fs.byAssetClass?.equity?.trades || 0}</b> trades (${(fs.byAssetClass?.equity?.gainLoss || 0).toLocaleString()})</span>
          </div>
          {fs.byAgent && Object.keys(fs.byAgent).length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(fs.byAgent).map(([agent, data]) => (
                <div key={agent} style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)' }}>{agent}:</span>{' '}
                  <span style={{ color: data.gainLoss >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>${data.gainLoss.toLocaleString()}</span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>({data.trades} trades)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* K-1 Investor Allocations */}
      {!loading && allocations.length > 0 && (
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 14 }}>K-1 Investor Allocations — {taxYear}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allocations.map(a => (
              <div key={a.user_id} style={{
                padding: 16, borderRadius: 16, background: 'rgba(30,30,34,0.5)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{a.investor_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{a.investor_email} — {a.ownership_pct}% ownership</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: (a.allocated_net_gain_loss || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                    ${(a.allocated_net_gain_loss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 6, fontSize: 11 }}>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>ST Gains:</span> <span style={{ color: '#10B981' }}>${(a.allocated_short_term_gains || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>ST Losses:</span> <span style={{ color: '#EF4444' }}>${(a.allocated_short_term_losses || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>LT Gains:</span> <span style={{ color: '#10B981' }}>${(a.allocated_long_term_gains || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>LT Losses:</span> <span style={{ color: '#EF4444' }}>${(a.allocated_long_term_losses || 0).toLocaleString()}</span></div>
                </div>
                {(a.allocated_wash_sale_disallowed || 0) > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#F59E0B' }}>
                    Wash sale disallowed: ${a.allocated_wash_sale_disallowed.toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !fundSummary && allocations.length === 0 && (
        <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>§</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No tax data for {taxYear} yet</div>
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 4 }}>Tax lots are created automatically as trades execute</div>
        </div>
      )}
    </div>
  );
}

function AdminPanel({ investor, isMobile }) {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [activeSection, setActiveSection] = useState('requests'); // 'requests' | 'users' | 'health' | 'qa' | 'feedback'
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [qaReports, setQaReports] = useState([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(null);
  const [adminFeedback, setAdminFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [selectedWithdrawalUser, setSelectedWithdrawalUser] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', firstName: '', lastName: '', role: 'investor' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [complianceData, setComplianceData] = useState(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState('');

  const token = (() => {
    try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; }
  })();

  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests`, { headers: authHeaders });
      if (resp.status === 401 || resp.status === 403) {
        // Token may be stale from old deploy — try re-login silently
        setError("Session expired. Please sign out and sign back in to refresh admin access.");
        setLoading(false);
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data)) setRequests(data);
      else setError(data.error || "Failed to load requests.");
    } catch {
      setError("Network error loading requests.");
    }
    setLoading(false);
  }, [token]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users`, { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) setUsers(data);
      }
    } catch { /* silent */ }
    setUsersLoading(false);
  }, [token]);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/health`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setHealthData(data); }
    } catch { /* silent */ }
    setHealthLoading(false);
  }, [token]);

  const fetchQaReports = useCallback(async () => {
    setQaLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/qa-reports`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); if (Array.isArray(data)) setQaReports(data); }
    } catch { /* silent */ }
    setQaLoading(false);
  }, [token]);

  const fetchAdminFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/feedback`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setAdminFeedback(data.feedback || []); }
    } catch { /* silent */ }
    setFeedbackLoading(false);
  }, [token]);

  const updateFeedbackStatus = async (fbId, status, adminNotes) => {
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/feedback/${fbId}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ status, ...(adminNotes !== undefined ? { adminNotes } : {}) }),
      });
      if (resp.ok) fetchAdminFeedback();
    } catch { /* silent */ }
  };

  const fetchAdminWithdrawals = useCallback(async () => {
    setWithdrawalsLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/withdrawals`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setAdminWithdrawals(data.withdrawals || []); }
    } catch { /* silent */ }
    setWithdrawalsLoading(false);
  }, [token]);

  const updateWithdrawalStatus = async (wrId, status, adminNotes) => {
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/withdrawals/${wrId}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ status, ...(adminNotes !== undefined ? { adminNotes } : {}) }),
      });
      if (resp.ok) fetchAdminWithdrawals();
    } catch { /* silent */ }
  };

  const fetchCompliance = async (retries = 2) => {
    setComplianceLoading(true);
    setComplianceError('');
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(`${ADMIN_API_BASE}/compliance/dashboard`, { headers: authHeaders, signal: controller.signal });
        clearTimeout(timer);
        if (resp.ok) {
          setComplianceData(await resp.json());
          setComplianceLoading(false);
          return;
        }
        if (resp.status === 502 || resp.status === 503) {
          // Server cold-starting — wait and retry
          if (attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
          setComplianceError('Server is starting up. Please try again in a moment.');
        } else if (resp.status === 401 || resp.status === 403) {
          setComplianceError('Session expired or insufficient permissions. Please sign out and back in.');
        } else {
          setComplianceError(`Server returned ${resp.status}. Please retry.`);
        }
      } catch (e) {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
        setComplianceError(e.name === 'AbortError' ? 'Request timed out — server may be waking up. Please retry.' : `Network error: ${e.message}`);
      }
    }
    setComplianceLoading(false);
  };

  useEffect(() => { fetchRequests(); fetchUsers(); fetchHealth(); fetchQaReports(); fetchAdminFeedback(); fetchAdminWithdrawals(); }, [fetchRequests, fetchUsers, fetchHealth, fetchQaReports, fetchAdminFeedback, fetchAdminWithdrawals]);

  // Auto-refresh health every 30s when on health tab
  useEffect(() => {
    if (activeSection !== 'health') return;
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [activeSection, fetchHealth]);

  // Auto-refresh compliance every 60s when on compliance tab
  useEffect(() => {
    if (activeSection !== 'compliance') return;
    if (!complianceData && !complianceLoading) fetchCompliance(3);
    const interval = setInterval(() => fetchCompliance(1), 60000);
    return () => clearInterval(interval);
  }, [activeSection]);

  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const handleAction = async (requestId, status) => {
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await resp.json();
      if (data.success) {
        // Remove from list — approved/denied requests are no longer shown
        setRequests(prev => prev.filter(r => r.id !== requestId));
        const action = status === 'approved' ? 'Approved' : 'Denied';
        if (data.emailSent) {
          setActionSuccess(`${action} — notification email sent to ${data.request?.email || 'user'}`);
        } else {
          const emailNote = data.emailError ? ` (Email failed: ${data.emailError})` : ' (No email sent)';
          setActionSuccess(`${action}${emailNote}`);
        }
      } else {
        setActionError(data.error || `Failed to ${status === 'approved' ? 'approve' : 'deny'} request.`);
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleResendEmail = async (requestId, email) => {
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}/resend-email`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await resp.json();
      if (data.emailSent) {
        setActionSuccess(`Approval email re-sent to ${email}`);
      } else {
        setActionError(`Email failed: ${data.emailError || 'Unknown error'}`);
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleDeleteRequest = async (requestId, email) => {
    if (!window.confirm(`Delete access request for ${email}? This cannot be undone.`)) return;
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await resp.json();
      if (data.success) {
        setRequests(prev => prev.filter(r => r.id !== requestId));
        setActionSuccess(`Deleted request for ${email}`);
      } else {
        setActionError(data.error || 'Failed to delete request.');
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Permanently delete ${userEmail}? This will close all their positions and remove their account. This action cannot be undone.`)) return;
    setDeleteLoading(userId);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users/${userId}`, {
        method: 'DELETE', headers: authHeaders,
      });
      const data = await resp.json();
      if (data.success) {
        setUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        alert(data.error || 'Failed to delete user');
      }
    } catch { alert('Network error deleting user'); }
    setDeleteLoading(null);
  };

  const [roleLoading, setRoleLoading] = useState(null);
  const handleChangeRole = async (userId, userEmail, newRole) => {
    if (!window.confirm(`Change ${userEmail} role to "${newRole}"?`)) return;
    setRoleLoading(userId);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ role: newRole }),
      });
      const data = await resp.json();
      if (data.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      } else {
        alert(data.error || 'Failed to change role');
      }
    } catch { alert('Network error changing role'); }
    setRoleLoading(null);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError('');
    setCreateSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify(createForm),
      });
      const data = await resp.json();
      if (data.success) {
        setCreateSuccess(`Account created for ${data.user.email} (${data.user.role}) — Temporary Password: ${data.tempPassword}`);
        setCreateForm({ email: '', firstName: '', lastName: '', role: 'investor' });
        fetchUsers(); // Refresh user list
      } else {
        setCreateError(data.error || 'Failed to create user');
      }
    } catch { setCreateError('Network error creating user'); }
    setCreateLoading(false);
  };

  const glass = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 20,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.35)",
  };

  const pending = requests.filter(r => r.status === 'pending');

  const statusBadge = (status) => {
    const colors = { pending: '#F59E0B', approved: '#10B981', denied: '#EF4444', admin: '#A855F7', investor: '#00D4FF' };
    return {
      display: 'inline-block', padding: '3px 10px', borderRadius: 8,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      background: `${colors[status] || '#666'}20`, color: colors[status] || '#666',
      textTransform: 'uppercase',
    };
  };

  const tabStyle = (active) => ({
    padding: isMobile ? '10px 14px' : '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? '#00D4FF' : 'rgba(255,255,255,0.4)',
    fontSize: isMobile ? 11 : 13, fontWeight: 600, transition: 'all 0.2s',
    whiteSpace: 'nowrap', flexShrink: 0, minHeight: isMobile ? 44 : 'auto',
    touchAction: 'manipulation',
  });

  return (
    <div style={{ padding: 0 }}>
      <h2 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>Admin Panel</h2>
      <p style={{ fontSize: isMobile ? 12 : 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 14px' }}>Manage users, access requests, and platform settings</p>

      {/* Tab Switcher — horizontally scrollable on mobile */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 6,
        marginLeft: isMobile ? -16 : 0,
        marginRight: isMobile ? -16 : 0,
        paddingLeft: isMobile ? 16 : 0,
        paddingRight: isMobile ? 16 : 0,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        <button onClick={() => setActiveSection('requests')} style={tabStyle(activeSection === 'requests')}>
          Access Requests {pending.length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: '#F59E0B', color: '#000', fontSize: 10, fontWeight: 800 }}>{pending.length}</span>}
        </button>
        <button onClick={() => setActiveSection('users')} style={tabStyle(activeSection === 'users')}>
          User Accounts <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800 }}>{users.length}</span>
        </button>
        <button onClick={() => { setActiveSection('health'); fetchHealth(); }} style={tabStyle(activeSection === 'health')}>
          Health
        </button>
        <button onClick={() => { setActiveSection('qa'); fetchQaReports(); }} style={tabStyle(activeSection === 'qa')}>
          QA {qaReports.length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(168,85,247,0.3)', color: '#A855F7', fontSize: 10, fontWeight: 800 }}>{qaReports.length}</span>}
        </button>
        <button onClick={() => { setActiveSection('feedback'); fetchAdminFeedback(); }} style={tabStyle(activeSection === 'feedback')}>
          Feedback {adminFeedback.filter(f => f.status === 'new').length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.25)', color: '#EF4444', fontSize: 10, fontWeight: 800 }}>{adminFeedback.filter(f => f.status === 'new').length} new</span>}
        </button>
        <button onClick={() => { setActiveSection('withdrawals'); fetchAdminWithdrawals(); }} style={tabStyle(activeSection === 'withdrawals')}>
          Withdrawals {adminWithdrawals.filter(w => w.status === 'pending').length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.3)', color: '#F59E0B', fontSize: 10, fontWeight: 800 }}>{adminWithdrawals.filter(w => w.status === 'pending').length}</span>}
        </button>
        <button onClick={() => setActiveSection('tax-admin')} style={tabStyle(activeSection === 'tax-admin')}>
          § Tax Admin
        </button>
        <button onClick={() => { setActiveSection('compliance'); fetchCompliance(); }} style={tabStyle(activeSection === 'compliance')}>
          🛡️ Compliance
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Users', count: users.length, color: '#00D4FF' },
          { label: 'Pending Requests', count: pending.length, color: '#F59E0B' },
        ].map(s => (
          <div key={s.label} style={{ ...glass, padding: '14px 20px', flex: '1 1 100px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: '#EF4444', textAlign: 'center', padding: 16, marginBottom: 16, ...glass, border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
      {actionError && <div style={{ color: '#EF4444', textAlign: 'center', padding: 12, marginBottom: 16, ...glass, border: '1px solid rgba(239,68,68,0.2)', fontSize: 13 }}>{actionError}</div>}
      {actionSuccess && <div style={{ color: '#10B981', textAlign: 'center', padding: 12, marginBottom: 16, ...glass, border: '1px solid rgba(16,185,129,0.2)', fontSize: 13 }}>{actionSuccess}</div>}

      {/* ═══════ ACCESS REQUESTS SECTION ═══════ */}
      {activeSection === 'requests' && (
        <>
          {loading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading requests...</div>}

          {!loading && !error && pending.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◇</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No pending access requests</div>
            </div>
          )}

          {pending.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F59E0B', margin: '0 0 12px' }}>Pending Requests ({pending.length})</h3>
              {pending.map(r => (
                <div key={r.id} style={{ ...glass, padding: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#00D4FF', flexShrink: 0,
                  }}>{(r.first_name?.[0] || '') + (r.last_name?.[0] || '')}</div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                      {r.first_name} {r.last_name}
                      {r.previously_rejected && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: 10, fontWeight: 700 }}>
                          PREVIOUSLY REJECTED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{r.email}</div>
                    {r.previously_rejected && r.previous_denial_date && (
                      <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12 }}>&#9888;</span> Previously denied on {new Date(r.previous_denial_date).toLocaleDateString()}
                      </div>
                    )}
                    {r.message && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4, fontStyle: 'italic' }}>"{r.message}"</div>}
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>Submitted {new Date(r.submitted_at).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => handleAction(r.id, 'approved')} disabled={actionLoading === r.id}
                      style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'rgba(16,185,129,0.2)', color: '#10B981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {actionLoading === r.id ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => handleAction(r.id, 'denied')} disabled={actionLoading === r.id}
                      style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {actionLoading === r.id ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resolved requests — audit trail */}
          {(() => {
            const resolved = requests.filter(r => r.status === 'approved' || r.status === 'denied');
            if (resolved.length === 0) return null;
            return (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.3)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Resolved ({resolved.length})
                </h3>
                {resolved.map(r => {
                  const isApproved = r.status === 'approved';
                  return (
                    <div key={r.id} style={{ ...glass, padding: '12px 16px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: 0.7 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: isApproved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: isApproved ? '#10B981' : '#EF4444', flexShrink: 0,
                      }}>{(r.first_name?.[0] || '') + (r.last_name?.[0] || '')}</div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{r.first_name} {r.last_name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{r.email}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                          Submitted {new Date(r.submitted_at).toLocaleDateString()}
                          {r.reviewed_at && ` · Reviewed ${new Date(r.reviewed_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <span style={{
                        padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                        background: isApproved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)',
                        color: isApproved ? '#10B981' : '#EF4444',
                        border: `1px solid ${isApproved ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.2)'}`,
                      }}>
                        {isApproved ? '✓ Approved' : '✕ Denied'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        </>
      )}

      {/* ═══════ USER ACCOUNTS SECTION ═══════ */}
      {activeSection === 'users' && (
        <>
          {/* Create User Button + Form */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setShowCreateUser(!showCreateUser)} style={{
              padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(16,185,129,0.3)',
              background: showCreateUser ? 'rgba(16,185,129,0.15)' : 'transparent',
              color: '#10B981', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {showCreateUser ? '✕ Cancel' : '+ Create User'}
            </button>
          </div>

          {showCreateUser && (
            <form onSubmit={handleCreateUser} style={{ ...glass, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#10B981', margin: '0 0 16px' }}>Create New User</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[
                  { key: 'firstName', placeholder: 'First Name', type: 'text' },
                  { key: 'lastName', placeholder: 'Last Name', type: 'text' },
                  { key: 'email', placeholder: 'Email Address', type: 'email' },
                ].map(f => (
                  <input key={f.key} type={f.type} placeholder={f.placeholder} required
                    value={createForm[f.key]}
                    onChange={e => setCreateForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{
                      padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13, outline: 'none',
                    }} />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Role:</label>
                <select value={createForm.role}
                  onChange={e => setCreateForm(prev => ({ ...prev, role: e.target.value }))}
                  style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, outline: 'none',
                  }}>
                  <option value="investor" style={{ background: '#1a1a2e' }}>Investor</option>
                  <option value="admin" style={{ background: '#1a1a2e' }}>Admin</option>
                </select>
              </div>
              {createError && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)' }}>{createError}</div>}
              {createSuccess && (
                <div style={{ color: '#10B981', fontSize: 12, marginBottom: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div style={{ marginBottom: 6 }}>{createSuccess.split(' — ')[0]}</div>
                  {createSuccess.includes('Temporary Password:') && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Temp Password:</span>
                      <code style={{ background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 6, fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.5, userSelect: 'all' }}>
                        {createSuccess.split('Temporary Password: ')[1]}
                      </code>
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(createSuccess.split('Temporary Password: ')[1]); }}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>
                        Copy
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>A welcome email with this password has been sent to the user.</div>
                </div>
              )}
              <button type="submit" disabled={createLoading} style={{
                padding: '10px 24px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.3), rgba(0,212,255,0.2))',
                color: '#10B981', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: createLoading ? 0.5 : 1,
              }}>
                {createLoading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          )}

          {usersLoading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading users...</div>}

          {!usersLoading && users.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No registered users</div>
            </div>
          )}

          {!usersLoading && users.length > 0 && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#00D4FF', margin: '0 0 12px' }}>Registered Accounts ({users.length})</h3>
              {users.map(u => (
                <div key={u.id} style={{ ...glass, padding: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: u.role === 'admin'
                      ? 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(0,212,255,0.2))'
                      : 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    color: u.role === 'admin' ? '#A855F7' : 'rgba(255,255,255,0.4)',
                    flexShrink: 0,
                  }}>{(u.firstName?.[0] || '').toUpperCase()}{(u.lastName?.[0] || '').toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{u.firstName} {u.lastName}</span>
                      <span style={statusBadge(u.role)}>{u.role}</span>
                      {u.emailVerified && <span style={{ fontSize: 10, color: '#10B981' }}>✓ Verified</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{u.email}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Mode: {u.tradingMode || 'paper'}</span>
                      <span>Logins: {u.loginCount || 0}</span>
                      {u.lastLogin && <span>Last: {new Date(u.lastLogin).toLocaleDateString()}</span>}
                      {u.createdAt && <span>Joined: {new Date(u.createdAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  {/* Role change + Delete — hidden for self */}
                  {u.email !== investor?.email && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleChangeRole(u.id, u.email, u.role === 'admin' ? 'investor' : 'admin')}
                        disabled={roleLoading === u.id}
                        style={{
                          padding: '8px 14px', borderRadius: 10,
                          border: `1px solid ${u.role === 'admin' ? 'rgba(0,212,255,0.25)' : 'rgba(168,85,247,0.25)'}`,
                          background: u.role === 'admin' ? 'rgba(0,212,255,0.08)' : 'rgba(168,85,247,0.08)',
                          color: u.role === 'admin' ? '#00D4FF' : '#A855F7',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          opacity: roleLoading === u.id ? 0.5 : 1, transition: 'all 0.2s',
                        }}>
                        {roleLoading === u.id ? '...' : u.role === 'admin' ? 'Make Investor' : 'Make Admin'}
                      </button>
                      <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deleteLoading === u.id}
                        style={{
                          padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)',
                          background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontSize: 11, fontWeight: 600,
                          cursor: 'pointer', opacity: deleteLoading === u.id ? 0.5 : 1, transition: 'all 0.2s',
                        }}>
                        {deleteLoading === u.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════ PLATFORM HEALTH SECTION ═══════ */}
      {activeSection === 'health' && (
        <>
          {healthLoading && !healthData && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading health data...</div>}
          {healthData && (() => {
            const h = healthData;
            const statusColor = h.status === 'operational' ? '#10B981' : '#EF4444';
            const metricCard = (label, value, color, sub) => (
              <div style={{ ...glass, padding: '14px 16px', flex: '1 1 140px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: color || '#fff' }}>{value}</div>
                {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{sub}</div>}
              </div>
            );
            return (
              <div>
                {/* Status Banner */}
                <div style={{ ...glass, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${statusColor}30` }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}60` }} />
                  <div style={{ fontSize: 16, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: 1 }}>{h.status}</div>
                  <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Last check: {new Date(h.timestamp).toLocaleTimeString()}</div>
                </div>

                {/* Server Metrics */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Server</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Uptime', h.server.uptimeHuman, '#10B981')}
                  {metricCard('Memory (Heap)', `${h.server.memoryMB.heapUsed} MB`, '#00D4FF', `of ${h.server.memoryMB.heapTotal} MB`)}
                  {metricCard('RSS', `${h.server.memoryMB.rss} MB`, '#A855F7')}
                  {metricCard('Node', h.server.nodeVersion, '#F59E0B')}
                </div>

                {/* Database Metrics */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Database</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Users', h.database.users, '#00D4FF')}
                  {metricCard('Wallets', h.database.wallets, '#A855F7')}
                  {metricCard('Open Positions', h.database.positions.open, '#10B981', `of ${h.database.positions.total} total`)}
                  {metricCard('Trades', h.database.trades, '#F59E0B')}
                </div>

                {/* Trading Engine */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Trading Engine</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Status', h.tradingEngine.active ? 'ACTIVE' : 'OFFLINE', h.tradingEngine.active ? '#10B981' : '#EF4444')}
                  {metricCard('Trades/Hour', h.tradingEngine.tradesLastHour, '#00D4FF')}
                  {metricCard('Trades/24h', h.tradingEngine.tradesLast24h, '#A855F7')}
                  {metricCard('AI Agents', h.tradingEngine.agentCount, '#F59E0B')}
                </div>

                {/* WebSocket & Market Data */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Live Data</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('WS Connections', h.websocket.connections, '#00D4FF')}
                  {metricCard('Market Symbols', h.marketData.symbolCount, '#A855F7')}
                  {metricCard('BTC', `$${(h.marketData.samplePrices?.BTC || 0).toLocaleString()}`, '#F59E0B')}
                  {metricCard('Risk Events (24h)', h.risk.eventsLast24h, h.risk.criticalEvents > 0 ? '#EF4444' : '#10B981', h.risk.criticalEvents > 0 ? `${h.risk.criticalEvents} critical` : 'No critical')}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ═══════ QA REPORTS SECTION ═══════ */}
      {activeSection === 'qa' && (
        <>
          {qaLoading && qaReports.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading QA reports...</div>}

          {!qaLoading && qaReports.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No QA/QC reports yet</div>
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 8 }}>Automated audits run every 6 hours and will appear here</div>
            </div>
          )}

          {qaReports.length > 0 && qaReports.map(report => {
            const sev = report.severity_counts || {};
            const sevColor = sev.critical > 0 ? '#EF4444' : sev.high > 0 ? '#F59E0B' : '#10B981';
            return (
              <div key={report.id} style={{ ...glass, padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: sevColor, boxShadow: `0 0 8px ${sevColor}60` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{report.summary}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {new Date(report.created_at).toLocaleString()} · Source: {report.source || 'manual'}
                    </div>
                  </div>
                  <span style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                    background: report.status === 'new' ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: report.status === 'new' ? '#00D4FF' : 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{report.status}</span>
                </div>

                {/* Severity Counts */}
                {Object.keys(sev).length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {sev.critical > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontSize: 11, fontWeight: 600 }}>🔴 {sev.critical} Critical</span>}
                    {sev.high > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontSize: 11, fontWeight: 600 }}>⚠️ {sev.high} High</span>}
                    {sev.medium > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 11, fontWeight: 600 }}>🔄 {sev.medium} Medium</span>}
                    {sev.low > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600 }}>{sev.low} Low</span>}
                  </div>
                )}

                {/* Issues List */}
                {report.issues && report.issues.length > 0 && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                    {report.issues.slice(0, 10).map((issue, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', padding: '4px 0', borderBottom: i < report.issues.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                        <span style={{ color: issue.severity === 'critical' ? '#EF4444' : issue.severity === 'high' ? '#F59E0B' : '#00D4FF', fontWeight: 600, marginRight: 8 }}>
                          [{(issue.severity || 'info').toUpperCase()}]
                        </span>
                        {issue.description || issue.message || JSON.stringify(issue)}
                      </div>
                    ))}
                    {report.issues.length > 10 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8, textAlign: 'center' }}>+{report.issues.length - 10} more issues</div>}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ═══ FEEDBACK MANAGEMENT ═══ */}
      {activeSection === 'feedback' && (
        <>
          {feedbackLoading && adminFeedback.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading feedback...</div>}

          {!feedbackLoading && adminFeedback.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✉</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No feedback received yet</div>
            </div>
          )}

          {adminFeedback.length > 0 && adminFeedback.map(fb => {
            const statusColors = {
              new: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF' },
              reviewed: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' },
              resolved: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E' },
              declined: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
            };
            const sc = statusColors[fb.status] || statusColors.new;
            return (
              <div key={fb.id} style={{ ...glass, padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{fb.userName}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{fb.userEmail} · {new Date(fb.createdAt).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {fb.rating > 0 && <span style={{ fontSize: 12, color: '#FFBA00' }}>{'★'.repeat(fb.rating)}</span>}
                    <span style={{ padding: '3px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{fb.status}</span>
                  </div>
                </div>
                <div style={{ padding: '2px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                  {fb.category || 'general'}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 12 }}>{fb.message}</div>

                {fb.adminNotes && (
                  <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: '#A855F7', fontWeight: 600, marginBottom: 4 }}>Admin Notes</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{fb.adminNotes}</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['new', 'reviewed', 'resolved', 'declined'].map(s => (
                    <button key={s} onClick={() => updateFeedbackStatus(fb.id, s)} style={{
                      padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      border: fb.status === s ? `1px solid ${(statusColors[s] || statusColors.new).color}40` : '1px solid rgba(255,255,255,0.06)',
                      background: fb.status === s ? (statusColors[s] || statusColors.new).bg : 'rgba(30,30,34,0.6)',
                      color: fb.status === s ? (statusColors[s] || statusColors.new).color : 'rgba(255,255,255,0.4)',
                      textTransform: 'capitalize',
                    }}>{s}</button>
                  ))}
                  <button onClick={() => {
                    const notes = prompt('Enter admin notes/response:');
                    if (notes !== null) updateFeedbackStatus(fb.id, fb.status, notes);
                  }} style={{
                    padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(30,30,34,0.6)', color: 'rgba(255,255,255,0.4)',
                  }}>
                    Add Notes
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ═══ WITHDRAWAL MANAGEMENT ═══ */}
      {activeSection === 'withdrawals' && (
        <>
          {withdrawalsLoading && adminWithdrawals.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading withdrawal requests...</div>}

          {!withdrawalsLoading && adminWithdrawals.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No withdrawal requests</div>
            </div>
          )}

          {/* Summary Stats */}
          {adminWithdrawals.length > 0 && (() => {
            const statusColors = {
              pending: { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' },
              approved: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF' },
              processing: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' },
              completed: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E' },
              denied: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
            };

            // Group withdrawals by investor
            const byInvestor = {};
            adminWithdrawals.forEach(wr => {
              const key = wr.userId;
              if (!byInvestor[key]) {
                byInvestor[key] = {
                  userId: key,
                  userName: wr.userName || 'Unknown',
                  userEmail: wr.userEmail || '',
                  requests: [],
                  totalWithdrawn: 0,
                  totalPending: 0,
                  completedCount: 0,
                  pendingCount: 0,
                };
              }
              byInvestor[key].requests.push(wr);
              if (wr.status === 'completed') {
                byInvestor[key].totalWithdrawn += wr.amount;
                byInvestor[key].completedCount++;
              }
              if (wr.status === 'pending' || wr.status === 'processing' || wr.status === 'approved') {
                byInvestor[key].totalPending += wr.amount;
                byInvestor[key].pendingCount++;
              }
            });
            const investorList = Object.values(byInvestor).sort((a, b) => b.totalWithdrawn - a.totalWithdrawn);
            const grandTotal = investorList.reduce((s, inv) => s + inv.totalWithdrawn, 0);

            return (
              <>
                {/* Top-level stats */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Pending', count: adminWithdrawals.filter(w => w.status === 'pending').length, total: adminWithdrawals.filter(w => w.status === 'pending').reduce((s, w) => s + w.amount, 0), color: '#F59E0B' },
                    { label: 'Processing', count: adminWithdrawals.filter(w => w.status === 'processing').length, total: adminWithdrawals.filter(w => w.status === 'processing').reduce((s, w) => s + w.amount, 0), color: '#A855F7' },
                    { label: 'Completed', count: adminWithdrawals.filter(w => w.status === 'completed').length, total: adminWithdrawals.filter(w => w.status === 'completed').reduce((s, w) => s + w.amount, 0), color: '#22C55E' },
                    { label: 'Total Withdrawn', count: investorList.length + ' investors', total: grandTotal, color: '#00D4FF' },
                  ].map(s => (
                    <div key={s.label} style={{ ...glass, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>{typeof s.count === 'number' ? s.count : s.count}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>${s.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  ))}
                </div>

                {/* ── INVESTOR DETAIL VIEW ── */}
                {selectedWithdrawalUser && (() => {
                  const inv = byInvestor[selectedWithdrawalUser];
                  if (!inv) return null;
                  const sorted = [...inv.requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                  return (
                    <div style={{ marginBottom: 16 }}>
                      {/* Back button + header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <button onClick={() => setSelectedWithdrawalUser(null)} style={{
                          padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          border: '1px solid rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.06)', color: '#00D4FF',
                        }}>← Back</button>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{inv.userName}</div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{inv.userEmail}</div>
                        </div>
                      </div>

                      {/* Investor withdrawal summary */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Total Withdrawn</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#22C55E', marginTop: 4 }}>${inv.totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{inv.completedCount} completed</div>
                        </div>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Pending</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#F59E0B', marginTop: 4 }}>${inv.totalPending.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{inv.pendingCount} requests</div>
                        </div>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>All Requests</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 4 }}>{inv.requests.length}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>total</div>
                        </div>
                      </div>

                      {/* Individual withdrawal history */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Withdrawal History</div>
                      {sorted.map(wr => {
                        const sc = statusColors[wr.status] || statusColors.pending;
                        return (
                          <div key={wr.id} style={{ ...glass, padding: 16, marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>${wr.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                <span style={{ padding: '3px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{wr.status}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{new Date(wr.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                            </div>

                            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8, flexWrap: 'wrap' }}>
                              <span>Method: {(wr.method || '').replace(/_/g, ' ')}</span>
                              <span>Requested: {new Date(wr.createdAt).toLocaleTimeString()}</span>
                              {wr.completedAt && <span>Completed: {new Date(wr.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                              <span>Balance at request: ${(wr.walletEquityAtRequest || 0).toLocaleString()}</span>
                            </div>

                            {wr.notes && (
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, fontStyle: 'italic', padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                                "{wr.notes}"
                              </div>
                            )}

                            {wr.adminNotes && (
                              <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)', marginBottom: 8 }}>
                                <div style={{ fontSize: 10, color: '#A855F7', fontWeight: 600, marginBottom: 2 }}>Admin Notes</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{wr.adminNotes}</div>
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {['pending', 'approved', 'processing', 'completed', 'denied'].map(s => (
                                <button key={s} onClick={() => {
                                  if (s === 'completed' && wr.status !== 'completed') {
                                    if (!confirm(`Mark as completed? This will deduct $${wr.amount.toLocaleString()} from ${inv.userName}'s wallet.`)) return;
                                  }
                                  updateWithdrawalStatus(wr.id, s);
                                }} style={{
                                  padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                                  border: wr.status === s ? `1px solid ${(statusColors[s] || statusColors.pending).color}40` : '1px solid rgba(255,255,255,0.06)',
                                  background: wr.status === s ? (statusColors[s] || statusColors.pending).bg : 'rgba(30,30,34,0.6)',
                                  color: wr.status === s ? (statusColors[s] || statusColors.pending).color : 'rgba(255,255,255,0.4)',
                                  textTransform: 'capitalize',
                                }}>{s}</button>
                              ))}
                              <button onClick={() => {
                                const notes = prompt('Enter admin notes for this withdrawal:');
                                if (notes !== null) updateWithdrawalStatus(wr.id, wr.status, notes);
                              }} style={{
                                padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                                border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(30,30,34,0.6)', color: 'rgba(255,255,255,0.4)',
                              }}>Add Notes</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ── INVESTOR LIST VIEW (when no user selected) ── */}
                {!selectedWithdrawalUser && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Withdrawals by Investor</div>
                    {investorList.map(inv => {
                      const hasPending = inv.pendingCount > 0;
                      return (
                        <div key={inv.userId} onClick={() => setSelectedWithdrawalUser(inv.userId)} style={{
                          ...glass, padding: 18, marginBottom: 8, cursor: 'pointer',
                          border: hasPending ? '1px solid rgba(245,158,11,0.15)' : '1px solid rgba(255,255,255,0.04)',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,212,255,0.3)'; e.currentTarget.style.background = 'rgba(0,212,255,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = hasPending ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)'; e.currentTarget.style.background = ''; }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                              <div style={{
                                width: 40, height: 40, borderRadius: 12,
                                background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(168,85,247,0.15))',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 16, fontWeight: 800, color: '#00D4FF',
                              }}>{(inv.userName || '?')[0].toUpperCase()}</div>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{inv.userName}</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{inv.userEmail}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 18, fontWeight: 800, color: '#22C55E' }}>${inv.totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 3 }}>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{inv.completedCount} completed</span>
                                {hasPending && (
                                  <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700 }}>{inv.pendingCount} pending · ${inv.totalPending.toLocaleString()}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>{inv.requests.length} total requests · Click to view history →</div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* ═══ TAX ADMIN ═══ */}
      {activeSection === 'tax-admin' && (
        <AdminTaxSection isMobile={isMobile} glass={glass} authHeaders={authHeaders} />
      )}

      {/* ═══ COMPLIANCE DASHBOARD ═══ */}
      {activeSection === 'compliance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {complianceLoading ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🛡️</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Loading compliance data...</div>
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 6 }}>Connecting to compliance engine (may take a moment if server is waking up)</div>
            </div>
          ) : complianceError ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
              <div style={{ color: '#F59E0B', fontSize: 14, marginBottom: 12 }}>{complianceError}</div>
              <button onClick={() => fetchCompliance(3)} style={{
                padding: '10px 24px', borderRadius: 12, border: '1px solid rgba(0,212,255,0.3)',
                background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}>Retry</button>
            </div>
          ) : !complianceData ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🛡️</div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, marginBottom: 12 }}>No compliance data loaded yet</div>
              <button onClick={() => fetchCompliance(3)} style={{
                padding: '10px 24px', borderRadius: 12, border: '1px solid rgba(0,212,255,0.3)',
                background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}>Load Compliance Dashboard</button>
            </div>
          ) : (
            <>
              {/* Overall Score Card */}
              <div style={{ ...glass, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Compliance Score</div>
                    <div style={{ fontSize: 48, fontWeight: 800, color: complianceData.health?.overall_score >= 80 ? '#10B981' : complianceData.health?.overall_score >= 60 ? '#F59E0B' : '#EF4444' }}>
                      {complianceData.health?.overall_score || 0}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 8, display: 'inline-block', marginTop: 4,
                      background: (complianceData.health?.overall_status === 'COMPLIANT' || complianceData.health?.overall_status === 'FULLY_COMPLIANT') ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                      color: (complianceData.health?.overall_status === 'COMPLIANT' || complianceData.health?.overall_status === 'FULLY_COMPLIANT') ? '#10B981' : '#F59E0B',
                    }}>{complianceData.health?.overall_status || 'UNKNOWN'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      { l: 'Frameworks', v: complianceData.health?.frameworks_checked || 0, c: '#00D4FF' },
                      { l: 'Audit Entries', v: complianceData.audit?.totalEntries || 0, c: '#A855F7' },
                      { l: 'Alerts', v: complianceData.alerts?.total || 0, c: complianceData.alerts?.total > 0 ? '#EF4444' : '#10B981' },
                    ].map(s => (
                      <div key={s.l} style={{ textAlign: 'center', padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>{s.l}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Framework Scores Grid */}
              <div style={{ ...glass, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Regulatory Framework Scores</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
                  {(complianceData.health?.checks || []).map((check, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800,
                        background: check.score >= 80 ? 'rgba(16,185,129,0.12)' : check.score >= 60 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                        color: check.score >= 80 ? '#10B981' : check.score >= 60 ? '#F59E0B' : '#EF4444',
                      }}>{check.score}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{check.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{check.framework}</div>
                      </div>
                      <span style={{
                        fontSize: 9, padding: '3px 8px', borderRadius: 6, fontWeight: 700,
                        background: check.status === 'IMPLEMENTED' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: check.status === 'IMPLEMENTED' ? '#10B981' : '#F59E0B',
                      }}>{check.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Audit Chain + Trade Flags + Settlements Row */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
                {/* Audit Chain Integrity */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Audit Chain</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: complianceData.audit?.chainIntegrity?.valid ? '#10B981' : '#EF4444', marginBottom: 4 }}>
                    {complianceData.audit?.chainIntegrity?.valid ? '✓ INTACT' : '✗ BROKEN'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {complianceData.audit?.chainIntegrity?.entriesChecked || 0} entries verified
                  </div>
                  {(complianceData.audit?.chainIntegrity?.violations?.length || 0) > 0 && (
                    <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>
                      {complianceData.audit.chainIntegrity.violations.length} violations detected
                    </div>
                  )}
                </div>

                {/* Trade Flags */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Trade Flags</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: complianceData.tradeFlags?.pending > 0 ? '#F59E0B' : '#10B981' }}>
                        {complianceData.tradeFlags?.pending || 0}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Pending</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#10B981' }}>{complianceData.tradeFlags?.resolved || 0}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Resolved</div>
                    </div>
                  </div>
                </div>

                {/* Settlements */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Settlements</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#00D4FF' }}>{complianceData.settlements?.total || 0}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {complianceData.settlements?.pending || 0} pending · {complianceData.settlements?.failToDeliverActions?.length || 0} FTD actions
                  </div>
                </div>
              </div>

              {/* Self-Healing Activity */}
              {complianceData.selfHealing?.recentActions?.length > 0 && (
                <div style={{ ...glass, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🔧 Self-Healing Activity</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {complianceData.selfHealing.recentActions.map((pm, i) => (
                      <div key={i} style={{ padding: 10, borderRadius: 10, background: 'rgba(255,217,61,0.04)', border: '1px solid rgba(255,217,61,0.1)' }}>
                        <div style={{ fontSize: 12, color: '#FFD93D', fontWeight: 600 }}>{pm.self_healing_action?.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{pm.self_healing_detail}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{pm.agent} · {pm.symbol} · {new Date(pm.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Alerts */}
              {complianceData.alerts?.recent?.length > 0 && (
                <div style={{ ...glass, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#EF4444' }}>⚠️ Recent Compliance Alerts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {complianceData.alerts.recent.map((alert, i) => (
                      <div key={i} style={{ padding: 10, borderRadius: 10, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444' }}>{alert.type?.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{new Date(alert.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FTC Disclaimers */}
              <div style={{ ...glass, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📋 FTC Required Disclaimers</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(complianceData.disclaimers || {}).map(([key, text]) => (
                    <div key={key} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#00D4FF', textTransform: 'uppercase', marginBottom: 4 }}>{key.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Refresh Button */}
      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <RefreshButton label="Refresh All" onRefresh={() => { fetchRequests(); fetchUsers(); fetchHealth(); fetchQaReports(); fetchAdminFeedback(); fetchAdminWithdrawals(); if (activeSection === 'compliance') fetchCompliance(); }} />
      </div>
    </div>
  );
}


export default AdminPanel;
