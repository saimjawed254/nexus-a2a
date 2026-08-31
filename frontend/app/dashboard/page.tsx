'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import './dashboard.css';

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

interface LiveMessage {
  session_id: string;
  role: string;
  content: string;
  metadata?: { finalOffer?: number; dealClosed?: boolean; systemDecision?: string };
  ts: number;
}

function formatCurrency(n: number) {
  return `₹ ${n.toLocaleString('en-IN')}`;
}

const statusBadge = (status: string) => {
  if (status === 'COMPLETED') return 'tbl-badge-success';
  if (status === 'ACTIVE') return 'tbl-badge-warning';
  if (status === 'PENDING_MERCHANT_REVIEW') return 'tbl-badge-danger';
  return 'tbl-badge-secondary';
}

const CustomTooltip = ({ active, payload, label, prefix = '' }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid #e6ebf1', padding: '0.75rem', borderRadius: '6px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontFamily: 'Inter, sans-serif' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#62778d', fontWeight: 600 }}>{label}</p>
          <p style={{ margin: 0, fontSize: '1.05rem', color: payload[0].color, fontWeight: 700 }}>
            {prefix}{payload[0].value.toLocaleString('en-IN')}
          </p>
        </div>
      );
    }
    return null;
};

export default function Dashboard() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const isAdmin = user?.primaryEmailAddress?.emailAddress === process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState({ max_discount_pct: 3, max_rounds: 3, llm_personality: 'STRICT', require_manual_approval: false, session_timeout_minutes: 15 });
  const [tab, setTab] = useState<'overview' | 'config'>('overview');
  const [loading, setLoading] = useState(false);
  
  // Monitor states
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Filters
  const [dealsFilter, setDealsFilter] = useState('7D');
  const [revenueFilter, setRevenueFilter] = useState('7D');
  const [earningsFilter, setEarningsFilter] = useState('1M');
  const [historyFilter, setHistoryFilter] = useState('ALL');

  useEffect(() => {
    if (!isAdmin) return;
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

    fetchSessions();
    fetchProducts();
    const interval = setInterval(fetchSessions, 5000);
    const socket = io(API);
    socket.emit('join_merchant_room');
    socket.on('payment_confirmed', (data: any) => {
      toast.success(`💰 Payment Received for Order: ${data.payment_id}!`);
      fetchSessions();
    });

    return () => { clearInterval(interval); socket.disconnect(); };
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedSession) return;
    setMessages([]);
    const poll = async () => {
      try {
        const r = await fetch(`${API}/api/admin/sessions/${selectedSession}/messages`, {
          headers: { 'x-merchant-key': MERCHANT_KEY }
        });
        const d = await r.json();
        if (d.messages) {
          setMessages(prev => {
            if (d.messages.length > prev.length) return d.messages.map((m: any) => ({ ...m, ts: Date.now() }));
            return prev;
          });
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [selectedSession]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/api/merchant/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      toast.success('Settings saved successfully!');
    } finally { setLoading(false); }
  };

  const handleKill = async (sessionId: string) => {
    if (!confirm('Terminate this session immediately?')) return;
    await fetch(`${API}/api/admin/terminate/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-merchant-key': MERCHANT_KEY },
      body: JSON.stringify({ reason: 'MERCHANT_KILL_SWITCH' })
    });
    toast.error('Session Terminated');
  };

  const handleApprove = async (sessionId: string) => {
    await fetch(`${API}/api/admin/review/${sessionId}/approve`, { method: 'POST', headers: { 'x-merchant-key': MERCHANT_KEY } });
    toast.success('Deal Approved');
  };


  const activeSessions = sessions.filter(s => s.status === 'ACTIVE' || s.status === 'PENDING_MERCHANT_REVIEW');
  const completedSessions = sessions.filter(s => s.status === 'COMPLETED');
  const totalRevenue = products.reduce((a, p) => a + (p.price * (p.stock - p.allocated_stock)), 0);
  const totalAllocated = products.reduce((a, p) => a + p.allocated_stock, 0);
  const totalStock = products.reduce((a, p) => a + p.stock, 0);
  const allocatedPct = totalStock > 0 ? (totalAllocated / totalStock) * 100 : 0;
  
  // Real data aggregation for graphs
  const getAggregatedData = (filter: string, isRevenue: boolean) => {
    const points = filter === '7D' ? 7 : filter === '1M' ? 30 : 12;
    const dataMap = new Map();
    const now = new Date();
    
    // Initialize empty bins
    for (let i = points - 1; i >= 0; i--) {
        const d = new Date(now);
        if (filter === '1Y') d.setMonth(d.getMonth() - i);
        else d.setDate(d.getDate() - i);
        const key = filter === '1Y' ? d.toLocaleDateString('en-US', {month: 'short', year: '2-digit'}) : d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
        dataMap.set(key, 0);
    }

    // Fill with real data
    completedSessions.forEach(s => {
        const d = new Date(s.created_at);
        const key = filter === '1Y' ? d.toLocaleDateString('en-US', {month: 'short', year: '2-digit'}) : d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
        if (dataMap.has(key)) {
            // For revenue, we estimate based on average catalog price if we don't have session price
            const avgPrice = products.length > 0 ? products.reduce((a,p)=>a+p.price,0)/products.length : 5000;
            dataMap.set(key, dataMap.get(key) + (isRevenue ? avgPrice : 1));
        }
    });

    return Array.from(dataMap.entries()).map(([date, value]) => ({ date, value }));
  };

  const dealsData = useMemo(() => getAggregatedData(dealsFilter, false), [completedSessions, dealsFilter]);
  const revenueData = useMemo(() => getAggregatedData(revenueFilter, true), [completedSessions, revenueFilter, products]);
  const earningsData = useMemo(() => getAggregatedData(earningsFilter, true), [completedSessions, earningsFilter, products]);

  const activeSessionDetails = sessions.find(s => s.id === selectedSession);
  
  const filteredHistory = sessions.filter(s => {
      if (historyFilter === 'ALL') return true;
      if (historyFilter === 'ACTIVE') return s.status === 'ACTIVE';
      if (historyFilter === 'COMPLETED') return s.status === 'COMPLETED';
      if (historyFilter === 'PENDING') return s.status === 'PENDING_MERCHANT_REVIEW';
      return true;
  });

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ color: '#000' }}>Access Denied. Merchant Privileges Required.</h1>
      </div>
    );
  }

  return (
    <div className="tabler-page" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Toaster position="top-right" />
      
      {/* ── Top Navbar ─────────────────────────────────────────── */}
      <nav className="tbl-navbar">
        <div className="tbl-container-inner">
            <a className="tbl-navbar-brand" href="/" style={{ fontFamily: 'Inter, sans-serif' }}>
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="8" fill="#0055ff" />
                <path d="M10 16L16 10L22 16" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Nexus A2A
            </a>

            <div className="tbl-navbar-actions">
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '1rem', marginLeft: '0.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#182433' }}>{user?.firstName || 'Admin'}</div>
                    <div style={{ fontSize: '0.8rem', color: '#62778d' }}>{user?.primaryEmailAddress?.emailAddress}</div>
                </div>
                <img src={user?.imageUrl} alt="Profile" className="tbl-avatar" />
            </div>

            <button className="tbl-btn" style={{ marginLeft: '1rem', borderColor: '#d63939', color: '#d63939' }} onClick={() => signOut(() => router.push('/'))}>
                Sign out
            </button>
            </div>
        </div>
      </nav>

      {/* ── Sub-navbar ─────────────────────────────────────────── */}
      <nav className="tbl-subnav">
        <div className="tbl-container-inner" style={{ justifyContent: 'flex-start' }}>
            <a href="#" className={tab === 'overview' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('overview'); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Overview
            </a>
            <a href="#" className={tab === 'config' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('config'); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Config
            </a>
        </div>
      </nav>

      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="tbl-page-header">
        <div className="tbl-container-inner">
            <div>
            <div className="tbl-page-pretitle">Overview</div>
            <h2 className="tbl-page-title" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '-0.5px' }}>Dashboard</h2>
            </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────── */}
      <div className="tbl-container">
        
        {tab === 'overview' && (
            <>
                {/* Row 1: Welcome + Revenue + Deals */}
                <div className="tbl-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', marginBottom: '1rem', alignItems: 'stretch' }}>
                {/* Welcome card (spans 2 columns) */}
                <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }}>
                    <div className="tbl-card tbl-welcome-card h-100">
                    <div className="tbl-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'row', gap: '2rem' }}>
                        
                        <div className="tbl-welcome-text" style={{ flex: '1 1 50%', display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '0.5rem', color: '#182433' }}>Welcome back, {user?.firstName || 'Admin'}</h3>
                        <p style={{ fontSize: '0.9rem', color: '#62778d', lineHeight: 1.5 }}>You have {activeSessions.length} active negotiations demanding your attention today.</p>
                        
                        <div className="tbl-welcome-stats" style={{ display: 'flex', gap: '2rem', marginTop: 'auto' }}>
                            <div className="tbl-stat-mini">
                            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#9eb0c1' }}>Today's Deals</label>
                            <div className="value-row">
                                <span className="num" style={{ fontSize: '1.4rem' }}>{completedSessions.length}</span>
                                <span className="tbl-trend-up" style={{ color: '#2fb344', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    12% <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                                </span>
                            </div>
                            <div className="tbl-progress-bar"><div className="tbl-progress-fill" style={{ width: '75%', background: '#2fb344' }} /></div>
                            </div>
                            <div className="tbl-stat-mini">
                            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#9eb0c1' }}>Growth Rate</label>
                            <div className="value-row">
                                <span className="num" style={{ fontSize: '1.4rem' }}>24.5%</span>
                                <span className="tbl-trend-up" style={{ color: '#0055ff', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    3.1% <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                                </span>
                            </div>
                            <div className="tbl-progress-bar"><div className="tbl-progress-fill" style={{ width: '24%', background: '#0055ff' }} /></div>
                            </div>
                        </div>
                        </div>

                        <div className="tbl-welcome-img" style={{ flex: '1 1 50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src="/welcome-icon.jpg" alt="Welcome Illustration" style={{ width: '100%', maxWidth: '240px', height: 'auto', objectFit: 'contain' }} />
                        </div>
                    </div>
                    </div>
                </div>

                {/* Deals Closed (High Quality Chart) */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="tbl-card h-100">
                        <div className="tbl-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <div className="tbl-subheader" style={{ fontSize: '0.75rem' }}>Deals Closed</div>
                            <select value={dealsFilter} onChange={e => setDealsFilter(e.target.value)} style={{ border: '1px solid #e6ebf1', borderRadius: '4px', padding: '2px 6px', background: '#f8fafc', fontSize: '0.75rem', color: '#62778d', cursor: 'pointer', outline: 'none' }}>
                                <option value="7D">Last 7 days</option>
                                <option value="1M">Last Month</option>
                                <option value="1Y">Last Year</option>
                            </select>
                        </div>
                        <div className="tbl-stat-main" style={{ fontSize: '1.6rem' }}>{completedSessions.length} <span className="tbl-trend-up" style={{ fontSize: '0.9rem', color: '#2fb344', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>12% <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span></div>
                        
                        <div style={{ flex: 1, minHeight: '140px', marginTop: '1rem', width: '100%', marginLeft: '-15px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dealsData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ebf1" />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                                    <Bar dataKey="value" fill="#0055ff" radius={[3, 3, 0, 0]} maxBarSize={30} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        </div>
                    </div>
                </div>

                {/* Total Revenue (High Quality Chart) */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="tbl-card h-100">
                        <div className="tbl-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <div className="tbl-subheader" style={{ fontSize: '0.75rem' }}>Inventory Value</div>
                            <select value={revenueFilter} onChange={e => setRevenueFilter(e.target.value)} style={{ border: '1px solid #e6ebf1', borderRadius: '4px', padding: '2px 6px', background: '#f8fafc', fontSize: '0.75rem', color: '#62778d', cursor: 'pointer', outline: 'none' }}>
                                <option value="7D">Last 7 days</option>
                                <option value="1M">Last Month</option>
                                <option value="1Y">Last Year</option>
                            </select>
                        </div>
                        <div className="tbl-stat-main" style={{ fontSize: '1.6rem' }}>{formatCurrency(totalRevenue)}</div>
                        
                        <div style={{ flex: 1, minHeight: '140px', marginTop: '1rem', width: '100%', marginLeft: '-10px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={revenueData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ebf1" />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} tickFormatter={(v) => `₹${(v/1000)}k`} />
                                    <defs>
                                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2fb344" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#2fb344" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <Tooltip content={<CustomTooltip prefix="₹ " />} />
                                    <Area type="monotone" dataKey="value" stroke="#2fb344" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        </div>
                    </div>
                </div>
                </div>

                {/* Row 3: Small Icon Cards */}
                <div className="tbl-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', marginBottom: '1rem' }}>
                <div className="tbl-card">
                    <div className="tbl-small-stat">
                    <div className="tbl-small-stat-icon blue">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </div>
                    <div className="tbl-small-stat-info">
                        <strong style={{ fontSize: '1rem' }}>{activeSessions.length} Live Sessions</strong>
                        <span style={{ fontSize: '0.85rem' }}>Currently negotiating</span>
                    </div>
                    </div>
                </div>

                <div className="tbl-card">
                    <div className="tbl-small-stat">
                    <div className="tbl-small-stat-icon green">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    </div>
                    <div className="tbl-small-stat-info">
                        <strong style={{ fontSize: '1rem' }}>{products.length} Products</strong>
                        <span style={{ fontSize: '0.85rem' }}>Available in catalog</span>
                    </div>
                    </div>
                </div>

                <div className="tbl-card">
                    <div className="tbl-small-stat">
                    <div className="tbl-small-stat-icon fb">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <div className="tbl-small-stat-info">
                        <strong style={{ fontSize: '1rem' }}>{config.max_rounds} Max Rounds</strong>
                        <span style={{ fontSize: '0.85rem' }}>Per negotiation session</span>
                    </div>
                    </div>
                </div>

                <div className="tbl-card">
                    <div className="tbl-small-stat">
                    <div className="tbl-small-stat-icon black">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    </div>
                    <div className="tbl-small-stat-info">
                        <strong style={{ fontSize: '1rem' }}>{sessions.length} Total Sessions</strong>
                        <span style={{ fontSize: '0.85rem' }}>Lifetime sessions</span>
                    </div>
                    </div>
                </div>
                </div>

                {/* Row 4: Inventory Allocation + Recent Payments */}
                <div className="tbl-row tbl-row-2" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    
                    {/* Inventory Allocation */}
                    <div className="tbl-card">
                    <div className="tbl-card-body">
                        <div className="tbl-card-title" style={{ marginBottom: '0.5rem', fontSize: '1.05rem', fontWeight: 700 }}>Inventory Allocation <strong>{totalAllocated} units</strong> of {totalStock}</div>
                        <div className="tbl-storage-bar">
                        <div className="tbl-storage-segment" style={{ width: `${allocatedPct}%`, background: '#0055ff' }} />
                        <div className="tbl-storage-segment" style={{ width: `${100 - allocatedPct}%`, background: '#e6ebf1' }} />
                        </div>
                        <div className="tbl-legend">
                        <span><span className="tbl-legend-dot" style={{ background: '#0055ff' }} />Allocated / Sold</span>
                        <span><span className="tbl-legend-dot" style={{ background: '#e6ebf1' }} />Available Stock</span>
                        </div>
                    </div>
                    </div>
                    
                    {/* Active Sessions Mini Feed */}
                    <div className="tbl-card" style={{ flex: 1 }}>
                    <div className="tbl-card-header"><div className="tbl-card-title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>Live Interactions</div></div>
                    <div className="tbl-card-body" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                        {activeSessions.length === 0 && <div style={{ color: '#62778d', fontSize: '0.9rem' }}>No active sessions right now.</div>}
                        {activeSessions.slice(0, 5).map((s, i) => (
                        <div key={i} className="tbl-activity-item">
                            <div className="tbl-activity-avatar">🤖</div>
                            <div className="tbl-activity-content">
                            <strong>{s.buyer_type}</strong> initiated a negotiation round.
                            <span className="time">Session {s.id.substring(0, 8)}</span>
                            </div>
                            <div className="tbl-activity-dot" />
                        </div>
                        ))}
                    </div>
                    </div>
                </div>

                {/* Recent Payments (High Quality Chart) */}
                <div className="tbl-card">
                    <div className="tbl-card-body" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <div className="tbl-card-title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>Recent Payments</div>
                        <select value={earningsFilter} onChange={e => setEarningsFilter(e.target.value)} style={{ border: '1px solid #e6ebf1', borderRadius: '4px', padding: '2px 6px', background: '#f8fafc', fontSize: '0.75rem', color: '#62778d', cursor: 'pointer', outline: 'none' }}>
                            <option value="7D">Last 7 days</option>
                            <option value="1M">Last Month</option>
                            <option value="1Y">Last Year</option>
                        </select>
                    </div>
                    <div style={{ color: '#62778d', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                        Total Value Locked: <strong style={{ color: '#182433' }}>{formatCurrency(totalRevenue)}</strong>
                    </div>
                    <div className="tbl-trend-up" style={{ marginBottom: '1rem', color: '#0055ff', display: 'flex', alignItems: 'center', gap: '4px' }}>Stable Growth <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div>
                    
                    <div style={{ height: '200px', width: '100%', marginLeft: '-10px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={earningsData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ebf1" />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9eb0c1' }} tickFormatter={(v) => `₹${(v/1000)}k`} />
                                <defs>
                                    <linearGradient id="colorEarn" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0055ff" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#0055ff" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <Tooltip content={<CustomTooltip prefix="₹ " />} />
                                <Area type="monotone" dataKey="value" stroke="#0055ff" strokeWidth={2} fillOpacity={1} fill="url(#colorEarn)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    </div>

                    <div style={{ padding: '0 1.25rem 1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: '0.5rem 1rem', fontSize: '0.85rem', borderTop: '1px solid #e6ebf1', paddingTop: '0.75rem', color: '#9eb0c1', fontWeight: 700, marginBottom: '0.5rem' }}>
                        <strong>METHOD</strong><strong>SESSION ID</strong><strong>AMOUNT</strong><strong>DATE</strong>
                    </div>
                    {completedSessions.length === 0 && <div style={{ color: '#62778d', fontSize: '0.9rem', padding: '0.5rem 0' }}>No completed payments yet.</div>}
                    {completedSessions.slice(0, 5).map((s, i) => (
                        <div key={i} className="tbl-commit-row" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: '0.5rem 1rem', padding: '0.5rem 0', borderBottom: '1px solid #f8fafc' }}>
                        <div className="tbl-activity-avatar" style={{ width: '28px', height: '28px', fontSize: '1rem', background: '#f5f5f5', color: '#0055ff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                        </div>
                        <div className="tbl-commit-msg" style={{ fontSize: '0.9rem', fontWeight: 500, color: '#182433' }}>{s.id.substring(0, 12)}...</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#2fb344' }}>{(s as any).final_offer ? formatCurrency(Number((s as any).final_offer)) : 'N/A'}</div>
                        <div className="tbl-commit-date" style={{ fontSize: '0.85rem', color: '#62778d' }}>{new Date(s.created_at).toLocaleDateString()}</div>
                        </div>
                    ))}
                    </div>
                </div>
                </div>

                {/* Session History (Invoices) */}
                <div className="tbl-card" style={{ marginBottom: '1rem' }}>
                <div className="tbl-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div className="tbl-card-title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>Session History</div>
                    <select value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} style={{ border: '1px solid #e6ebf1', borderRadius: '4px', padding: '4px 8px', background: '#f8fafc', fontSize: '0.85rem', color: '#182433', cursor: 'pointer', outline: 'none' }}>
                        <option value="ALL">All Sessions</option>
                        <option value="ACTIVE">Active</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="PENDING">Pending Review</option>
                    </select>
                </div>
                <div className="tbl-card-body" style={{ borderBottom: '1px solid #e6ebf1', padding: '0.75rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: '#62778d' }}>
                    <span>Showing {filteredHistory.length} filtered sessions</span>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="tbl-table">
                    <thead>
                        <tr>
                        <th style={{ fontSize: '0.8rem' }}>Session ID</th>
                        <th style={{ fontSize: '0.8rem' }}>Buyer Type</th>
                        <th style={{ fontSize: '0.8rem' }}>Rounds Used</th>
                        <th style={{ fontSize: '0.8rem' }}>Started At</th>
                        <th style={{ fontSize: '0.8rem' }}>Final Amount</th>
                        <th style={{ fontSize: '0.8rem' }}>Status</th>
                        <th style={{ fontSize: '0.8rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredHistory.length === 0 && (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#62778d' }}>No sessions found for this filter.</td></tr>
                        )}
                        {filteredHistory.map((s, i) => (
                        <tr key={i}>
                            <td><span style={{ color: '#182433', fontWeight: 600, fontSize: '0.9rem' }}>{s.id.substring(0, 12)}...</span></td>
                            <td style={{ fontSize: '0.9rem' }}>{s.buyer_type}</td>
                            <td style={{ color: '#62778d', fontSize: '0.9rem' }}>{s.rounds_used} / {config.max_rounds}</td>
                            <td style={{ color: '#62778d', fontSize: '0.9rem' }}>{new Date(s.created_at).toLocaleString()}</td>
                            <td style={{ fontWeight: 600, color: s.status === 'COMPLETED' ? '#2fb344' : '#182433' }}>
                                {s.status === 'COMPLETED' ? ((s as any).final_offer ? formatCurrency(Number((s as any).final_offer)) : 'N/A') : '-'}
                            </td>
                            <td><span className={`tbl-badge ${statusBadge(s.status)}`} style={{ fontSize: '0.75rem' }}>{s.status}</span></td>
                            <td>
                            <button className="tbl-btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} onClick={() => setSelectedSession(s.id)}>
                                View Chat ▾
                            </button>
                            </td>
                        </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
                </div>
            </>
        )}

        {/* ── Config Tab ──────────────────────────────────────── */}
        {tab === 'config' && (
            <div className="tbl-card" style={{ maxWidth: '900px', margin: '0 auto' }}>
                <div className="tbl-card-header">
                    <div className="tbl-card-title" style={{ fontSize: '1.2rem', fontWeight: 700 }}>Negotiation AI Configuration</div>
                </div>
                <div className="tbl-card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#182433', marginBottom: '0.4rem' }}>Max Discount Percentage (%)</label>
                                <p style={{ fontSize: '0.8rem', color: '#62778d', marginBottom: '0.5rem' }}>The absolute maximum discount the AI is allowed to offer under any circumstances.</p>
                                <input type="number" style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #dde2e7', borderRadius: '6px', fontSize: '0.95rem' }} value={config.max_discount_pct} onChange={e => setConfig({ ...config, max_discount_pct: +e.target.value })} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#182433', marginBottom: '0.4rem' }}>Max Negotiation Rounds</label>
                                <p style={{ fontSize: '0.8rem', color: '#62778d', marginBottom: '0.5rem' }}>How many back-and-forth counter offers the user is allowed before final offer.</p>
                                <input type="number" style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #dde2e7', borderRadius: '6px', fontSize: '0.95rem' }} value={config.max_rounds} onChange={e => setConfig({ ...config, max_rounds: +e.target.value })} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#182433', marginBottom: '0.4rem' }}>Session Timeout (Minutes)</label>
                                <p style={{ fontSize: '0.8rem', color: '#62778d', marginBottom: '0.5rem' }}>Idle time before an active negotiation session automatically expires.</p>
                                <input type="number" style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #dde2e7', borderRadius: '6px', fontSize: '0.95rem' }} value={config.session_timeout_minutes} onChange={e => setConfig({ ...config, session_timeout_minutes: +e.target.value })} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#182433', marginBottom: '0.4rem' }}>AI Personality</label>
                                <p style={{ fontSize: '0.8rem', color: '#62778d', marginBottom: '0.5rem' }}>Determines how aggressively the LLM defends the merchant margin.</p>
                                <select style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #dde2e7', borderRadius: '6px', fontSize: '0.95rem', backgroundColor: '#fff' }} value={config.llm_personality} onChange={e => setConfig({ ...config, llm_personality: e.target.value })}>
                                    <option value="STRICT">Strict (Focuses heavily on margin)</option>
                                    <option value="BALANCED">Balanced (Standard negotiation)</option>
                                    <option value="FLEXIBLE">Flexible (More likely to concede)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <hr style={{ border: 'none', borderTop: '1px solid #e6ebf1', margin: '2rem 0' }} />

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                        <input type="checkbox" id="manualApprove" checked={config.require_manual_approval} onChange={e => setConfig({ ...config, require_manual_approval: e.target.checked })} style={{ accentColor: '#0055ff', marginTop: '0.25rem', width: '18px', height: '18px' }} />
                        <div>
                            <label htmlFor="manualApprove" style={{ fontSize: '0.95rem', fontWeight: 600, color: '#182433', cursor: 'pointer', display: 'block', marginBottom: '0.25rem' }}>Require Manual Admin Approval Before Checkout</label>
                            <p style={{ fontSize: '0.85rem', color: '#62778d', margin: 0 }}>If enabled, deals reached by the AI will be placed in a pending state until you explicitly approve them from the dashboard.</p>
                        </div>
                    </div>
                </div>
                <div className="tbl-card-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '1.25rem' }}>
                    <button className="tbl-btn tbl-btn-primary" style={{ padding: '0.6rem 1.25rem', fontSize: '0.95rem' }} onClick={handleSaveConfig} disabled={loading}>
                        {loading ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </div>
        )}

      </div>

      {/* ── Chat Modal Overlay ─────────────────────────────────── */}
      {selectedSession && activeSessionDetails && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(24, 36, 51, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setSelectedSession(null)}>
          <div className="tbl-card" style={{ width: '90%', maxWidth: '800px', height: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
            <div className="tbl-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', color: '#182433' }}>Session: {selectedSession}</h2>
                <p style={{ color: '#62778d', fontSize: '0.85rem', margin: 0 }}>
                  {activeSessionDetails.buyer_type} | Round {activeSessionDetails.rounds_used} | <span className={`tbl-badge ${statusBadge(activeSessionDetails.status)}`} style={{ padding: '0.1rem 0.4rem', fontSize: '0.65rem' }}>{activeSessionDetails.status}</span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {activeSessionDetails.status === 'PENDING_MERCHANT_REVIEW' && (
                  <button className="tbl-btn tbl-btn-primary" onClick={() => handleApprove(selectedSession)}>Approve Deal</button>
                )}
                <button className="tbl-btn" style={{ borderColor: '#d63939', color: '#d63939' }} onClick={() => handleKill(selectedSession)}>Kill Switch</button>
                <button className="tbl-icon-btn" onClick={() => setSelectedSession(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            </div>
            
            <div className="tbl-card-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#fff' }}>
              {messages.length === 0 && <p style={{ color: '#62778d', textAlign: 'center', marginTop: '2rem' }}>Waiting for messages...</p>}
              {messages.map((m, i) => {
                  const isUser = m.role.toLowerCase() === 'user';
                  const isSystem = m.role.toLowerCase() === 'system';
                  return (
                    <div key={i} style={{ 
                        padding: '1rem', 
                        borderRadius: '8px', 
                        maxWidth: '75%', 
                        alignSelf: isSystem ? 'center' : (isUser ? 'flex-end' : 'flex-start'),
                        background: isSystem ? 'transparent' : (isUser ? '#0055ff' : '#f0f4f8'),
                        color: isSystem ? '#62778d' : (isUser ? '#fff' : '#182433'),
                        border: isSystem ? 'none' : (isUser ? 'none' : '1px solid #e6ebf1'),
                        textAlign: isSystem ? 'center' : 'left'
                    }}>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: '0.25rem', textTransform: 'uppercase', fontWeight: 600 }}>{m.role}</div>
                    <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{m.content}</div>
                    {m.metadata?.finalOffer && (
                        <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', fontSize: '0.85rem' }}>
                        <strong>Final Offer: {formatCurrency(m.metadata.finalOffer)}</strong>
                        </div>
                    )}
                    </div>
                  )
              })}
              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
