import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';

// ============================================================================
// Nexus A2A Demo — Every API call, every step, in order.
// Run with: node demo-a2a.js
// ============================================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const API   = 'http://localhost:4000';
const AGENT_USER_ID = 'demo_agent_' + Date.now();

const c = {
  reset:   "\x1b[0m",
  bright:  "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  red:     "\x1b[31m",
  gray:    "\x1b[90m",
};

const W = () => process.stdout.columns || 100;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Print a line, optionally right-aligned, with a typewriter effect
async function print(text, color = c.reset, align = 'left', speed = 8) {
  const width = W();
  const lines = [];
  // Word wrap at 65% width for right-aligned, full width for left
  const maxW = align === 'right' ? Math.floor(width * 0.65) : Math.floor(width * 0.95);

  const words = text.split(' ');
  let cur = '';
  for (const w of words) {
    if (w.includes('\n')) {
      const parts = w.split('\n');
      for (let i = 0; i < parts.length; i++) {
        cur += parts[i];
        if (i < parts.length - 1) { lines.push(cur); cur = ''; }
      }
    } else if ((cur + w).length > maxW) {
      lines.push(cur.trimEnd()); cur = w + ' ';
    } else {
      cur += w + ' ';
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());

  for (const line of lines) {
    const pad = align === 'right' ? ' '.repeat(Math.max(0, width - line.length - 1)) : '';
    process.stdout.write(pad + color);
    for (const ch of line) { process.stdout.write(ch); await delay(speed); }
    process.stdout.write(c.reset + '\n');
  }
}

async function header(title) {
  const w = W();
  const bar = '═'.repeat(Math.min(w - 2, 70));
  console.log('\n' + c.bright + c.cyan + '╔' + bar + '╗' + c.reset);
  const pad = Math.max(0, Math.floor((bar.length - title.length) / 2));
  console.log(c.bright + c.cyan + '║' + ' '.repeat(pad) + title + ' '.repeat(bar.length - pad - title.length) + '║' + c.reset);
  console.log(c.bright + c.cyan + '╚' + bar + '╝\n' + c.reset);
}

async function step(num, label) {
  console.log('\n' + c.bright + c.yellow + `  ┌─ STEP ${num}: ${label} ` + '─'.repeat(Math.max(0, 55 - label.length)) + c.reset);
}

async function apiLog(method, path, align = 'left') {
  await print(`→ [API] ${method} ${path}`, c.magenta, align, 4);
}

async function responseLog(label, data, align = 'left') {
  await print(`← [RESPONSE] ${label}: ${JSON.stringify(data)}`, c.dim + c.gray, align, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

async function runDemo() {
  await header('NEXUS ENGINE  ·  AUTONOMOUS A2A NEGOTIATION DEMO');
  await print('[SYSTEM] Booting Customer AI Agent...', c.gray);
  await print(`[SYSTEM] Agent Identity: ${AGENT_USER_ID}`, c.gray);
  await delay(600);

  // ── STEP 1: Semantic Product Discovery ──────────────────────────────────────
  await header('PHASE 1  ·  INVENTORY DISCOVERY');

  await step(1, 'Agent sends natural-language search intent to Discovery API');
  const searchQuery = 'We need premium gaming laptops for our corporate e-sports team';
  await print(`🤖 Agent Search Intent: "${searchQuery}"`, c.blue, 'right');

  await apiLog('POST', '/api/discovery/discover', 'right');
  await print(`[PAYLOAD] { "query": "${searchQuery}" }`, c.gray, 'right', 3);

  const discRes  = await fetch(`${API}/api/discovery/discover`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: searchQuery })
  });
  const discData = await discRes.json();

  await step(2, 'Nexus returns semantically ranked product matches');
  await print(`🏪 Nexus Discovery Engine → ${discData.products?.length ?? 0} products matched`, c.green);
  await print(`   [Semantic Score Max: ${discData.query_metadata?.semantic_score_max?.toFixed(4) ?? 'N/A'}]`, c.gray);

  const top3 = (discData.products || []).slice(0, 3);
  for (let i = 0; i < top3.length; i++) {
    const p = top3[i];
    await print(`   ${i+1}. ${p.name}  |  ₹${Number(p.price).toLocaleString('en-IN')}  |  Stock: ${p.available_stock ?? p.stock}`, c.gray, 'left', 3);
  }

  // ── STEP 3: Agent builds cart ────────────────────────────────────────────────
  await step(3, 'Agent selects product and builds cart (in memory)');
  const chosen  = discData.products[0];
  const cart    = [{ product_id: chosen.id, quantity: 2 }];
  await print(`🤖 Agent Decision: Selected "${chosen.name}" × 2`, c.blue, 'right');
  await print(`   Cart Value (base): ₹${(chosen.price * 2).toLocaleString('en-IN')}`, c.blue, 'right');
  await delay(500);

  // ── STEP 4: Start Negotiation Session ────────────────────────────────────────
  await header('PHASE 2  ·  NEGOTIATION SESSION');

  await step(4, 'Agent opens negotiation session with cart — Nexus allocates soft-lock on inventory');
  await apiLog('POST', '/api/negotiation/start', 'right');
  await print(`[PAYLOAD] { buyer_type: "AGENT", clerk_user_id: "...", cart: [{ product_id, quantity }] }`, c.gray, 'right', 3);

  const startRes  = await fetch(`${API}/api/negotiation/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer_type: 'AGENT', cart, clerk_user_id: AGENT_USER_ID })
  });
  const startData = await startRes.json();
  if (!startRes.ok) { console.error(c.red + 'Failed to start session:' + c.reset, startData); return; }

  const sessionId = startData.session_id;
  await responseLog('session_id', sessionId);
  await print(`✓ Session created: ${sessionId}`, c.green);

  // ── STEP 5: Fetch session (merchant's opening message) ───────────────────────
  await step(5, 'Fetch session to retrieve Merchant AI\'s opening offer');
  await apiLog('GET', `/api/negotiation/session/${sessionId}`);

  const sessRes  = await fetch(`${API}/api/negotiation/session/${sessionId}`);
  const sessData = await sessRes.json();
  const messages = sessData.session.messages;
  let lastMsg    = messages[messages.length - 1].content;

  await print(`🏪 Nexus Merchant AI:\n${lastMsg}`, c.green);

  // ── STEP 6: Chat Loop (N rounds) ─────────────────────────────────────────────
  await step(6, 'Iterative A2A Negotiation Chat (Agent ↔ Merchant AI, up to max_rounds)');

  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
  const chat  = model.startChat({ history: [
    { role: 'user',  parts: [{ text: 'You are an aggressive corporate AI buying agent. Your goal: lowest price possible. Demand 35% off first. Be extremely concise — max 2 sentences.' }] },
    { role: 'model', parts: [{ text: 'Understood. I will pursue the lowest possible price ruthlessly.' }] },
  ]});

  let status = 'ACTIVE';
  let round  = 0;

  while (status === 'ACTIVE') {
    round++;
    await delay(1800);

    // Agent generates reply
    process.stdout.write(' '.repeat(Math.max(0, W() - 42)) + c.blue + `🤖 Agent thinking (round ${round})...` + c.reset);
    const aiRes = await chat.sendMessage(`Merchant AI said: "${lastMsg}". Respond to push for a lower price.`);
    const agentMsg = aiRes.response.text().trim();
    process.stdout.write("\r\x1b[K");

    await print(`🤖 Customer Agent (Round ${round}):\n${agentMsg}`, c.blue, 'right');
    await apiLog('POST', '/api/negotiation/chat', 'right');
    await print(`[HEADER] x-session-id: ${sessionId}`, c.gray, 'right', 2);
    await print(`[PAYLOAD] { "message": "..." }`, c.gray, 'right', 2);

    const chatRes  = await fetch(`${API}/api/negotiation/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ message: agentMsg })
    });
    if (chatRes.status === 429) { await print('[WARN] Rate limited — waiting...', c.yellow); await delay(2000); continue; }

    const chatData = await chatRes.json();
    if (!chatRes.ok) { console.error(c.red + 'Chat error:' + c.reset, chatData); break; }

    lastMsg = chatData.reply;
    status  = chatData.status;

    await print(`🏪 Nexus Merchant AI (Round ${round}):\n${lastMsg}`, c.green);
    if (chatData.final_price) {
      await print(`💰 Final Offer on Table: ₹${Number(chatData.final_price).toLocaleString('en-IN')}`, c.yellow);
    }
    await responseLog('status', status);
  }

  // ── STEP 7: Pending Review — Poll for merchant decision ──────────────────────
  if (status === 'PENDING_MERCHANT_REVIEW') {
    await header('PHASE 3  ·  HUMAN MERCHANT REVIEW');
    await step(7, 'Max rounds hit — Agent polls for human merchant decision via GET session');
    await print('⏳ Session sent to human merchant for manual approval.', c.yellow);
    await print('👉 ACTION: Go to the Nexus Admin Dashboard → Approve or Reject the deal.', c.bright);

    process.stdout.write('\n' + c.gray + '   Polling GET /api/negotiation/session/:id every 3s');
    while (status === 'PENDING_MERCHANT_REVIEW') {
      process.stdout.write(c.gray + ' .' + c.reset);
      await delay(3000);
      const poll = await fetch(`${API}/api/negotiation/session/${sessionId}`);
      const pd   = await poll.json();
      status = pd.session.status;
    }
    console.log('\n');
    await print(`✓ Merchant decision received — Status: ${status}`, c.green);
  }

  // ── STEP 8: Deal Approved — Autonomous Checkout ───────────────────────────────
  if (status === 'APPROVED') {
    await header('PHASE 4  ·  AUTONOMOUS CHECKOUT');

    await step(8, 'Create Razorpay Payment Order using negotiated final_price from session');
    await apiLog('POST', '/api/checkout/create-order');
    await print(`[PAYLOAD] { "session_id": "${sessionId}", "customer_phone": "...", "shipping_address": "..." }`, c.gray, 'left', 2);

    const orderRes  = await fetch(`${API}/api/checkout/create-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, customer_phone: '9999999999', shipping_address: 'A2A Agent Server, Mumbai' })
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok) { console.error(c.red + 'Order failed:' + c.reset, orderData); return; }

    await responseLog('order_id', orderData.order_id);
    await print(`💳 Razorpay Order: ${orderData.order_id}  |  Amount: ₹${orderData.amount / 100}`, c.yellow);

    await step(9, 'Generate HMAC-SHA256 payment signature (simulating payment gateway callback)');
    await print('[SYSTEM] Computing: HMAC_SHA256(key=RAZORPAY_SECRET, data=order_id|payment_id)', c.gray);
    await delay(800);

    const mockPaymentId     = 'pay_' + Date.now();
    const sigPayload        = orderData.order_id + '|' + mockPaymentId;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                    .update(sigPayload).digest('hex');
    await print(`✓ Signature computed: ${expectedSignature.substring(0, 24)}...`, c.gray);

    await step(10, 'Verify payment — Nexus validates signature, deducts inventory, marks COMPLETED');
    await apiLog('POST', '/api/checkout/verify-payment');
    await print(`[PAYLOAD] { razorpay_order_id, razorpay_payment_id, razorpay_signature, session_id }`, c.gray, 'left', 2);

    const verifyRes  = await fetch(`${API}/api/checkout/verify-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: orderData.order_id,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: expectedSignature,
        session_id: sessionId
      })
    });
    const verifyData = await verifyRes.json();

    if (verifyRes.ok && verifyData.success) {
      await header('✅  TRANSACTION COMPLETE');
      await print('Payment confirmed.', c.green);
      await print('Inventory hard-deducted from stock.', c.green);
      await print('Session status → COMPLETED.', c.green);
      await print(`Payment ID: ${mockPaymentId}`, c.gray);
      await print('Full A2A cycle complete — 0 human interactions required.', c.bright + c.green);
    } else {
      console.error(c.red + 'Verify failed:' + c.reset, verifyData);
    }

  } else if (status === 'COMPLETED') {
    await header('✅  DEAL CLOSED'); await print('Negotiation concluded within rounds.', c.green);
  } else if (status === 'TERMINATED') {
    await header('❌  DEAL TERMINATED'); await print('Merchant rejected the deal.', c.red);
  }
}

runDemo().catch(e => { console.error(c.red + 'Fatal error:' + c.reset, e); process.exit(1); });
