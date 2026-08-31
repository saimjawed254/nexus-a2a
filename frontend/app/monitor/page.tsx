'use client';

import { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import Nav from '../components/Nav';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const MERCHANT_KEY = process.env.NEXT_PUBLIC_MERCHANT_KEY || 'nexus_merchant_2026';

interface LiveMessage {
  session_id: string;
  role: string;
  content: string;
  metadata?: { finalOffer?: number; dealClosed?: boolean; systemDecision?: string };
  ts: number;
}

function roleBadge(role: string) {
  const map: Record<string, string> = { USER: 'badge-muted', AGENT: 'badge-active', SYSTEM: 'badge-warning', MERCHANT: 'badge-success' };
  return <span className={`badge ${map[role] || 'badge-muted'}`}>{role}</span>;
}

export default function Monitor() {
  const { user } = useUser();
  const isAdmin = user?.primaryEmailAddress?.emailAddress === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Moved early return below hooks

  useEffect(() => {
    // Poll sessions every 5s
    const fetchSessions = async () => {
      try {
        const r = await fetch(`${API}/api/admin/sessions`, { headers: { 'x-merchant-key': MERCHANT_KEY } });
        const d = await r.json();
        if (d.sessions) setSessions(d.sessions);
      } catch {}
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Use Server-Sent Events via polling for simplicity (Socket.io would need a client lib)
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
            if (d.messages.length > prev.length) {
              return d.messages.map((m: any) => ({ ...m, ts: Date.now() }));
            }
            return prev;
          });
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [selectedSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKill = async (sessionId: string) => {
    if (!confirm('This will terminate the session and send an apology to the customer. Continue?')) return;
    await fetch(`${API}/api/admin/terminate/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-merchant-key': MERCHANT_KEY },
      body: JSON.stringify({ reason: 'MERCHANT_KILL_SWITCH' })
    });
  };

  const handleApprove = async (sessionId: string) => {
    await fetch(`${API}/api/admin/review/${sessionId}/approve`, {
      method: 'POST', headers: { 'x-merchant-key': MERCHANT_KEY }
    });
  };

  const activeSession = sessions.find(s => s.id === selectedSession);

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <Nav active="monitor" />
        <div style={{ padding: '100px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Restricted Access. Merchant privileges required.
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Nav active="monitor" />
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: 'calc(100vh - 60px)' }}>
        {/* Sidebar: session list */}
        <div style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-card)', overflowY: 'auto', padding: '16px' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Live Sessions ({sessions.filter(s => s.status === 'ACTIVE').length} active)
          </div>
          {sessions.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>No sessions yet.</p>
          )}
          {sessions.map(s => (
            <div key={s.id} onClick={() => setSelectedSession(s.id)}
              style={{
                padding: '12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: '6px',
                background: selectedSession === s.id ? 'var(--cobalt-light)' : 'transparent',
                border: `1px solid ${selectedSession === s.id ? 'var(--cobalt)' : 'transparent'}`,
                transition: 'var(--transition)'
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>{s.id.substring(0, 12)}…</span>
                <span className={`badge ${s.status === 'ACTIVE' ? 'badge-active' : s.status === 'PENDING_MERCHANT_REVIEW' ? 'badge-warning' : 'badge-muted'}`} style={{ fontSize: '0.65rem' }}>
                  {s.status === 'ACTIVE' ? '● LIVE' : s.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {s.buyer_type} · Round {s.rounds_used}
              </div>
            </div>
          ))}
        </div>

        {/* Main: message feed */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {selectedSession && activeSession ? (
            <>
              {/* Session header with action buttons */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Session {selectedSession.substring(0, 20)}…</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{activeSession.buyer_type} · Round {activeSession.rounds_used} · {activeSession.status}</div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {activeSession.status === 'PENDING_MERCHANT_REVIEW' && (
                    <button className="btn btn-success btn-sm" onClick={() => handleApprove(selectedSession)}>✓ Approve Deal</button>
                  )}
                  {(activeSession.status === 'ACTIVE' || activeSession.status === 'PENDING_MERCHANT_REVIEW') && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleKill(selectedSession)}>⚡ Kill Switch</button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {messages.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', fontSize: '0.9rem' }}>No messages yet. Waiting for conversation...</p>
                )}
                {messages.map((m, i) => (
                  <div key={i} style={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    alignItems: m.role === 'USER' ? 'flex-end' : m.role === 'SYSTEM' ? 'center' : 'flex-start'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{roleBadge(m.role)}</div>
                    <div style={{
                      maxWidth: '70%', padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: m.role === 'USER' ? 'var(--cobalt)' : m.role === 'SYSTEM' ? 'var(--cobalt-light)' : 'var(--bg-secondary)',
                      color: m.role === 'USER' ? 'white' : 'var(--text-primary)',
                      fontSize: '0.88rem', lineHeight: '1.55'
                    }}>
                      {m.content}
                      {m.metadata?.finalOffer && (
                        <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(255,255,255,0.15)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                          Final Offer: ₹{m.metadata.finalOffer.toLocaleString('en-IN')} {m.metadata.dealClosed ? '✓ DEAL CLOSED' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem' }}>📡</div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Live Monitor</div>
              <div style={{ fontSize: '0.9rem' }}>Select a session from the left to watch the negotiation in real-time.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
