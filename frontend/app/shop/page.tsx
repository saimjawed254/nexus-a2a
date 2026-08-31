'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import Nav from '../components/Nav';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import Script from 'next/script';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Product {
  id: string; name: string; brand: string; model: string;
  category: string; description: string; specs: Record<string, string>;
  price: number; available_stock: number;
}

interface CartItem extends Product { quantity: number; outOfStock?: boolean; }
interface Message { role: 'USER' | 'AGENT' | 'SYSTEM' | 'MERCHANT'; content: string; final_price?: number | null; }
interface SessionHistory { id: string; status: string; terminated_reason?: string; created_at: string; cart_total: number; }

function formatCurrency(n: number | string | null | undefined) {
  if (n == null) return '₹0';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  'laptop': 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  'desktop': 'linear-gradient(135deg, #0f3460 0%, #16213e 100%)',
  'keyboard': 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)',
  'monitor': 'linear-gradient(135deg, #1b2a4a 0%, #0a192f 100%)',
  'mouse': 'linear-gradient(135deg, #2d1b69 0%, #11072f 100%)',
  'headphone': 'linear-gradient(135deg, #1a0533 0%, #2d1b69 100%)',
  'gpu': 'linear-gradient(135deg, #003d1a 0%, #001a0d 100%)',
  'cpu': 'linear-gradient(135deg, #3d1a00 0%, #1a0d00 100%)',
  'storage': 'linear-gradient(135deg, #1a1a00 0%, #0d0d00 100%)',
  'default': 'linear-gradient(135deg, #1a2a3a 0%, #0d1a27 100%)',
};

const CATEGORY_ICONS: Record<string, string> = {
  'laptop': '💻', 'desktop': '🖥️', 'keyboard': '⌨️', 'monitor': '🖥️',
  'mouse': '🖱️', 'headphone': '🎧', 'gpu': '🎮', 'cpu': '⚙️',
  'storage': '💾', 'default': '📦',
};

function getCategoryStyle(category: string) {
  const key = Object.keys(CATEGORY_GRADIENTS).find(k => category?.toLowerCase().includes(k)) || 'default';
  return { gradient: CATEGORY_GRADIENTS[key], icon: CATEGORY_ICONS[key] };
}

const EXAMPLE_QUERIES = [
  'Gaming laptop under ₹1,50,000',
  'Mechanical keyboard for coding',
  'Wireless mouse for design work',
  '4K monitor for video editing',
  'High-end workstation build',
];

export default function Shop() {
  const { width, height } = useWindowSize();
  const { user } = useUser();
  const [view, setView] = useState<'search' | 'cart' | 'chat'>('search');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('ACTIVE');
  const [finalPrice, setFinalPrice] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(3);
  const [sessionExpiry, setSessionExpiry] = useState<Date | null>(null);

  const [showCheckout, setShowCheckout] = useState(false);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [history, setHistory] = useState<SessionHistory[]>([]);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [initialCartLoaded, setInitialCartLoaded] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'ACTIVE' | 'REVIEW' | 'CLOSED'>('ALL');

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending, view]);

  // Load cart — strip outOfStock flags on load
  useEffect(() => {
    const saved = localStorage.getItem('nexus_cart');
    if (saved) {
      try { setCart(JSON.parse(saved).map((item: CartItem) => ({ ...item, outOfStock: false }))); } catch (e) {}
    }
  }, []);

  // Load and merge cloud cart on user login
  useEffect(() => {
    const fetchCloudCart = async () => {
      if (!user?.id) { setInitialCartLoaded(true); return; }
      try {
        const r = await fetch(`${API}/api/negotiation/user/${user.id}/cart`);
        const d = await r.json();
        if (d.cart && Array.isArray(d.cart) && d.cart.length > 0) {
          setCart(prev => {
            const cloudIds = new Set(d.cart.map((c: any) => c.id));
            const localToAdd = prev.filter(c => !cloudIds.has(c.id));
            return [...d.cart, ...localToAdd];
          });
        }
      } catch (e) {} finally { setInitialCartLoaded(true); }
    };
    fetchCloudCart();
  }, [user?.id]);

  // Save cart — strip outOfStock before saving + Cloud Sync
  useEffect(() => {
    const cleanCart = cart.map(c => ({ ...c, outOfStock: false }));
    localStorage.setItem('nexus_cart', JSON.stringify(cleanCart));
    
    // Cloud sync (debounced)
    if (initialCartLoaded && user?.id) {
      const handler = setTimeout(() => {
        fetch(`${API}/api/negotiation/user/${user.id}/cart`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart: cleanCart })
        }).catch(() => {});
      }, 1000);
      return () => clearTimeout(handler);
    }
  }, [cart, initialCartLoaded, user?.id]);

  // Pre-fill phone from Clerk
  useEffect(() => {
    if (user?.primaryPhoneNumber?.phoneNumber && !phone) {
      setPhone(user.primaryPhoneNumber.phoneNumber);
    }
  }, [user]);

  // Session expiry countdown timer
  useEffect(() => {
    if (!sessionExpiry || sessionStatus !== 'ACTIVE') { setTimeLeft(''); return; }
    const tick = () => {
      const remaining = sessionExpiry.getTime() - Date.now();
      if (remaining <= 0) { setTimeLeft('Expired'); return; }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sessionExpiry, sessionStatus]);

  const loadSessionData = useCallback(async (uid: string) => {
    try {
      const [hRes, aRes] = await Promise.all([
        fetch(`${API}/api/negotiation/sessions/user/${uid}`),
        fetch(`${API}/api/negotiation/session/active?clerk_user_id=${uid}`)
      ]);
      const [hData, aData] = await Promise.all([hRes.json(), aRes.json()]);
      if (hData.sessions) setHistory(hData.sessions);
      if (aData.session) {
        setSessionId(aData.session.id);
        setSessionStatus(aData.session.status);
        setFinalPrice(aData.finalPrice);
        setMessages(aData.messages || []);
        if (aData.session.expires_at) setSessionExpiry(new Date(aData.session.expires_at));
        // Auto-load into chat for ACTIVE and APPROVED so the user can see the payment button
        if (aData.session.status === 'ACTIVE' || aData.session.status === 'APPROVED') {
          setView('chat');
        }
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { if (!user?.id) return; loadSessionData(user.id); }, [user?.id, loadSessionData]);

  useEffect(() => {
    fetch(`${API}/api/merchant/config`).then(r => r.json()).then(d => {
      if (d.max_rounds) setMaxRounds(d.max_rounds);
    }).catch(() => {});
  }, []);

  // Polling
  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(async () => {
      try {
        const hRes = await fetch(`${API}/api/negotiation/sessions/user/${user.id}`);
        const hData = await hRes.json();
        if (hData.sessions) setHistory(hData.sessions);
        if (sessionId) {
          const aRes = await fetch(`${API}/api/negotiation/session/active?clerk_user_id=${user.id}`);
          const aData = await aRes.json();
            if (aData.session && aData.session.id === sessionId) {
              setSessionStatus(aData.session.status);
              setFinalPrice(aData.finalPrice);
              if (aData.session.expires_at) setSessionExpiry(new Date(aData.session.expires_at));
              if (aData.messages && aData.messages.length > messages.length) setMessages(aData.messages);
            } else if (!aData.session) {
              // If we are viewing a session that the active endpoint says doesn't exist, it must be terminated.
              // Let history poll update it, but immediately fail-safe the status if it was active.
              if (sessionStatus === 'ACTIVE') setSessionStatus('TERMINATED');
            }
        }
      } catch (e) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [user?.id, sessionId, messages.length, sessionStatus]);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;
    if (!searchQuery) setQuery(q);
    setSearching(true);
    try {
      const r = await fetch(`${API}/api/discovery/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setProducts(d.products || []);
    } catch (e: any) {
      toast.error(`Search failed: ${e.message}`);
    } finally { setSearching(false); }
  };

  const updateCartQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.id === id) { const newQ = c.quantity + delta; return newQ > 0 ? { ...c, quantity: newQ } : c; }
      return c;
    }));
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id);
      if (existing) return prev.map(c => c.id === product.id ? { ...c, quantity: c.quantity + 1, outOfStock: false } : c);
      return [...prev, { ...product, quantity: 1, outOfStock: false }];
    });
    toast.success('Added to cart');
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleStartOrUpdateClick = () => {
    if (!user) return toast.error('Please Sign In to start negotiating.');
    if (cart.length === 0) return toast.error('Cart is empty');
    if (sessionId && sessionStatus === 'ACTIVE') { setShowSessionModal(true); return; }
    startNegotiation(false);
  };

  const startNegotiation = async (abandonFirst: boolean) => {
    setShowSessionModal(false);
    if (abandonFirst && sessionId && sessionStatus === 'ACTIVE') {
      try {
        await fetch(`${API}/api/negotiation/session/${sessionId}/terminate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clerk_user_id: user!.id })
        });
      } catch (e) {}
    }
    setSending(true);
    try {
      const r = await fetch(`${API}/api/negotiation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer_type: 'HUMAN', cart: cart.map(c => ({ product_id: c.id, quantity: c.quantity })), clerk_user_id: user!.id })
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.out_of_stock_product_id) { setCart(prev => prev.map(c => c.id === d.out_of_stock_product_id ? { ...c, outOfStock: true } : c)); setView('cart'); }
        throw new Error(d.error);
      }
      setSessionId(d.session_id);
      setSessionStatus('ACTIVE');
      setRound(0);
      setMessages([{ role: 'AGENT', content: "Welcome! I can see your cart. Tell me your target price or ask for our best offer and I'll put together a detailed breakdown for you." }]);
      setView('chat');
      if (user?.id) loadSessionData(user.id);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally { setSending(false); }
  };

  const updateActiveNegotiation = async () => {
    setShowSessionModal(false);
    if (!sessionId || cart.length === 0) return;
    setSending(true);
    try {
      const r = await fetch(`${API}/api/negotiation/session/${sessionId}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart.map(c => ({ product_id: c.id, quantity: c.quantity })) })
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.out_of_stock_product_id) { setCart(prev => prev.map(c => c.id === d.out_of_stock_product_id ? { ...c, outOfStock: true } : c)); setView('cart'); }
        throw new Error(d.error);
      }
      setRound(0);
      toast.success('Cart synced! The AI will adjust its offer for your new cart.');
      setView('chat');
    } catch (e: any) {
      toast.error(`Failed to update cart: ${e.message}`);
    } finally { setSending(false); }
  };

  const abandonSession = async () => {
    if (!sessionId || !user) return;
    setSending(true);
    const idToAbandon = sessionId;
    try {
      await fetch(`${API}/api/negotiation/session/${idToAbandon}/terminate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_user_id: user.id })
      });
      // Instantly update history so it doesn't appear ACTIVE in the sidebar
      setHistory(prev => prev.map(h => h.id === idToAbandon ? { ...h, status: 'TERMINATED', terminated_reason: 'ABANDONED_BY_CUSTOMER' } : h));
      
      setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setFinalPrice(null); setSessionExpiry(null);
      setView('search');
      toast.success('Negotiation abandoned. Stock released.');
      // Do not call loadSessionData here to avoid loading older active sessions if any exist
    } catch (e: any) {
      toast.error('Failed to abandon session');
    } finally { setSending(false); }
  };

  const loadHistoricalSession = async (h: SessionHistory) => {
    if (h.status === 'ACTIVE' || h.status === 'PENDING_MERCHANT_REVIEW') { setSessionId(h.id); setView('chat'); return; }
    try {
      const r = await fetch(`${API}/api/admin/sessions/${h.id}/messages`, {
        headers: { 'x-merchant-key': process.env.NEXT_PUBLIC_MERCHANT_KEY || '' }
      });
      const d = await r.json();
      if (r.ok && d.messages) {
        setSessionId(h.id); setSessionStatus(h.status);
        setMessages(d.messages.map((m: any) => ({ role: m.role, content: m.content, final_price: m.metadata?.finalOffer || null })));
        setView('chat');
      } else { toast.error('Could not load session history'); }
    } catch (e) { toast.error('Could not load session history'); }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'USER', content: msg }]);
    setSending(true);
    try {
      const r = await fetch(`${API}/api/negotiation/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId! },
        body: JSON.stringify({ message: msg })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRound(d.round);
      if (d.status !== 'ACTIVE') setSessionStatus(d.status);
      if (d.final_price) setFinalPrice(d.final_price);
      setMessages(prev => [...prev, { role: 'AGENT', content: d.reply, final_price: d.final_price }]);
    } catch (e: any) {
      toast.error(`Failed to send: ${e.message}`);
      setMessages(prev => prev.slice(0, -1));
    } finally { setSending(false); }
  };

  const submitCheckout = async () => {
    if (!phone || !address) return toast.error('Phone and Address are required.');
    const loadToast = toast.loading('Creating Order...');
    try {
      const res = await fetch(`${API}/api/checkout/create-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, customer_name: user?.fullName, customer_email: user?.primaryEmailAddress?.emailAddress, customer_phone: phone, shipping_address: address })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.dismiss(loadToast);
      setShowCheckout(false);
      const options = {
        key: data.key_id, amount: data.amount, currency: data.currency,
        name: 'Nexus Electronics', description: 'Order Checkout', order_id: data.order_id,
        handler: async function (response: any) {
          const vRes = await fetch(`${API}/api/checkout/verify-payment`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature, session_id: sessionId })
          });
          const vData = await vRes.json();
          if (vRes.ok) { toast.success('Payment Successful! Order Confirmed.'); setSessionStatus('COMPLETED'); setCart([]); localStorage.removeItem('nexus_cart'); }
          else { toast.error(`Verification Failed: ${vData.error}`); }
        },
        prefill: { name: user?.fullName || '', email: user?.primaryEmailAddress?.emailAddress || '', contact: phone },
        theme: { color: '#1E5EDB' },
        config: {
          display: {
            blocks: {
              upi: { name: 'Pay via UPI (Test)', instruments: [{ method: 'upi' }] },
              card: { name: 'Pay via Card (Test)', instruments: [{ method: 'card' }] }
            },
            sequence: ['block.upi', 'block.card'],
            preferences: { show_default_blocks: true }
          }
        }
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (response: any) { toast.error(`Payment Failed: ${response.error.description}`); });
      rzp.open();
    } catch (e: any) {
      toast.dismiss(loadToast);
      toast.error(`Checkout failed: ${e.message}`);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <Nav active="shop" cartCount={cartItemCount} />
      {sessionStatus === 'COMPLETED' && <Confetti width={width} height={height} recycle={false} numberOfPieces={500} />}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* SIDEBAR */}
        <div style={{ width: '280px', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px' }}>Chat History</h3>
            
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
              {(['ALL', 'ACTIVE', 'REVIEW', 'CLOSED'] as const).map(f => (
                <button key={f} onClick={() => setHistoryFilter(f)} 
                  className={`btn btn-sm ${historyFilter === f ? 'btn-primary' : ''}`}
                  style={{ padding: '4px 10px', fontSize: '0.7rem', flexShrink: 0, background: historyFilter === f ? 'var(--cobalt)' : 'transparent', color: historyFilter === f ? 'white' : 'var(--text-secondary)', border: historyFilter === f ? 'none' : '1px solid var(--border)' }}>
                  {f}
                </button>
              ))}
            </div>

            {history.filter(h => {
              if (historyFilter === 'ACTIVE') return h.status === 'ACTIVE';
              if (historyFilter === 'REVIEW') return h.status === 'PENDING_MERCHANT_REVIEW';
              if (historyFilter === 'CLOSED') return ['APPROVED', 'COMPLETED', 'TERMINATED'].includes(h.status);
              return true;
            }).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💬</div>
                <div style={{ fontSize: '0.85rem' }}>No past negotiations.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {history.filter(h => {
                  if (historyFilter === 'ACTIVE') return h.status === 'ACTIVE';
                  if (historyFilter === 'REVIEW') return h.status === 'PENDING_MERCHANT_REVIEW';
                  if (historyFilter === 'CLOSED') return ['APPROVED', 'COMPLETED', 'TERMINATED'].includes(h.status);
                  return true;
                }).map(h => (
                  <div key={h.id} onClick={() => loadHistoricalSession(h)}
                    style={{ padding: '12px', background: sessionId === h.id ? 'var(--bg-primary)' : 'transparent', border: sessionId === h.id ? '1px solid var(--border)' : '1px solid transparent', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{formatCurrency(h.cart_total)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{timeAgo(h.created_at)}</span>
                      <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: h.status === 'COMPLETED' ? 'var(--success-bg)' : h.status === 'ACTIVE' ? 'var(--cobalt-light)' : 'var(--bg-primary)', color: h.status === 'COMPLETED' ? 'var(--success)' : h.status === 'ACTIVE' ? 'var(--cobalt)' : 'var(--text-muted)' }}>
                        {h.status === 'TERMINATED' && h.terminated_reason === 'ABANDONED_BY_CUSTOMER' ? 'ABANDONED' : h.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center' }}>
            <button className={`btn ${view === 'search' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('search')}>Search Catalog</button>
            <button className={`btn ${view === 'cart' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('cart')} style={{ position: 'relative' }}>
              View Cart
              {cartItemCount > 0 && (
                <span style={{ position: 'absolute', top: '-8px', right: '-8px', background: 'var(--cobalt)', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700 }}>
                  {cartItemCount > 99 ? '99+' : cartItemCount}
                </span>
              )}
            </button>
            {sessionId && (
              <button className={`btn ${view === 'chat' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('chat')}>
                {sessionStatus === 'ACTIVE' ? 'Active Negotiation' : sessionStatus === 'PENDING_MERCHANT_REVIEW' ? 'Pending Review' : 'Session View'}
              </button>
            )}
          </div>

          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            {/* SEARCH VIEW */}
            {view === 'search' && (
              <div>
                <form onSubmit={e => { e.preventDefault(); handleSearch(); }} style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                  <input className="input" placeholder='Try "Gaming laptop under 1,50,000"' value={query} onChange={e => setQuery(e.target.value)} style={{ fontSize: '1rem', padding: '14px 18px' }} />
                  <button className="btn btn-primary btn-lg" type="submit" disabled={searching}>{searching ? 'Searching...' : 'Search'}</button>
                </form>
                {products.length === 0 && !searching && (
                  <div style={{ marginBottom: '28px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Try searching for:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {EXAMPLE_QUERIES.map(q => (
                        <button key={q} className="btn btn-secondary btn-sm" onClick={() => { setQuery(q); handleSearch(q); }} style={{ fontSize: '0.8rem' }}>{q}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                  {products.map(p => {
                    const { gradient, icon } = getCategoryStyle(p.category);
                    const inCartQty = cart.find(c => c.id === p.id)?.quantity || 0;
                    return (
                      <div key={p.id} className="product-card">
                        <div style={{ height: '140px', background: gradient, borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem' }}>{icon}</div>
                        <div style={{ marginBottom: '8px' }}>
                          <span className="badge badge-muted" style={{ marginBottom: '10px' }}>{p.category}</span>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '4px', lineHeight: 1.3 }}>{p.name}</h3>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{p.description.substring(0, 80)}...</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '1.05rem' }}>{formatCurrency(p.price)}</div>
                            <div style={{ fontSize: '0.75rem', color: p.available_stock > 0 ? 'var(--success)' : 'var(--danger)' }}>{p.available_stock > 0 ? `${p.available_stock} in stock` : 'Out of stock'}</div>
                          </div>
                          <button className={`btn btn-sm ${inCartQty > 0 ? 'btn-secondary' : 'btn-primary'}`} disabled={p.available_stock <= 0} onClick={() => addToCart(p)}>
                            {inCartQty > 0 ? `In Cart (${inCartQty}) +` : 'Add'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CART VIEW */}
            {view === 'cart' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '24px' }}>Your Cart</h2>
                {cart.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🛒</div>
                    <div>Your cart is empty.</div>
                    <button className="btn btn-primary btn-sm" style={{ marginTop: '16px' }} onClick={() => setView('search')}>Browse Products</button>
                  </div>
                ) : (
                  <>
                    {cart.map(item => (
                      <div key={item.id} className="card" style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', border: item.outOfStock ? '1px solid #ef4444' : undefined, opacity: item.outOfStock ? 0.6 : 1 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: item.outOfStock ? '#ef4444' : 'inherit' }}>
                            {item.name}
                            {item.outOfStock && <span style={{ fontSize: '0.7rem', marginLeft: '8px', padding: '2px 7px', background: '#ef4444', color: 'white', borderRadius: '4px', verticalAlign: 'middle' }}>OUT OF STOCK</span>}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{formatCurrency(item.price)} each</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '8px' }}>
                            <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem' }} onClick={() => updateCartQuantity(item.id, -1)}>-</button>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, minWidth: '24px', textAlign: 'center' }}>{item.quantity}</span>
                            <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem' }} onClick={() => updateCartQuantity(item.id, 1)}>+</button>
                          </div>
                          <span style={{ fontWeight: '700', fontSize: '1.05rem', minWidth: '90px', textAlign: 'right' }}>{formatCurrency(item.price * item.quantity)}</span>
                          <button className="btn btn-danger btn-sm" onClick={() => removeFromCart(item.id)}>x</button>
                        </div>
                      </div>
                    ))}
                    <div className="card" style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total before negotiation</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>{formatCurrency(cartTotal)}</div>
                      </div>
                      <button className="btn btn-primary btn-lg" onClick={handleStartOrUpdateClick} disabled={sending}>
                        {sending ? 'Starting...' : 'Start Negotiating'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* CHAT VIEW */}
            {view === 'chat' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                      {['ACTIVE', 'PENDING_MERCHANT_REVIEW'].includes(sessionStatus) ? 'Negotiate Your Deal' : 'Session History (Read-Only)'}
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {sessionStatus === 'ACTIVE' && round > 0 && `Round ${round} of ${maxRounds} - `}
                      Original: {formatCurrency(cartTotal)}
                      {timeLeft && sessionStatus === 'ACTIVE' && (
                        <span style={{ marginLeft: '10px', color: timeLeft.startsWith('0:') ? '#ef4444' : 'var(--text-muted)' }}> | {timeLeft} remaining</span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {sessionStatus !== 'ACTIVE' && (
                      <span className={`badge ${sessionStatus === 'PENDING_MERCHANT_REVIEW' ? 'badge-warning' : sessionStatus === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}>
                        {sessionStatus === 'TERMINATED' && history.find(h => h.id === sessionId)?.terminated_reason === 'ABANDONED_BY_CUSTOMER' ? 'ABANDONED' : sessionStatus.replace(/_/g, ' ')}
                      </span>
                    )}
                    {sessionStatus === 'ACTIVE' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowAbandonModal(true)}>Abandon</button>
                    )}
                  </div>
                </div>
                <div className="chat-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="chat-messages" style={{ flex: 1, overflowY: 'auto' }}>
                    {messages.filter(m => m.role !== 'SYSTEM').map((m, i) => (
                      <div key={i} className={`chat-bubble ${m.role === 'USER' ? 'chat-bubble-user' : 'chat-bubble-agent'}`} style={m.role === 'MERCHANT' ? { border: '1px solid var(--warning)', background: 'var(--warning-bg)' } : {}}>
                        {m.role === 'MERCHANT' && (
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--warning)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Merchant</div>
                        )}
                        <div className="markdown-body"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                        {m.final_price && m.role === 'AGENT' && (
                          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(30, 94, 219, 0.1)', borderRadius: '8px', fontWeight: '600', color: 'var(--cobalt)' }}>
                            Final Offer: {formatCurrency(m.final_price)}
                          </div>
                        )}
                      </div>
                    ))}
                    {sending && (
                      <div className="chat-bubble chat-bubble-agent" style={{ width: 'fit-content' }}>
                        <span className="typing-dot"></span>
                        <span className="typing-dot" style={{ animationDelay: '0.2s' }}></span>
                        <span className="typing-dot" style={{ animationDelay: '0.4s' }}></span>
                      </div>
                    )}
                    <div ref={bottomRef} style={{ height: '1px' }} />
                  </div>
                  {sessionStatus === 'ACTIVE' ? (
                    <div className="chat-input-row" style={{ marginTop: '16px', background: 'var(--bg-secondary)', padding: '12px', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                      <textarea className="input" placeholder="Make your offer... (Enter to send)" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} disabled={sending} style={{ flex: 1, minHeight: '44px', maxHeight: '120px', resize: 'none', padding: '10px 14px' }} rows={1} />
                      <button className="btn btn-primary" onClick={sendMessage} disabled={sending || !input.trim()} style={{ height: '44px' }}>Send</button>
                    </div>
                  ) : sessionStatus === 'PENDING_MERCHANT_REVIEW' ? (
                    <div style={{ padding: '16px 20px', background: 'var(--warning-bg)', textAlign: 'center', borderRadius: '8px', marginTop: '16px', fontSize: '0.9rem', color: 'var(--warning)' }}>
                      Your deal is under merchant review. Please wait...
                    </div>
                  ) : sessionStatus === 'APPROVED' && finalPrice ? (
                    <div style={{ padding: '20px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--success-bg)', borderRadius: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '700', color: 'var(--success)', fontSize: '1.2rem', marginBottom: '4px' }}>Deal Approved!</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Final price: {formatCurrency(finalPrice)}</div>
                      </div>
                      <button className="btn btn-success btn-lg" onClick={() => { if (!user) return toast.error('Please Sign In'); setShowCheckout(true); }}>Proceed to Pay</button>
                    </div>
                  ) : sessionStatus === 'COMPLETED' ? (
                    <div style={{ padding: '24px', marginTop: '16px', background: 'var(--success-bg)', borderRadius: '12px', color: 'var(--text-primary)', border: '1px solid var(--success)' }}>
                      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎉</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.4rem', color: 'var(--success)' }}>Payment Successful!</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Your order has been confirmed.</div>
                      </div>
                      
                      <div style={{ background: 'var(--bg-primary)', padding: '16px', borderRadius: '8px', border: '1px dashed var(--border)', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Order ID:</span>
                          <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{history.find(h => h.id === sessionId)?.id.substring(0, 12).toUpperCase()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Amount Paid:</span>
                          <span style={{ fontWeight: 600, color: 'var(--success)' }}>{formatCurrency(finalPrice)}</span>
                        </div>
                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          A copy of this receipt has been emailed to you (Mock).
                        </div>
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <button className="btn btn-primary" onClick={() => { setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setFinalPrice(null); setView('search'); }}>Back to Shop</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '16px 20px', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: '8px', marginTop: '16px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                      This session has ended.
                      <button className="btn btn-primary btn-sm" style={{ marginLeft: '12px' }} onClick={() => { setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setView('cart'); }}>Start Fresh</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New vs Update Modal */}
      {showSessionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '28px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '8px' }}>You Have an Active Negotiation</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>What would you like to do?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button className="btn btn-primary btn-lg" onClick={updateActiveNegotiation} disabled={sending} style={{ display: 'block', height: 'auto', padding: '14px 20px', textAlign: 'left' }}>
                <div>Update Existing Negotiation</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', fontWeight: 400 }}>Continue with new cart, rounds reset, last price honored</div>
              </button>
              <button className="btn btn-secondary btn-lg" onClick={() => startNegotiation(true)} disabled={sending} style={{ display: 'block', height: 'auto', padding: '14px 20px', textAlign: 'left' }}>
                <div>Start Fresh Negotiation</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', fontWeight: 400 }}>Abandon current deal and begin from scratch</div>
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSessionModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Abandon Modal */}
      {showAbandonModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '16px' }}>Abandon Negotiation?</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
              Are you sure you want to abandon this deal? Your held stock will be released immediately and the negotiation progress will be lost.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowAbandonModal(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { setShowAbandonModal(false); abandonSession(); }}>Abandon Deal</button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '16px' }}>Checkout Details</h2>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>Full Name</label>
              <input className="input" value={user?.fullName || ''} disabled style={{ background: 'var(--bg-secondary)', width: '100%' }} />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>Email</label>
              <input className="input" value={user?.primaryEmailAddress?.emailAddress || ''} disabled style={{ background: 'var(--bg-secondary)', width: '100%' }} />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>Phone Number *</label>
              <input className="input" placeholder="Enter mobile number" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>Shipping Address *</label>
              <textarea className="input" placeholder="Full delivery address" value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', minHeight: '80px', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCheckout(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitCheckout}>Proceed to Pay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
