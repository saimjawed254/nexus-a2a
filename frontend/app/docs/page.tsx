'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import toast, { Toaster } from 'react-hot-toast';
import '../dashboard/dashboard.css';

const codeStyle: React.CSSProperties = {
  background: '#f0f2f5',
  border: '1px solid #dde2ea',
  padding: '2px 7px',
  borderRadius: '4px',
  fontFamily: 'monospace',
  fontSize: '0.88rem',
  color: '#0055ff'
};

const preStyle: React.CSSProperties = {
  background: '#111827',
  color: '#e5e7eb',
  padding: '1.1rem 1.4rem',
  borderRadius: '8px',
  overflowX: 'auto',
  fontSize: '0.82rem',
  lineHeight: 1.65,
  marginBottom: '2rem',
  marginTop: '0.5rem'
};

const stepHeadStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#182433',
  marginBottom: '0.4rem',
  marginTop: '2rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem'
};

const Badge = ({ n }: { n: number }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, borderRadius: '50%',
    background: '#0055ff', color: '#fff',
    fontSize: '0.75rem', fontWeight: 700, flexShrink: 0
  }}>{n}</span>
);

const Method = ({ m }: { m: string }) => {
  const colors: Record<string, string> = { POST: '#d97706', GET: '#16a34a', PUT: '#7c3aed' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: '4px',
      background: colors[m] || '#6b7280', color: '#fff',
      fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.5px', marginRight: 6
    }}>{m}</span>
  );
};

export default function DocsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <h1 style={{ color: '#182433' }}>Please sign in to view the API Docs.</h1>
      </div>
    );
  }

  const agentApiKey = user.id;

  return (
    <div className="tabler-page" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Toaster position="top-right" />

      {/* ── Navbar ── */}
      <nav className="tbl-navbar">
        <div className="tbl-container-inner">
          <a className="tbl-navbar-brand" href="/">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#0055ff" />
              <path d="M10 16L16 10L22 16" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Nexus A2A
          </a>
          <div className="tbl-navbar-actions">
            <a href="/shop" className="tbl-btn" style={{ border: 'none', background: 'transparent', color: '#62778d' }}>Customer Shop</a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '1rem', marginLeft: '0.5rem', borderLeft: '1px solid #e6ebf1' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#182433' }}>{user.firstName || 'Developer'}</div>
                <div style={{ fontSize: '0.8rem', color: '#62778d' }}>{user.primaryEmailAddress?.emailAddress}</div>
              </div>
              <img src={user.imageUrl} alt="Profile" className="tbl-avatar" />
            </div>
            <button className="tbl-btn" style={{ marginLeft: '1rem', borderColor: '#d63939', color: '#d63939' }} onClick={() => signOut(() => router.push('/'))}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Page Header ── */}
      <div className="tbl-page-header">
        <div className="tbl-container-inner">
          <div>
            <div className="tbl-page-pretitle">Developer Portal</div>
            <h2 className="tbl-page-title" style={{ letterSpacing: '-0.5px' }}>A2A Integration Docs</h2>
          </div>
        </div>
      </div>

      <div className="tbl-page-wrapper">
        <div className="tbl-container-inner" style={{ paddingTop: '2rem', paddingBottom: '5rem' }}>
          <div className="tbl-row tbl-row-cards">

            {/* ── Left: API Key ── */}
            <div className="tbl-col-12 tbl-col-lg-4">
              <div className="tbl-card" style={{ height: '100%' }}>
                <div className="tbl-card-header">
                  <h3 className="tbl-card-title">Your Agent API Key</h3>
                </div>
                <div className="tbl-card-body">
                  <p style={{ fontSize: '0.9rem', color: '#62778d', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                    This is your <strong>Clerk User ID</strong>, which serves as your Agent API Key. Pass it as <code style={codeStyle}>clerk_user_id</code> in every API call so the Nexus Engine knows which customer the agent is acting on behalf of. Keep it secure.
                  </p>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={apiKeyVisible ? 'text' : 'password'}
                      className="tbl-input"
                      value={agentApiKey}
                      readOnly
                      style={{ paddingRight: '120px', background: '#f8f9fa', fontWeight: 600 }}
                    />
                    <div style={{ position: 'absolute', right: '4px', top: '4px', display: 'flex', gap: '4px' }}>
                      <button className="tbl-btn tbl-btn-secondary tbl-btn-sm" onClick={() => setApiKeyVisible(!apiKeyVisible)}>
                        {apiKeyVisible ? 'Hide' : 'Show'}
                      </button>
                      <button className="tbl-btn tbl-btn-primary tbl-btn-sm" onClick={() => copyToClipboard(agentApiKey)}>
                        Copy
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: '2rem', padding: '1rem', background: '#fffbeb', borderLeft: '3px solid #f59e0b', borderRadius: '4px' }}>
                    <p style={{ fontSize: '0.85rem', color: '#78350f', margin: 0, lineHeight: 1.6 }}>
                      <strong>No login needed for your agent.</strong> The API key replaces the login session. Your agent calls all endpoints using only this key.
                    </p>
                  </div>

                  <div style={{ marginTop: '1.5rem' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#182433', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Full A2A Flow</p>
                    {[
                      'Search catalog (semantic)',
                      'Select products → build cart',
                      'Open negotiation session',
                      'Fetch session + opening offer',
                      'Chat loop (Agent ↔ Merchant AI)',
                      'Poll for merchant decision',
                      'Create Razorpay order',
                      'Sign & verify payment',
                    ].map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.5rem' }}>
                        <Badge n={i + 1} />
                        <span style={{ fontSize: '0.85rem', color: '#62778d', lineHeight: 1.4 }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Full Docs ── */}
            <div className="tbl-col-12 tbl-col-lg-8">
              <div className="tbl-card">
                <div className="tbl-card-header">
                  <h3 className="tbl-card-title">Complete A2A API Reference</h3>
                  <span style={{ fontSize: '0.85rem', color: '#62778d' }}>Base URL: <code style={codeStyle}>http://your-api-domain</code></span>
                </div>
                <div className="tbl-card-body" style={{ padding: '1.5rem 2rem' }}>

                  <p style={{ fontSize: '0.95rem', color: '#62778d', lineHeight: 1.7, marginBottom: '1rem' }}>
                    The Nexus A2A Engine lets any AI buying agent autonomously discover products, negotiate pricing with the Merchant AI, and complete payment — all via standard REST APIs. No browser needed.
                  </p>

                  {/* STEP 1 */}
                  <h4 style={stepHeadStyle}><Badge n={1} /> Semantic Inventory Search</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="POST" /><code style={codeStyle}>/api/discovery/discover</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    Search the product catalog using natural language. The engine extracts hard filters (e.g. price caps) using an LLM, generates a vector embedding, and returns ranked results via cosine similarity against our product vector DB.
                  </p>
                  <pre style={preStyle}>{`// Request
POST /api/discovery/discover
Content-Type: application/json

{
  "query": "We need premium gaming laptops under 200000",
  "page": 1,      // optional, default 1
  "limit": 20     // optional, default 20
}

// Response
{
  "products": [
    {
      "id": "uuid-here",
      "name": "Razer Blade 15",
      "brand": "Razer",
      "price": 189999,
      "available_stock": 8,
      "category": "Laptops"
    },
    ...
  ],
  "query_metadata": {
    "semantic_score_max": 0.9412,
    "hard_filters_applied": true,
    "extracted_filters": { "price_max": 200000 }
  }
}`}</pre>

                  {/* STEP 2 */}
                  <h4 style={stepHeadStyle}><Badge n={2} /> Build Your Cart (In Memory)</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6 }}>
                    There is <strong>no separate "add to cart" API.</strong> Your agent selects products from the discovery results and constructs a cart array in memory. This cart is submitted directly when starting the negotiation session in Step 3.
                  </p>
                  <pre style={preStyle}>{`// Agent builds cart locally — no API call needed
const cart = [
  { "product_id": "uuid-from-step-1", "quantity": 2 },
  { "product_id": "another-uuid",     "quantity": 1 }
];`}</pre>

                  {/* STEP 3 */}
                  <h4 style={stepHeadStyle}><Badge n={3} /> Open Negotiation Session</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="POST" /><code style={codeStyle}>/api/negotiation/start</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    Submit the cart to start a negotiation session. Nexus validates all product IDs, <strong>soft-locks the inventory</strong> (so no one else can buy these units while you negotiate), and initializes the Merchant AI with your cart total and the merchant's discount guardrails.
                  </p>
                  <pre style={preStyle}>{`// Request
POST /api/negotiation/start
Content-Type: application/json

{
  "buyer_type": "AGENT",
  "clerk_user_id": "YOUR_AGENT_API_KEY",
  "cart": [
    { "product_id": "uuid-here", "quantity": 2 }
  ]
}

// Response
{
  "session_id": "uuid-here",
  "status": "ACTIVE"
}`}</pre>

                  {/* STEP 4 */}
                  <h4 style={stepHeadStyle}><Badge n={4} /> Fetch Session + Opening Offer</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="GET" /><code style={codeStyle}>/api/negotiation/session/:sessionId</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    Immediately after starting the session, fetch it to retrieve the Merchant AI's opening greeting and initial offer. The <code style={codeStyle}>messages</code> array contains the full conversation history.
                  </p>
                  <pre style={preStyle}>{`// Request
GET /api/negotiation/session/{session_id}

// Response
{
  "session": {
    "id": "uuid-here",
    "status": "ACTIVE",
    "rounds_used": 0,
    "messages": [
      {
        "role": "AGENT",
        "content": "Welcome! For 2 units of Razer Blade 15, your total is ₹3,79,998...",
        "metadata": { "finalOffer": 379998 }
      }
    ]
  }
}`}</pre>

                  {/* STEP 5 */}
                  <h4 style={stepHeadStyle}><Badge n={5} /> Negotiate (Chat Loop)</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="POST" /><code style={codeStyle}>/api/negotiation/chat</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    Send your agent's negotiation message. The Nexus Merchant AI responds with a counteroffer constrained by the merchant's rules (max discount %, max rounds). Repeat until <code style={codeStyle}>status</code> changes. The response always contains the current <code style={codeStyle}>status</code> and optionally a <code style={codeStyle}>final_price</code> when an offer is on the table.
                  </p>
                  <pre style={preStyle}>{`// Request
POST /api/negotiation/chat
Content-Type: application/json
x-session-id: {session_id}

{
  "message": "I need a 35% discount or we'll source from a competitor."
}

// Response (while ACTIVE)
{
  "reply": "I can extend a 2% volume discount, bringing your total to ₹372,398.",
  "status": "ACTIVE",
  "final_price": 372398.04
}

// Response (when limit reached)
{
  "reply": "This offer has been escalated to our merchant for review.",
  "status": "PENDING_MERCHANT_REVIEW",
  "final_price": 372398.04
}`}</pre>

                  {/* STEP 6 */}
                  <h4 style={stepHeadStyle}><Badge n={6} /> Poll for Merchant Decision</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="GET" /><code style={codeStyle}>/api/negotiation/session/:sessionId</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    When <code style={codeStyle}>status === "PENDING_MERCHANT_REVIEW"</code>, the deal is in the hands of the human merchant. Poll this endpoint every 3–5 seconds. When the merchant clicks <strong>Approve</strong> or <strong>Reject</strong> in the Dashboard, the status will change to <code style={codeStyle}>APPROVED</code> or <code style={codeStyle}>TERMINATED</code>.
                  </p>
                  <pre style={preStyle}>{`// Poll every 3-5 seconds while status === "PENDING_MERCHANT_REVIEW"
GET /api/negotiation/session/{session_id}

// Response when approved
{
  "session": {
    "status": "APPROVED",   // ← proceed to checkout
    ...
  }
}

// Response if rejected
{
  "session": {
    "status": "TERMINATED",
    ...
  }
}`}</pre>

                  {/* STEP 7 */}
                  <h4 style={stepHeadStyle}><Badge n={7} /> Create Payment Order</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="POST" /><code style={codeStyle}>/api/checkout/create-order</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    Only callable when session <code style={codeStyle}>status === "APPROVED"</code>. Nexus reads the <code style={codeStyle}>final_price</code> from the session's message history and creates a Razorpay order for that exact amount. Returns a <code style={codeStyle}>order_id</code> needed for payment.
                  </p>
                  <pre style={preStyle}>{`// Request
POST /api/checkout/create-order
Content-Type: application/json

{
  "session_id": "uuid-here",
  "customer_phone": "9999999999",
  "shipping_address": "123 Main St, Mumbai"
}

// Response
{
  "order_id": "order_Razorpay123",
  "amount": 37239804,        // in paise (₹372,398.04)
  "currency": "INR",
  "key_id": "rzp_test_xxx",
  "session_id": "uuid-here"
}`}</pre>

                  {/* STEP 8 */}
                  <h4 style={stepHeadStyle}><Badge n={8} /> Verify Payment & Close Deal</h4>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', marginBottom: '0.4rem' }}>
                    <Method m="POST" /><code style={codeStyle}>/api/checkout/verify-payment</code>
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#62778d', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                    After your payment gateway processes the funds, generate an <strong>HMAC-SHA256 signature</strong> using your <code style={codeStyle}>RAZORPAY_KEY_SECRET</code> over the string <code style={codeStyle}>order_id|payment_id</code> and submit it here. Nexus verifies the signature, <strong>hard-deducts the inventory</strong> from stock permanently, marks the session <code style={codeStyle}>COMPLETED</code>, and emits a real-time WebSocket event to the merchant dashboard.
                  </p>
                  <pre style={preStyle}>{`// Compute signature (in your agent's runtime)
const sig = HMAC_SHA256(
  key  = RAZORPAY_KEY_SECRET,
  data = order_id + "|" + payment_id
);

// Request
POST /api/checkout/verify-payment
Content-Type: application/json

{
  "razorpay_order_id":  "order_Razorpay123",
  "razorpay_payment_id": "pay_abc123",
  "razorpay_signature": "computed-hmac-hex",
  "session_id": "uuid-here"
}

// Response (success)
{
  "success": true,
  "payment_id": "pay_abc123"
}

// Response (fraud / mismatch)
{
  "success": false,
  "error": "Payment signature mismatch. Possible fraud attempt."
}`}</pre>

                  {/* Notes */}
                  <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: '#f0f5ff', borderLeft: '4px solid #0055ff', borderRadius: '6px' }}>
                    <strong style={{ color: '#003eb3', fontSize: '0.95rem' }}>Delegated vs Autonomous Checkout</strong>
                    <p style={{ margin: '0.6rem 0 0', fontSize: '0.88rem', color: '#333', lineHeight: 1.7 }}>
                      <strong>Delegated (Recommended):</strong> After Step 6 returns <code>APPROVED</code>, your agent notifies the human customer. The customer then logs into the Nexus Shop page and completes Steps 7–8 via the standard browser Razorpay widget.<br /><br />
                      <strong>Autonomous (Server-to-Server):</strong> If your agent has a linked corporate payment card or wallet, it can complete Steps 7–8 fully programmatically without any human action, as shown in the <code>demo-a2a.js</code> script.
                    </p>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
