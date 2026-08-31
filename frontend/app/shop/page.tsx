'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import Script from 'next/script';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import Orchestrator from '../../lib/ThreeJS/Orchestrator';
import '../dashboard/dashboard.css';
import './shop.css';
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
  'laptop': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'desktop': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'keyboard': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'monitor': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'mouse': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'headphone': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'gpu': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'cpu': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'storage': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
  'default': 'linear-gradient(135deg, #e8f4fd 0%, #d6e9fa 100%)',
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
  const { signOut } = useClerk();
  const router = useRouter();
  const isAdmin = user?.primaryEmailAddress?.emailAddress === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  
  const [view, setView] = useState<'search' | 'cart' | 'history' | 'chat'>('search');
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize ThreeJS Background
  useEffect(() => {
    let orchestrator: Orchestrator | null = null;
    if (canvasRef.current) {
      orchestrator = new Orchestrator(canvasRef.current);
    }
    return () => {
      if (orchestrator) orchestrator.destroy();
    };
  }, []);

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

  // Fetch Session History
  useEffect(() => {
    const fetchHistory = async () => {
      if (!user?.id) return;
      try {
        const r = await fetch(`${API}/api/negotiation/sessions/user/${user.id}`);
        const d = await r.json();
        if (d.sessions) setHistory(d.sessions);
      } catch (e) { console.error('Failed to fetch history', e); }
    };
    fetchHistory();
  }, [user?.id, sessionId, sessionStatus]);

  useEffect(() => {
    fetch(`${API}/api/discovery/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' })
    }).then(r => r.json()).then(d => setProducts(d.products || []));
  }, []);

  // Timer Countdown
  useEffect(() => {
    if (!sessionExpiry || sessionStatus !== 'ACTIVE') return;
    const interval = setInterval(() => {
      const diff = sessionExpiry.getTime() - new Date().getTime();
      if (diff <= 0) {
        setTimeLeft('0:00');
        setSessionStatus('TERMINATED');
        clearInterval(interval);
      } else {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionExpiry, sessionStatus]);

  // Clear session if active one expires
  useEffect(() => {
    if (sessionStatus === 'TERMINATED' && sessionId) {
      toast.error('Session expired.');
    }
  }, [sessionStatus, sessionId]);

  const handleSearch = async (overrideQuery?: string) => {
    const q = overrideQuery !== undefined ? overrideQuery : query;
    setSearching(true);
    try {
      const r = await fetch(`${API}/api/discovery/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const d = await r.json();
      setProducts(d.products || []);
    } catch (e) { toast.error('Failed to search'); }
    setSearching(false);
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const ex = prev.find(p => p.id === product.id);
      if (ex) {
        if (ex.quantity >= product.available_stock) { toast.error('Max stock reached'); return prev; }
        return prev.map(p => p.id === product.id ? { ...p, quantity: p.quantity + 1, outOfStock: false } : p);
      }
      return [...prev, { ...product, quantity: 1, outOfStock: false }];
    });
    toast.success('Added to cart');
  };

  const updateCartQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(p => {
      if (p.id === id) {
        const nq = p.quantity + delta;
        if (nq > p.available_stock) { toast.error('Max stock reached'); return p; }
        return nq > 0 ? { ...p, quantity: nq } : p;
      }
      return p;
    }).filter(p => p.quantity > 0));
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(p => p.id !== id));

  const cartItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  const startNegotiation = async (forceNew = false) => {
    if (cart.length === 0) return toast.error('Cart is empty');
    if (!user) return toast.error('Please Sign In to negotiate');
    setSending(true);
    try {
      const payload = {
        buyer_type: 'HUMAN',
        cart: cart.map(i => ({ product_id: i.id, quantity: i.quantity })),
        clerk_user_id: user.id
      };
      
      let url = `${API}/api/negotiation/start`;
      let bodyPayload = payload;

      if (!forceNew && sessionId) {
        url = `${API}/api/negotiation/session/${sessionId}/cart`;
        bodyPayload = { cart: payload.cart } as any;
      }
      
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to start/update negotiation');
      
      if (forceNew || !sessionId) {
        setSessionId(d.session_id);
        setSessionStatus(d.status);
        // Load initial greeting
        const hr = await fetch(`${API}/api/negotiation/session/${d.session_id}`);
        const hd = await hr.json();
        setMessages(hd.session?.messages || []);
      } else {
        // If updated cart, just refetch session messages
        const hr = await fetch(`${API}/api/negotiation/session/${sessionId}`);
        const hd = await hr.json();
        setMessages(hd.session?.messages || []);
        toast.success('Cart updated in negotiation');
      }
      
      setFinalPrice(null);
      setRound(0);
      setView('chat');
      setShowSessionModal(false);
      
      // Update cart to reflect actual reserved state (out of stock items returned by backend)
      if (d.out_of_stock_product_id) {
        setCart(prev => prev.map(p => p.id === d.out_of_stock_product_id ? { ...p, outOfStock: true } : p));
      }

    } catch (e: any) { toast.error(e.message); }
    setSending(false);
  };

  const handleStartOrUpdateClick = () => {
    if (history.some(h => h.status === 'ACTIVE' || h.status === 'PENDING_MERCHANT_REVIEW')) {
      setShowSessionModal(true);
    } else {
      startNegotiation(true);
    }
  };

  const updateActiveNegotiation = async () => {
    startNegotiation(false);
  };

  const abandonSession = async () => {
    if (!sessionId) return;
    try {
      await fetch(`${API}/api/negotiation/session/${sessionId}/terminate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_user_id: user?.id })
      });
      setSessionStatus('TERMINATED');
      toast.error('Deal Abandoned');
      setHistory(prev => prev.map(h => h.id === sessionId ? { ...h, status: 'TERMINATED', terminated_reason: 'ABANDONED_BY_CUSTOMER' } : h));
      setView('cart');
    } catch (e) {
      toast.error('Failed to abandon session');
    }
  };

  const loadHistoricalSession = async (h: SessionHistory) => {
    setSessionId(h.id);
    setSessionStatus(h.status);
    setFinalPrice(null);
    setRound(0);
    setSessionExpiry(null);
    try {
      const r = await fetch(`${API}/api/negotiation/session/${h.id}`);
      const d = await r.json();
      if (d.session) {
        setMessages(d.session.messages || []);
        if (d.session.status === 'COMPLETED' || d.session.status === 'APPROVED') {
            const finalMsg = d.session.messages.slice().reverse().find((m:any) => m.final_price != null);
            if (finalMsg) setFinalPrice(finalMsg.final_price);
        }
      }
      setView('chat');
    } catch (e) { toast.error('Failed to load session'); }
  };

  const sendMessage = async () => {
    if (!input.trim() || !sessionId || sessionStatus !== 'ACTIVE') return;
    const currentInput = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'USER', content: currentInput }]);
    setSending(true);
    try {
      const r = await fetch(`${API}/api/negotiation/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ message: currentInput })
      });
      const d = await r.json();
      if (!r.ok) {
         if (r.status === 400 && d.error === 'Session is no longer active') {
             setSessionStatus('TERMINATED');
             toast.error('Session expired.');
         } else {
             throw new Error(d.error || 'Failed to send');
         }
      } else {
          setMessages(prev => [...prev, { role: 'AGENT', content: d.reply, final_price: d.final_price }]);
          setSessionStatus(d.status);
          setFinalPrice(d.final_price || null);
          setRound(d.round || round);
      }
    } catch (e: any) { toast.error(e.message); }
    setSending(false);
  };

  const submitCheckout = async () => {
    if (!phone || !address) return toast.error('Fill required fields');
    if (!sessionId || !finalPrice) return toast.error('Invalid session');
    
    const loadToast = toast.loading('Processing payment...');
    try {
      const res = await fetch(`${API}/api/checkout/create-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, customer_phone: phone, shipping_address: address })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.dismiss(loadToast);
      setShowCheckout(false);

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: data.amount,
        currency: data.currency,
        name: "Nexus A2A Commerce",
        description: `Order for Session ${sessionId.substring(0,8)}`,
        order_id: data.order_id,
        handler: async function (response: any) {
          const verifyToast = toast.loading('Verifying payment...');
          const vRes = await fetch(`${API}/api/checkout/verify-payment`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...response, session_id: sessionId })
          });
          const vData = await vRes.json();
          toast.dismiss(verifyToast);
          if (vRes.ok) {
            toast.success('Payment Successful!');
            setSessionStatus('COMPLETED');
            setCart([]); 
          } else {
            toast.error(vData.error || 'Verification failed');
          }
        },
        prefill: { name: user?.fullName, email: user?.primaryEmailAddress?.emailAddress, contact: phone },
        theme: { color: "#0055ff" },
        config: {
          display: {
            blocks: {
              banks: { name: 'Most Used Methods', instruments: [{ method: 'upi' }, { method: 'card' }] },
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
    <>
      {/* 3D Background */}
      <canvas ref={canvasRef} className="webgl"></canvas>
      
      {/* Overlay Content */}
      <div className="shop-overlay-content">
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
        {sessionStatus === 'COMPLETED' && <Confetti width={width} height={height} recycle={false} numberOfPieces={500} />}
        
        {/* ── Top Navbar ─────────────────────────────────────────── */}
        <nav className="tbl-navbar" style={{ background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
          <div className="tbl-container-inner">
              <a className="tbl-navbar-brand" href="/" style={{ fontFamily: 'Inter, sans-serif' }}>
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="32" height="32" rx="8" fill="#616161" />
                  <path d="M10 16L16 10L22 16" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Nexus A2A
              </a>
              <div className="tbl-navbar-actions">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '1rem', marginLeft: '0.5rem' }}>
                  {user ? (
                      <>
                      <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#616161' }}>{user.firstName || 'Customer'}</div>
                          <div style={{ fontSize: '0.8rem', color: '#616161' }}>{user.primaryEmailAddress?.emailAddress}</div>
                      </div>
                      <img src={user.imageUrl} alt="Profile" className="tbl-avatar" />
                      <button className="tbl-btn" style={{ marginLeft: '1rem', borderColor: '#d63939', color: '#d63939' }} onClick={() => signOut(() => router.push('/'))}>
                          Sign out
                      </button>
                      </>
                  ) : (
                      <div style={{ fontSize: '0.9rem', color: '#616161' }}>Guest User</div>
                  )}
              </div>
              </div>
          </div>
        </nav>

        {/* ── Sub Navbar ─────────────────────────────────────────── */}
        <div className="tbl-subnav" style={{ background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
          <div className="tbl-container-inner">
              <div style={{ display: 'flex' }}>
              <a href="#" className={view === 'search' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setView('search'); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  Search Catalog
              </a>
              <a href="#" className={view === 'cart' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setView('cart'); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                  View Cart
                  {cartItemCount > 0 && <span className="tbl-badge-new">{cartItemCount > 9 ? '9+' : cartItemCount}</span>}
              </a>
              <a href="#" className={view === 'history' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setView('history'); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"></path><circle cx="12" cy="12" r="10"></circle></svg>
                  Session History
              </a>
              {sessionId && (
                  <a href="#" className={view === 'chat' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setView('chat'); }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                      Active Chat
                  </a>
              )}
              </div>
          </div>
        </div>

        {/* ── Main Container ─────────────────────────────────────── */}
        <div className="tbl-container" style={{ marginTop: '2.5rem', marginBottom: '5rem' }}>
          
          {/* Welcome Dashboard Header */}
          {view === 'search' && (
            <div className="glass-card" style={{ display: 'flex', marginBottom: '2.5rem', padding: 0 }}>
              <div style={{ flex: '1 1 50%', padding: '2.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#616161', marginBottom: '0.5rem', fontFamily: 'Inter, sans-serif' }}>
                      Welcome back, {user?.firstName || 'Customer'}
                    </h2>
                    <p style={{ color: '#616161', fontSize: '1.05rem', maxWidth: '400px' }}>
                      Browse our premium catalog, add items to your cart, and negotiate the best price with our AI Agent.
                    </p>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '3rem', marginTop: '2rem' }}>
                    <div className="tbl-stat-mini" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#616161', textTransform: 'uppercase' }}>Cart Value</label>
                      <div className="value-row">
                        <span className="num" style={{ fontSize: '1.4rem' }}>{formatCurrency(cartTotal)}</span>
                      </div>
                    </div>
                    <div className="tbl-stat-mini" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#616161', textTransform: 'uppercase' }}>Past Deals</label>
                      <div className="value-row">
                        <span className="num" style={{ fontSize: '1.4rem' }}>{history.filter(h => h.status === 'COMPLETED').length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ flex: '1 1 50%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid rgba(255, 255, 255, 0.15)' }}>
                <img src="/welcome-icon.jpg" alt="Welcome" style={{ width: '100%', maxWidth: '280px', height: 'auto', objectFit: 'contain', mixBlendMode: 'multiply' }} />
              </div>
            </div>
          )}

          {/* SEARCH VIEW */}
          {view === 'search' && (
            <div>
              <form onSubmit={e => { e.preventDefault(); handleSearch(); }} className="glass-search-bar">
                <input className="glass-search-input" placeholder='Try "Gaming laptop under 1,50,000"' value={query} onChange={e => setQuery(e.target.value)} />
                <button className="tbl-btn tbl-btn-primary" type="submit" disabled={searching} style={{ padding: '10px 24px', fontSize: '1.05rem', borderRadius: '100px' }}>
                  {searching ? 'Searching...' : 'Search Catalog'}
                </button>
              </form>
              
              {products.length === 0 && !searching && (
                <div style={{ marginBottom: '28px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.9rem', color: '#616161', marginBottom: '16px', fontWeight: 600 }}>Suggested Searches:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                    {EXAMPLE_QUERIES.map(q => (
                      <button key={q} className="glass-card" onClick={() => { setQuery(q); handleSearch(q); }} style={{ padding: '8px 16px', fontSize: '0.85rem', cursor: 'pointer', border: 'none', color: '#616161', fontWeight: 600 }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid-4-col">
                {products.map(p => {
                  const { gradient, icon } = getCategoryStyle(p.category);
                  const inCartQty = cart.find(c => c.id === p.id)?.quantity || 0;
                  return (
                    <div key={p.id} className="glass-card tbl-card" style={{ marginBottom: 0 }}>
                      <div style={{ height: '160px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4rem', opacity: 0.8 }}>{icon}</div>
                      <div className="tbl-card-body">
                        <span className="tbl-badge tbl-badge-secondary" style={{ marginBottom: '12px' }}>{p.category}</span>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', marginBottom: '6px', lineHeight: 1.3, color: '#616161' }}>{p.name}</h3>
                        <p style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.5, minHeight: '40px' }}>{p.description.substring(0, 75)}...</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                          <div>
                            <div style={{ fontWeight: '800', fontSize: '1.15rem', color: '#616161' }}>{formatCurrency(p.price)}</div>
                            <div style={{ fontSize: '0.75rem', color: p.available_stock > 0 ? '#2fb344' : '#d63939' }}>{p.available_stock > 0 ? `${p.available_stock} available` : 'Out of stock'}</div>
                          </div>
                          <button className={`tbl-btn tbl-btn-sm ${inCartQty > 0 ? 'tbl-btn-secondary' : 'tbl-btn-primary'}`} disabled={p.available_stock <= 0} onClick={() => addToCart(p)}>
                            {inCartQty > 0 ? `In Cart (${inCartQty}) +` : 'Add to Cart'}
                          </button>
                        </div>
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
              <div className="glass-card" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#616161', marginBottom: '4px' }}>Ready to Negotiate?</h2>
                  <p style={{ color: '#616161', margin: 0 }}>Review your items and start the AI negotiation process to get the best deal.</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', color: '#616161', textTransform: 'uppercase', fontWeight: 600 }}>Total Value</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#616161' }}>{formatCurrency(cartTotal)}</div>
                </div>
                <button className="tbl-btn tbl-btn-primary" onClick={handleStartOrUpdateClick} disabled={sending || cart.length === 0} style={{ padding: '12px 24px', fontSize: '1.1rem' }}>
                  {sending ? 'Starting...' : 'Start Negotiation'}
                </button>
              </div>

              {cart.length === 0 ? (
                <div className="glass-card" style={{ textAlign: 'center', padding: '80px 0', color: '#616161' }}>
                  <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🛒</div>
                  <div style={{ fontSize: '1.1rem' }}>Your cart is empty.</div>
                  <button className="tbl-btn tbl-btn-primary" style={{ marginTop: '24px' }} onClick={() => setView('search')}>Browse Products</button>
                </div>
              ) : (
                <div className="grid-4-col">
                  {cart.map(item => {
                    const { gradient, icon } = getCategoryStyle(item.category);
                    return (
                      <div key={item.id} className="glass-card tbl-card" style={{ opacity: item.outOfStock ? 0.6 : 1, marginBottom: 0 }}>
                        <div style={{ height: '120px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', position: 'relative', opacity: 0.8 }}>
                          {icon}
                          {item.outOfStock && (
                            <span className="tbl-badge tbl-badge-danger" style={{ position: 'absolute', top: '10px', right: '10px', padding: '4px 8px', fontSize: '0.7rem' }}>OUT OF STOCK</span>
                          )}
                        </div>
                        <div className="tbl-card-body">
                          <h3 style={{ fontSize: '0.95rem', fontWeight: '700', marginBottom: '4px', color: '#616161', lineHeight: 1.3 }}>{item.name}</h3>
                          <div style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '16px' }}>{formatCurrency(item.price)} each</div>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.05)', padding: '4px 8px', borderRadius: '6px' }}>
                              <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold', color: '#616161' }} onClick={() => updateCartQuantity(item.id, -1)}>-</button>
                              <span style={{ fontSize: '0.95rem', fontWeight: 700, minWidth: '24px', textAlign: 'center', color: '#616161' }}>{item.quantity}</span>
                              <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold', color: '#616161' }} onClick={() => updateCartQuantity(item.id, 1)}>+</button>
                            </div>
                            <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#616161' }}>
                              {formatCurrency(item.price * item.quantity)}
                            </div>
                          </div>
                          <button className="tbl-btn tbl-btn-secondary" style={{ width: '100%', marginTop: '16px', color: '#616161', border: '1px solid rgba(214, 57, 57, 0.2)', background: 'rgba(214, 57, 57, 0.05)' }} onClick={() => removeFromCart(item.id)}>
                            Remove Item
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* HISTORY VIEW */}
          {view === 'history' && (
            <div className="glass-card tbl-card">
              <div className="tbl-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="tbl-card-title">Session History</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['ALL', 'ACTIVE', 'REVIEW', 'CLOSED'] as const).map(f => (
                    <button key={f} onClick={() => setHistoryFilter(f)} 
                      className={`tbl-btn tbl-btn-sm ${historyFilter === f ? 'tbl-btn-primary' : 'tbl-btn-secondary'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="tbl-table-responsive">
                <table className="tbl-table tbl-table-vcenter" style={{ background: 'transparent' }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Session ID</th>
                      <th>Cart Value</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.filter(h => {
                      if (historyFilter === 'ACTIVE') return h.status === 'ACTIVE';
                      if (historyFilter === 'REVIEW') return h.status === 'PENDING_MERCHANT_REVIEW';
                      if (historyFilter === 'CLOSED') return ['APPROVED', 'COMPLETED', 'TERMINATED'].includes(h.status);
                      return true;
                    }).length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#62778d' }}>No past negotiations found.</td></tr>
                    ) : history.filter(h => {
                      if (historyFilter === 'ACTIVE') return h.status === 'ACTIVE';
                      if (historyFilter === 'REVIEW') return h.status === 'PENDING_MERCHANT_REVIEW';
                      if (historyFilter === 'CLOSED') return ['APPROVED', 'COMPLETED', 'TERMINATED'].includes(h.status);
                      return true;
                    }).map(h => (
                      <tr key={h.id}>
                        <td style={{ color: '#62778d', fontSize: '0.85rem' }}>{timeAgo(h.created_at)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{h.id.substring(0, 12)}</td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(h.cart_total)}</td>
                        <td>
                          <span className={`tbl-badge ${h.status === 'COMPLETED' ? 'tbl-badge-success' : h.status === 'ACTIVE' ? 'tbl-badge-primary' : 'tbl-badge-secondary'}`}>
                            {h.status === 'TERMINATED' && h.terminated_reason === 'ABANDONED_BY_CUSTOMER' ? 'ABANDONED' : h.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          <button className="tbl-btn tbl-btn-sm tbl-btn-secondary" onClick={() => loadHistoricalSession(h)}>
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Chat Modal Overlay */}
        {view === 'chat' && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(24, 36, 51, 0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div className="tbl-card" style={{ width: '100%', maxWidth: '800px', height: '80vh', display: 'flex', flexDirection: 'column', margin: '20px', background: '#ffffff' }}>
              <div className="tbl-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'rgba(255, 255, 255, 0.5)' }}>
                <div>
                  <h3 className="tbl-card-title" style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                    {['ACTIVE', 'PENDING_MERCHANT_REVIEW'].includes(sessionStatus) ? 'Negotiate Your Deal' : 'Session History (Read-Only)'}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#62778d', marginTop: '2px', marginBottom: 0 }}>
                    {sessionStatus === 'ACTIVE' && round > 0 && `Round ${round} of ${maxRounds} - `}
                    Original: {formatCurrency(cartTotal)}
                    {timeLeft && sessionStatus === 'ACTIVE' && (
                      <span style={{ marginLeft: '10px', color: timeLeft.startsWith('0:') ? '#d63939' : '#62778d' }}> | {timeLeft} remaining</span>
                    )}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  {sessionStatus !== 'ACTIVE' && (
                    <span className={`tbl-badge ${sessionStatus === 'PENDING_MERCHANT_REVIEW' ? 'tbl-badge-warning' : sessionStatus === 'APPROVED' ? 'tbl-badge-success' : 'tbl-badge-secondary'}`}>
                      {sessionStatus === 'TERMINATED' && history.find(h => h.id === sessionId)?.terminated_reason === 'ABANDONED_BY_CUSTOMER' ? 'ABANDONED' : sessionStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                  {sessionStatus === 'ACTIVE' && (
                    <button className="tbl-btn tbl-btn-secondary tbl-btn-sm" onClick={() => setShowAbandonModal(true)} style={{ color: '#d63939', borderColor: '#d63939' }}>Abandon</button>
                  )}
                  <button className="tbl-btn tbl-btn-secondary tbl-btn-sm" onClick={() => {
                    if (sessionStatus !== 'ACTIVE' && sessionStatus !== 'PENDING_MERCHANT_REVIEW') {
                      setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setView('history');
                    } else {
                      setView('history');
                    }
                  }} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', padding: '4px 8px' }}>✕</button>
                </div>
              </div>

              <div className="chat-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}>
                <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {messages.map((m, i) => {
                    const isUser = m.role === 'USER';
                    const isSystem = m.role === 'SYSTEM';
                    return (
                      <div key={i} style={{ 
                          padding: '1rem', 
                          borderRadius: '12px', 
                          maxWidth: '75%', 
                          alignSelf: isSystem ? 'center' : (isUser ? 'flex-end' : 'flex-start'),
                          background: isSystem ? 'transparent' : (isUser ? '#0055ff' : 'rgba(255, 255, 255, 0.85)'),
                          color: isSystem ? '#a3a3a3' : (isUser ? '#fff' : '#182433'),
                          border: isSystem ? 'none' : (isUser ? 'none' : '1px solid rgba(255,255,255,0.3)'),
                          textAlign: isSystem ? 'center' : 'left',
                          boxShadow: isUser ? '0 4px 12px rgba(0,85,255,0.2)' : '0 4px 12px rgba(0,0,0,0.05)'
                      }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: '0.25rem', textTransform: 'uppercase', fontWeight: 600 }}>{m.role === 'AGENT' ? 'AI Agent' : m.role}</div>
                        <div className="markdown-body" style={{ fontSize: '0.95rem' }}><ReactMarkdown>{m.content}</ReactMarkdown></div>
                        {m.final_price && m.role === 'AGENT' && (
                          <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(0, 85, 255, 0.1)', borderRadius: '4px', fontSize: '0.85rem' }}>
                            <strong style={{ color: '#0055ff' }}>Final Offer: {formatCurrency(m.final_price)}</strong>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sending && (
                    <div style={{ padding: '1rem', borderRadius: '12px', maxWidth: '75%', alignSelf: 'flex-start', background: 'rgba(255, 255, 255, 0.85)', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                      <span className="typing-dot" style={{ background: '#182433' }}></span>
                      <span className="typing-dot" style={{ animationDelay: '0.2s', background: '#182433' }}></span>
                      <span className="typing-dot" style={{ animationDelay: '0.4s', background: '#182433' }}></span>
                    </div>
                  )}
                  <div ref={bottomRef} style={{ height: '1px' }} />
                </div>
                
                {sessionStatus === 'ACTIVE' ? (
                  <div className="chat-input-row" style={{ marginTop: '16px', background: 'rgba(255, 255, 255, 0.85)', padding: '12px', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'flex-end', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                    <textarea className="tbl-input" placeholder="Make your offer... (Enter to send)" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} disabled={sending} style={{ flex: 1, minHeight: '44px', maxHeight: '120px', resize: 'none', padding: '10px 14px', background: 'transparent', border: 'none', outline: 'none', color: '#182433' }} rows={1} />
                    <button className="tbl-btn tbl-btn-primary" onClick={sendMessage} disabled={sending || !input.trim()} style={{ height: '44px' }}>Send</button>
                  </div>
                ) : sessionStatus === 'PENDING_MERCHANT_REVIEW' ? (
                  <div style={{ padding: '12px 16px', background: '#fff9db', textAlign: 'center', borderRadius: '8px', marginTop: '16px', fontSize: '0.9rem', color: '#f59f00', border: '1px solid #f59f00', alignSelf: 'center', width: '100%', maxWidth: '600px' }}>
                    Your deal is under merchant review. Please wait...
                  </div>
                ) : sessionStatus === 'APPROVED' && finalPrice ? (
                  <div style={{ padding: '16px 20px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(229, 246, 232, 0.95)', border: '1px solid #2fb344', borderRadius: '12px', backdropFilter: 'blur(8px)', width: '100%', boxShadow: '0 4px 12px rgba(47, 179, 68, 0.15)' }}>
                    <div>
                      <div style={{ fontWeight: '700', color: '#2fb344', fontSize: '1.1rem', marginBottom: '4px' }}>Deal Approved!</div>
                      <div style={{ fontSize: '0.9rem', color: '#182433' }}>Final price: {formatCurrency(finalPrice)}</div>
                    </div>
                    <button className="tbl-btn tbl-btn-primary" onClick={() => { if (!user) return toast.error('Please Sign In'); setShowCheckout(true); }} style={{ background: '#2fb344', borderColor: '#2fb344' }}>Proceed to Pay</button>
                  </div>
                ) : sessionStatus === 'COMPLETED' ? (
                  <div style={{ padding: '16px 20px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(229, 246, 232, 0.95)', border: '1px solid #2fb344', borderRadius: '12px', backdropFilter: 'blur(8px)', width: '100%', boxShadow: '0 4px 12px rgba(47, 179, 68, 0.15)' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ fontSize: '2rem' }}>🎉</div>
                      <div>
                        <div style={{ fontWeight: '700', color: '#2fb344', fontSize: '1.1rem', marginBottom: '4px' }}>Payment Successful!</div>
                        <div style={{ fontSize: '0.85rem', color: '#182433' }}>Order ID: {history.find(h => h.id === sessionId)?.id.substring(0, 12).toUpperCase()} | Amount: {formatCurrency(finalPrice)}</div>
                      </div>
                    </div>
                    <button className="tbl-btn tbl-btn-secondary tbl-btn-sm" style={{ color: '#2fb344', borderColor: '#2fb344', background: 'transparent' }} onClick={() => { setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setView('history'); }}>Close Session</button>
                  </div>
                ) : (
                  <div style={{ padding: '12px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.85)', borderRadius: '8px', marginTop: '16px', color: '#182433', fontSize: '0.88rem', border: '1px solid rgba(0,0,0,0.1)', alignSelf: 'center', width: '100%' }}>
                    This session has ended.
                    <button className="tbl-btn tbl-btn-primary tbl-btn-sm" style={{ marginLeft: '12px' }} onClick={() => { setSessionId(null); setSessionStatus('ACTIVE'); setMessages([]); setView('history'); }}>Go to History</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* New vs Update Modal */}
        {showSessionModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(24, 36, 51, 0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div className="tbl-card" style={{ width: '100%', maxWidth: '440px', padding: 0, overflow: 'hidden', background: '#ffffff' }}>
              <div style={{ padding: '24px', background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <h3 className="tbl-card-title" style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: 0, color: '#616161' }}>Active Negotiation Found</h3>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginTop: '4px', opacity: 0.8 }}>What would you like to do?</p>
              </div>
              <div className="tbl-card-body" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button className="tbl-btn tbl-btn-primary" onClick={updateActiveNegotiation} disabled={sending} style={{ display: 'block', height: 'auto', padding: '14px 20px', textAlign: 'left', borderRadius: '8px' }}>
                    <div>Update Existing Negotiation</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', fontWeight: 400 }}>Continue with new cart, rounds reset, last price honored</div>
                  </button>
                  <button className="tbl-btn tbl-btn-secondary" onClick={() => startNegotiation(true)} disabled={sending} style={{ display: 'block', height: 'auto', padding: '14px 20px', textAlign: 'left', borderRadius: '8px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#616161' }}>
                    <div>Start Fresh Negotiation</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', fontWeight: 400 }}>Abandon current deal and begin from scratch</div>
                  </button>
                  <button className="tbl-btn" onClick={() => setShowSessionModal(false)} style={{ background: 'transparent', color: '#616161', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', borderRadius: '100px', alignSelf: 'flex-end', marginTop: '8px' }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Abandon Modal */}
        {showAbandonModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(24, 36, 51, 0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div className="tbl-card" style={{ width: '100%', maxWidth: '400px', padding: 0, overflow: 'hidden', background: '#ffffff' }}>
              <div style={{ padding: '24px', background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <h3 className="tbl-card-title" style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: 0, color: '#616161' }}>Abandon Negotiation?</h3>
              </div>
              <div className="tbl-card-body" style={{ padding: '24px' }}>
                <p style={{ fontSize: '0.95rem', color: '#616161', marginBottom: '24px', lineHeight: 1.5 }}>
                  Are you sure you want to abandon this deal? Your held stock will be released immediately and the negotiation progress will be lost.
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button className="tbl-btn" onClick={() => setShowAbandonModal(false)} style={{ background: 'transparent', color: '#616161', border: '1px solid rgba(255,255,255,0.2)', padding: '8px 16px', borderRadius: '100px' }}>Cancel</button>
                  <button className="tbl-btn tbl-btn-danger" onClick={() => { setShowAbandonModal(false); abandonSession(); }} style={{ padding: '8px 16px', borderRadius: '100px', background: '#d63939', borderColor: '#d63939' }}>Abandon Deal</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Checkout Modal */}
        {showCheckout && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(24, 36, 51, 0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div className="tbl-card" style={{ width: '100%', maxWidth: '450px', padding: 0, overflow: 'hidden', background: '#ffffff' }}>
              <div style={{ padding: '24px', background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <h3 className="tbl-card-title" style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: 0, color: '#616161', fontFamily: 'Inter, sans-serif' }}>Shipping Details</h3>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginTop: '4px', opacity: 0.8 }}>Where should we send your items?</p>
              </div>
              <div className="tbl-card-body" style={{ padding: '24px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#616161', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Full Name</label>
                  <input className="glass-search-input" value={user?.fullName || ''} disabled style={{ width: '100%', borderRadius: '8px', padding: '12px 16px', fontSize: '0.95rem', opacity: 0.7 }} />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#616161', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
                  <input className="glass-search-input" value={user?.primaryEmailAddress?.emailAddress || ''} disabled style={{ width: '100%', borderRadius: '8px', padding: '12px 16px', fontSize: '0.95rem', opacity: 0.7 }} />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#616161', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone Number *</label>
                  <input className="glass-search-input" placeholder="Enter mobile number" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: '100%', borderRadius: '8px', padding: '12px 16px', fontSize: '0.95rem' }} />
                </div>
                <div style={{ marginBottom: '32px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#616161', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shipping Address *</label>
                  <textarea className="glass-search-input" placeholder="Full delivery address (Building, Street, City, ZIP)" value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', minHeight: '100px', resize: 'vertical', borderRadius: '8px', padding: '12px 16px', fontSize: '0.95rem', fontFamily: 'inherit' }} />
                </div>
                <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                  <button className="tbl-btn" onClick={() => setShowCheckout(false)} style={{ background: 'transparent', color: '#616161', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', borderRadius: '100px' }}>Cancel</button>
                  <button className="tbl-btn tbl-btn-primary" onClick={submitCheckout} style={{ padding: '10px 24px', borderRadius: '100px', fontWeight: 600 }}>Proceed to Pay</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
