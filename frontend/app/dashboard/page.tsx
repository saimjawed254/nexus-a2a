'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import Nav from '../components/Nav';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const MERCHANT_KEY = process.env.NEXT_PUBLIC_MERCHANT_KEY || 'nexus_merchant_2026';

interface Session {
  id: string;
  buyer_type: string;
  status: string;
  rounds_used: number;
  expires_at: string;
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  brand: string;
  price: number;
  stock: number;
  allocated_stock: number;
  category: string;
}

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'badge-active',
    PENDING_MERCHANT_REVIEW: 'badge-warning',
    APPROVED: 'badge-success',
    COMPLETED: 'badge-success',
    TERMINATED: 'badge-danger',
  };
  return <span className={`badge ${map[status] || 'badge-muted'}`}>{status.replace(/_/g, ' ')}</span>;
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<'sessions' | 'products' | 'config'>('sessions');
  const [config, setConfig] = useState({ max_discount_pct: 3, max_rounds: 3, llm_personality: 'STRICT', require_manual_approval: false, session_timeout_minutes: 15 });
  const [loading, setLoading] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  const fetchSessions = async () => {
    try {
      const r = await fetch(`${API}/api/admin/sessions`, { headers: { 'x-merchant-key': MERCHANT_KEY } });
      const d = await r.json();
      if (d.sessions) setSessions(d.sessions);
    } catch {}
  };

  const fetchProducts = async () => {
    try {
      const r = await fetch(`${API}/api/merchant/products`);
      const d = await r.json();
      if (d.products) setProducts(d.products);
    } catch {}
  };

  useEffect(() => {
    fetchSessions();
    fetchProducts();
    const interval = setInterval(fetchSessions, 8000);
    
    // Connect socket for realtime merchant alerts
    const socket = io(API);
    socket.emit('join_merchant_room');
    
    socket.on('payment_confirmed', (data: any) => {
      toast.success(`💰 Payment Received for Order: ${data.payment_id}!`);
      fetchSessions(); // Refresh sessions to show COMPLETED status
    });

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  const handleTerminate = async (sessionId: string) => {
    if (!confirm('Terminate this session? Stock will be released and an apology sent.')) return;
    await fetch(`${API}/api/admin/terminate/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-merchant-key': MERCHANT_KEY },
      body: JSON.stringify({ reason: 'MERCHANT_KILL_SWITCH' })
    });
    fetchSessions();
  };

  const handleApprove = async (sessionId: string) => {
    await fetch(`${API}/api/admin/review/${sessionId}/approve`, {
      method: 'POST', headers: { 'x-merchant-key': MERCHANT_KEY }
    });
    fetchSessions();
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/api/merchant/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      setConfigMsg('✅ Config saved!');
      setTimeout(() => setConfigMsg(''), 3000);
    } finally { setLoading(false); }
  };

  const active = sessions.filter(s => s.status === 'ACTIVE').length;
  const pending = sessions.filter(s => s.status === 'PENDING_MERCHANT_REVIEW').length;
  const totalStock = products.reduce((a, p) => a + p.stock, 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Toaster position="top-right" />
      <Nav active="dashboard" />
      <div className="container" style={{ padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '700', letterSpacing: '-0.02em' }}>Merchant Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Manage your catalog, negotiation config, and active sessions.</p>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
          <div className="stat-block">
            <div className="label">Products</div>
            <div className="value">{products.length}</div>
            <div className="sub">{totalStock} total units</div>
          </div>
          <div className="stat-block">
            <div className="label">Active Sessions</div>
            <div className="value" style={{ color: 'var(--cobalt)' }}>{active}</div>
            <div className="sub">Live negotiations</div>
          </div>
          <div className="stat-block">
            <div className="label">Pending Review</div>
            <div className="value" style={{ color: 'var(--warning)' }}>{pending}</div>
            <div className="sub">Awaiting approval</div>
          </div>
          <div className="stat-block">
            <div className="label">Total Sessions</div>
            <div className="value">{sessions.length}</div>
            <div className="sub">All time</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)', width: 'fit-content' }}>
          {(['sessions', 'products', 'config'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '0.88rem', fontFamily: 'inherit',
                background: tab === t ? 'white' : 'transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: tab === t ? 'var(--shadow-sm)' : 'none',
                transition: 'var(--transition)'
              }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Sessions Tab */}
        {tab === 'sessions' && (
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>Session ID</th><th>Buyer Type</th><th>Status</th>
                <th>Rounds</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {sessions.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>No sessions yet.</td></tr>}
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.id.substring(0, 16)}...</td>
                    <td><span className={`badge ${s.buyer_type === 'AGENT' ? 'badge-active' : 'badge-muted'}`}>{s.buyer_type}</span></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>{s.rounds_used}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{new Date(s.created_at).toLocaleTimeString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {s.status === 'PENDING_MERCHANT_REVIEW' && (
                          <button className="btn btn-success btn-sm" onClick={() => handleApprove(s.id)}>Approve</button>
                        )}
                        {(s.status === 'ACTIVE' || s.status === 'PENDING_MERCHANT_REVIEW') && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleTerminate(s.id)}>Kill</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Products Tab */}
        {tab === 'products' && (
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>Product Name</th><th>Brand</th><th>Category</th>
                <th>Price</th><th>Stock</th><th>Allocated</th>
              </tr></thead>
              <tbody>
                {products.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>No products yet. Upload a catalog.</td></tr>}
                {products.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td>{p.brand}</td>
                    <td><span className="badge badge-muted">{p.category}</span></td>
                    <td>{formatCurrency(p.price)}</td>
                    <td>{p.stock}</td>
                    <td style={{ color: p.allocated_stock > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{p.allocated_stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Config Tab */}
        {tab === 'config' && (
          <div className="card" style={{ maxWidth: '560px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '20px' }}>Negotiation Settings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: '6px' }}>Universal Max Discount (%)</label>
                <input type="number" className="input" value={config.max_discount_pct} onChange={e => setConfig(c => ({ ...c, max_discount_pct: +e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: '6px' }}>Max Negotiation Rounds</label>
                <input type="number" className="input" value={config.max_rounds} onChange={e => setConfig(c => ({ ...c, max_rounds: +e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: '6px' }}>Session Timeout (minutes)</label>
                <input type="number" className="input" value={config.session_timeout_minutes} onChange={e => setConfig(c => ({ ...c, session_timeout_minutes: +e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: '6px' }}>AI Personality</label>
                <select className="input" value={config.llm_personality} onChange={e => setConfig(c => ({ ...c, llm_personality: e.target.value }))}>
                  <option value="STRICT">Strict — Minimal concessions</option>
                  <option value="BALANCED">Balanced — Reasonable give-and-take</option>
                  <option value="FLEXIBLE">Flexible — Prioritise closing the deal</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" id="manual" checked={config.require_manual_approval}
                  onChange={e => setConfig(c => ({ ...c, require_manual_approval: e.target.checked }))} />
                <label htmlFor="manual" style={{ fontSize: '0.88rem', cursor: 'pointer' }}>Require manual merchant approval before payment link is generated</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button className="btn btn-primary" onClick={handleSaveConfig} disabled={loading}>{loading ? 'Saving...' : 'Save Config'}</button>
                {configMsg && <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>{configMsg}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
