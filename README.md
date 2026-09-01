# Nexus A2A

> **Hackathon submission** · Razorpay Track — Build the Future of AI Commerce

Nexus is a real-time negotiation engine. It lets both human buyers and autonomous AI agents haggle and close deals using a deterministic, guardrailed pricing system built around Razorpay.

---

## Table of Contents

1. [What is Nexus?](#what-is-nexus)
2. [Core Architecture](#core-architecture)
3. [How the Negotiation Engine Works](#how-the-negotiation-engine-works)
4. [The A2A (Agent-to-Agent) Flow](#the-a2a-agent-to-agent-flow)
5. [Complete API Reference](#complete-api-reference)
6. [Running the Demo Script](#running-the-demo-script)
7. [Running Locally](#running-locally)
8. [Environment Variables](#environment-variables)
9. [Clarifying Q&A for Judges](#clarifying-qa-for-judges)
10. [Tech Stack](#tech-stack)
11. [Project Structure](#project-structure)

---

## What is Nexus?

E-commerce usually has fixed prices. Nexus changes that.

It allows **any buyer** — whether a human using the browser or a fully autonomous AI agent running in a background script — to negotiate pricing directly with a Merchant AI. We bound every negotiation mathematically, so the merchant never takes a loss.

**Three checkout modes, one engine:**

| Mode | Who interacts | How payment happens |
|---|---|---|
| **Human B2C** | Human via browser chat UI | Razorpay standard checkout widget |
| **Delegated A2A** | AI agent negotiates, human pays | Agent notifies human → human completes Razorpay checkout |
| **Autonomous A2A** | AI agent end-to-end | Agent calls checkout + verify-payment APIs programmatically using a B2B payment rail |

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXUS ENGINE                             │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  Discovery   │    │  Negotiation     │    │  Checkout    │  │
│  │  (Semantic   │───▶│  (LLM + Math     │───▶│  (Razorpay   │  │
│  │   Search)    │    │   Guardrails)    │    │   + HMAC)    │  │
│  └──────────────┘    └──────────────────┘    └──────────────┘  │
│         │                    │                                  │
│   pgvector DB          Gemini Pro LLM                           │
│   (cosine similarity)  (Merchant AI persona)                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Admin Dashboard (Merchant)                  │   │
│  │  Live Monitor · Manual Approval · Kill Switch · Config   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Backend:** Node.js + TypeScript + Express + PostgreSQL (with pgvector extension)  
**Frontend:** Next.js 14 (App Router) + Clerk Auth + Razorpay  
**AI:** Google Gemini Pro (Merchant AI persona + Embedding generation)  
**Realtime:** Socket.IO (live chat streaming to merchant dashboard)

---

## How the Negotiation Engine Works

This is the most important part to understand. The negotiation isn't just a basic LLM wrapper. It's a layered system with hard mathematical guardrails.

### Layer 1: Per-Product Pricing Rules (at catalog upload time)

When a merchant uploads their product catalog via CSV, the `auto-vectorizer` service processes each product:

1. **Rule Compiler:** If a product has `unstructured_rules` (like *"10% off for orders of 5+, 15% off for 10+"*), Gemini Pro parses this text into a structured JSON schema:
   ```json
   {
     "volume_tiers": [
       { "min_qty": 5,  "max_discount_pct": 10 },
       { "min_qty": 10, "max_discount_pct": 15 }
     ],
     "max_discount_pct": 5
   }
   ```
2. **Rich Embedding:** We generate a descriptive text document (brand, model, category, price, specs, description) and embed it via Gemini's embedding model. This vector is stored in pgvector for semantic search.

### Layer 2: Constraint Solver (per negotiation round)

Every time a customer sends a chat message, **before the LLM is called**, the `calculateCeiling` function deterministically computes:

- `total_value` = sum of (unit_price × quantity) for all cart items
- `ceiling_amount` = max total discount allowed across all items (based on their rules + qty)
- `min_acceptable_price` = `total_value - ceiling_amount` (the hard floor)

We inject this floor into the LLM system prompt. If the LLM ever hallucinates a price below this floor, the engine **overrides it silently** to the exact floor value.

### Layer 3: LLM Persona (Merchant AI)

The LLM acts as a `STRICT`, `BALANCED`, or `FRIENDLY` sales negotiator (configured in the admin dashboard). It:
- Gets the deterministic price floor as a non-negotiable constraint.
- Is forced to provide **line-item markdown price tables** on every offer.
- Is instructed not to reveal the floor price on round 1 (it starts with smaller offers).
- Receives the full chat history on every API call.

### Layer 4: Round Enforcement

`max_rounds` is a configurable setting (default: 3). When the final round is reached:
- If `require_manual_approval = false`: the session auto-approves and stock is soft-allocated.
- If `require_manual_approval = true`: status becomes `PENDING_MERCHANT_REVIEW` — a human merchant must approve or reject via the dashboard.

---

## The A2A (Agent-to-Agent) Flow

A third-party AI buying agent (e.g., a procurement agent built on Gemini, GPT-4, or Claude) can integrate with Nexus using only REST APIs and the customer's `clerk_user_id` as an API key.

```
Customer AI Agent                    Nexus Engine
─────────────────                    ─────────────
POST /discover         ──────────▶   Semantic search via pgvector
                       ◀──────────   Ranked product list

[Agent selects items, builds cart in memory]

POST /negotiation/start  ──────────▶ Creates session + cart_items in DB
                         ◀──────────  { session_id, status: "ACTIVE" }

GET /negotiation/session/:id ──────▶ Fetch Merchant AI's opening offer
                             ◀──────  { session, messages }

POST /negotiation/chat ──────────▶   Round N: LLM + constraint solver
                       ◀──────────   { reply, status, final_price }

[Repeat until status !== "ACTIVE"]

GET /negotiation/session/:id  ─────▶ Poll every 3s if PENDING_MERCHANT_REVIEW
                              ◀─────  { session: { status: "APPROVED" } }

POST /checkout/create-order ──────▶  Creates Razorpay order at final_price
                            ◀──────  { order_id, amount, currency }

[Agent signs payload via B2B rail]

POST /checkout/verify-payment ────▶  Validates signature, deducts inventory,
                              ◀────  marks session COMPLETED
                                     { success: true, payment_id }
```

---

## Complete API Reference

**Base URL:** `http://localhost:4000`  
**Auth for customer APIs:** Pass `clerk_user_id` in request body  
**Auth for admin APIs:** Pass `x-merchant-key: <MERCHANT_API_KEY>` header  
**Auth for chat:** Pass `x-session-id: <session_id>` header  

---

### Discovery

#### `POST /api/discovery/discover`

Semantic product search. Uses Gemini to extract hard filters (price caps) then runs a hybrid pgvector cosine similarity + SQL filter query.

```json
// Request
{
  "query": "gaming laptops under 150000",
  "page": 1,
  "limit": 20
}

// Response
{
  "products": [
    {
      "id": "uuid",
      "name": "Razer Blade 15",
      "brand": "Razer",
      "price": 149999,
      "available_stock": 8,
      "category": "Laptops"
    }
  ],
  "query_metadata": {
    "semantic_score_max": 0.9412,
    "hard_filters_applied": true,
    "extracted_filters": { "price_max": 150000 }
  }
}
```

> **Note:** Empty `query` returns the newest in-stock products (paginated catalog browse). It defaults to 20 products per page. Agents can fetch more by passing `page: 2`, `page: 3`, etc.

---

### Negotiation

#### `POST /api/negotiation/start`

Creates a new negotiation session. Validates all product IDs, stores cart items at current prices, runs a stock availability check, and generates an AI-personalized opening message from the Merchant AI. Any previous ACTIVE session for this user is superseded.

```json
// Request
{
  "buyer_type": "AGENT",
  "clerk_user_id": "user_xxx",
  "cart": [
    { "product_id": "uuid", "quantity": 2 }
  ]
}

// Response
{
  "session_id": "uuid",
  "status": "ACTIVE"
}
```

> **Important:** Stock is NOT hard-allocated here. It is only checked for availability. Hard allocation happens at approval time to prevent griefers from holding stock during long negotiations.

---

#### `GET /api/negotiation/session/:sessionId`

Fetch full session state including all messages. Used to:
- Get the Merchant AI's opening greeting after `start`
- Poll for status changes during `PENDING_MERCHANT_REVIEW`

```json
// Response
{
  "session": {
    "id": "uuid",
    "status": "ACTIVE",
    "rounds_used": 1,
    "expires_at": "2026-09-01T04:00:00Z",
    "messages": [
      {
        "role": "AGENT",
        "content": "Welcome! Your cart of 2× Razer Blade 15 totals ₹2,99,998...",
        "metadata": { "finalOffer": 299998 },
        "created_at": "..."
      },
      {
        "role": "USER",
        "content": "I need 35% off.",
        "created_at": "..."
      }
    ]
  }
}
```

---

#### `GET /api/negotiation/session/active?clerk_user_id=xxx`

Returns the current active/pending/approved session for a given user (if any). Used by the frontend to resume sessions on page reload.

---

#### `GET /api/negotiation/sessions/user/:clerkUserId`

Returns the full session history for a user (all statuses). Used for the "Session History" tab.

---

#### `POST /api/negotiation/chat`

**Header required:** `x-session-id: <session_id>`

The core negotiation endpoint. On each call:
1. Rate limit check (1 message / 2 seconds).
2. Fetches cart and runs `calculateCeiling` to get `min_acceptable_price`.
3. Increments `rounds_used`.
4. Calls Gemini Pro with full system prompt (persona, constraints, cart contents, history).
5. Parses LLM output for embedded JSON price offer.
6. **Overrides** any LLM price below the hard floor.
7. Enforces max_rounds closure.
8. If `require_manual_approval`: sets `PENDING_MERCHANT_REVIEW`.
9. Else auto-approves and soft-allocates stock.
10. Emits live WebSocket events to merchant dashboard.

```json
// Request body
{ "message": "I demand 40% off or we walk." }

// Response (ACTIVE round)
{
  "reply": "I appreciate your position. For 2 units...\n| Product | Original | Discount | Final |\n...",
  "round": 1,
  "max_rounds": 3,
  "status": "ACTIVE",
  "final_price": 287998.04
}

// Response (deal reached, pending review)
{
  "reply": "This is our final offer...",
  "round": 3,
  "max_rounds": 3,
  "status": "PENDING_MERCHANT_REVIEW",
  "final_price": 287998.04
}
```

---

#### `POST /api/negotiation/session/:sessionId/cart`

Update cart items mid-negotiation (e.g., agent adds more quantity to qualify for a volume discount). Resets `rounds_used` to 0 but preserves the conversation history. The LLM is informed via a SYSTEM message.

```json
// Request
{
  "cart": [
    { "product_id": "uuid", "quantity": 5 }
  ]
}

// Response
{
  "success": true,
  "message": "Cart updated successfully",
  "cart_total": 749995
}
```

---

#### `POST /api/negotiation/session/:sessionId/terminate`

Customer voluntarily abandons the negotiation. Releases any soft-allocated stock immediately.

```json
// Request
{ "clerk_user_id": "user_xxx" }

// Response
{ "success": true }
```

---

#### `GET /api/negotiation/user/:clerkUserId/cart`
#### `PUT /api/negotiation/user/:clerkUserId/cart`

Persistent cart storage. Saves and retrieves a user's pre-negotiation cart across browser sessions. Data is stored in `user_carts` table.

```json
// PUT request body
{ "cart": [{ "product_id": "uuid", "quantity": 2 }] }
```

---

### Checkout

#### `POST /api/checkout/create-order`

Only callable when `session.status === "APPROVED"`. Reads the `final_price` from the session's message history (last `AGENT` message with a `finalOffer` in metadata) and creates a Razorpay order for that exact amount in paise.

```json
// Request
{
  "session_id": "uuid",
  "customer_phone": "9999999999",
  "shipping_address": "123 Main St, Mumbai"
}

// Response
{
  "order_id": "order_Razorpay123",
  "amount": 28799804,
  "currency": "INR",
  "key_id": "rzp_test_xxx",
  "session_id": "uuid"
}
```

---

#### `POST /api/checkout/verify-payment`

Validates Razorpay payment signature using HMAC-SHA256. On success:
- Marks `razorpay_orders` row as `PAID`
- Calls `InventoryManager.hardDeduct` — permanently deducts stock (irrevocable)
- Sets session status to `COMPLETED`
- Emits `payment_confirmed` WebSocket event to merchant dashboard

```json
// Request
{
  "razorpay_order_id": "order_Razorpay123",
  "razorpay_payment_id": "pay_abc123",
  "razorpay_signature": "hmac_sha256(RAZORPAY_KEY_SECRET, order_id|payment_id)",
  "session_id": "uuid"
}

// Response (success)
{ "success": true, "payment_id": "pay_abc123" }

// Response (signature mismatch)
{ "success": false, "error": "Payment signature mismatch. Possible fraud attempt." }
```

---

### Admin (Merchant Dashboard)

All admin routes require the `x-merchant-key` header.

#### `GET /api/admin/sessions?status=PENDING_MERCHANT_REVIEW`

Returns all sessions, optionally filtered by status. Used by the merchant dashboard to show pending reviews and live monitor.

#### `POST /api/admin/review/:session_id/approve`

Merchant approves the deal. Triggers `InventoryManager.softAllocate` to lock stock, then sets status to `APPROVED`. The customer's chat UI and/or agent will detect this on next poll.

#### `POST /api/admin/review/:session_id/reject`

Merchant rejects or counters the deal.
- With `counter_offer`: re-activates session (`ACTIVE`) and injects a `MERCHANT` message with the counter
- Without `counter_offer`: hard terminates, releases stock

```json
// Counter offer
{ "counter_offer": 260000, "message": "Best we can do is ₹2,60,000." }

// Hard reject
{ "message": "We cannot proceed with this deal." }
```

#### `POST /api/admin/terminate/:session_id`

Kill switch. Immediately terminates any active session and releases inventory. Sends an apology message to the customer.

#### `GET /api/merchant/products`

Returns all products in the catalog.

#### `GET /api/merchant/config`
#### `PUT /api/merchant/config`

Read and update merchant negotiation settings:
- `max_discount_pct`: Global discount ceiling (%)
- `max_rounds`: Max negotiation rounds before escalation
- `llm_personality`: `STRICT` | `BALANCED` | `FRIENDLY`
- `require_manual_approval`: Whether to require human approval before checkout
- `session_timeout_minutes`: Session expiry duration

#### `POST /api/merchant/upload-catalog`

Multipart form upload (`catalog` field, CSV file). Processes each product through the auto-vectorizer.

---

### Merchant Inventory (Internal)

Inventory management uses a transparent two-phase allocation model to prevent overselling without unnecessarily locking stock during negotiations:

| Phase | When | What |
|---|---|---|
| **Check** | `POST /negotiation/start` | Validates sufficient stock exists. No DB lock. |
| **Soft Allocate** | On `APPROVED` (auto or manual) | Increments `allocated_stock`. Reduces `available_stock`. |
| **Hard Deduct** | `POST /checkout/verify-payment` | Permanently decrements `stock`. Clears `allocated_stock`. |
| **Release** | On `TERMINATED` / kill switch | Decrements `allocated_stock` back. Frees up for others. |

If a customer tries to buy an item that is currently Soft Allocated to someone else (meaning the other buyer is in checkout), Nexus throws a `RESERVED` error instead of a generic out-of-stock error. The customer is explicitly told: *"Another customer has just reserved the last remaining units... If they do not complete their payment soon, the stock will be released."* This prevents losing a customer if the first buyer abandons their cart.

---

## Running the Demo Script

The `backend/demo-a2a.js` script simulates a fully autonomous AI buying agent. It runs every step — discovery, negotiation, human approval, and payment — with a typewriter terminal output optimized for screen recording.

```bash
cd backend
node demo-a2a.js
```

**What to expect:**

1. Agent sends a natural language search query to the Discovery API
2. Nexus returns semantically ranked product matches (top 3 printed)
3. Agent selects the top product and constructs its cart in memory
4. Agent calls `POST /negotiation/start` — session opens, Merchant AI generates greeting
5. Agent calls `POST /negotiation/chat` in a loop — Gemini-powered customer AI negotiates vs. Merchant AI
6. When max rounds hit: `PENDING_MERCHANT_REVIEW` — **you go to the Admin Dashboard and click Approve**
7. Agent detects `APPROVED` via polling
8. Agent calls `POST /checkout/create-order` to get a Razorpay order ID
9. Agent computes HMAC-SHA256 signature over `order_id|payment_id`
10. Agent calls `POST /checkout/verify-payment` — deal closed, inventory deducted

**Terminal layout:**
- 🤖 Customer Agent messages → **right-aligned** (blue)
- 🏪 Merchant AI responses → **left-aligned** (green)
- API calls → **right-aligned** (magenta)
- System logs → **left-aligned** (gray)

---

## Running Locally

**Prerequisites:** Node.js 18+, PostgreSQL 15+ with pgvector extension, Gemini API key, Razorpay test keys, Clerk account

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

### Database Setup

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, brand TEXT, model TEXT, category TEXT,
  description TEXT, specs JSONB, price NUMERIC,
  stock INTEGER, allocated_stock INTEGER DEFAULT 0,
  unstructured_rules TEXT, embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE merchant_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  max_discount_pct NUMERIC DEFAULT 3,
  max_rounds INTEGER DEFAULT 3,
  llm_personality TEXT DEFAULT 'STRICT',
  require_manual_approval BOOLEAN DEFAULT true,
  session_timeout_minutes INTEGER DEFAULT 15,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_type TEXT, status TEXT DEFAULT 'ACTIVE',
  rounds_used INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, clerk_user_id TEXT,
  terminated_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  role TEXT, content TEXT, metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  product_id UUID REFERENCES products(id),
  quantity INTEGER, unit_price NUMERIC
);

CREATE TABLE razorpay_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  razorpay_order_id TEXT UNIQUE, amount_paise BIGINT,
  currency TEXT DEFAULT 'INR', status TEXT DEFAULT 'CREATED',
  customer_phone TEXT, shipping_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_carts (
  clerk_user_id TEXT PRIMARY KEY,
  cart_data JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO merchant_config (max_discount_pct, max_rounds, llm_personality, require_manual_approval, session_timeout_minutes)
VALUES (3, 3, 'STRICT', true, 15);
```

---

## Environment Variables

### Backend (`.env`)

```env
DATABASE_URL=postgresql://user:password@localhost:5432/nexus
GEMINI_API_KEY=your_gemini_api_key
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=your_razorpay_secret
MERCHANT_API_KEY=nexus_merchant_2026
PORT=4000
```

### Frontend (`.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_ADMIN_EMAIL=admin@yourdomain.com
NEXT_PUBLIC_MERCHANT_KEY=nexus_merchant_2026
```

---

## Clarifying Q&A for Judges

**Q: How many products are sent back during the semantic search? Can the agent request more?**  
A: By default, the `POST /api/discovery/discover` endpoint returns the top 20 matches. Autonomous agents can easily paginate and fetch more items by passing `page: 2`, `page: 3`, etc. in the request payload. 

**Q: What happens if a customer tries to buy an item that someone else is currently checking out?**  
A: Nexus uses a transparent "soft allocation" state. If someone reaches the checkout stage (APPROVED status), their units are temporarily reserved (`allocated_stock`). If another customer attempts to start a negotiation or chat about those same units, Nexus detects the reservation and sends them a transparent message: *"Another customer has just reserved the last remaining units... If they do not complete their payment soon, the stock will be released."* This ensures we don't permanently lose the second buyer if the first buyer abandons their cart.

**Q: Why is the agent using demo numbers to simulate the Razorpay payment? Can it not make the payment itself?**  
A: In reality, an autonomous B2B agent does not fill out a credit card form in a browser modal. A true corporate buying agent uses an API-first B2B payment rail (like Stripe Issuing, Brex API, or direct bank wire APIs) to programmatically transfer funds. The `demo-a2a.js` script simulates what the Razorpay server-to-server webhook callback would look like after that programmatic payment succeeds. We generate the HMAC-SHA256 signature to prove that the Nexus backend fundamentally works to cryptographically verify incoming programmatic payments.

**Q: What actually prevents the AI from giving away products for free?**  
A: The `calculateCeiling` function runs deterministically on every chat round — before the LLM is even called. It computes the hard minimum acceptable price from the product's pricing rules and quantity. This value is injected into the LLM prompt as a non-negotiable constraint. Even if the LLM hallucinates a lower price in its JSON output, the engine detects it and silently overrides it to the computed floor. The LLM has zero ability to bypass this.

**Q: Does the LLM see the actual discount floor? Can the customer trick it into revealing it?**  
A: The floor is in the system prompt, so yes, the LLM knows it. However, the prompt explicitly instructs the LLM not to reveal the exact floor on early rounds and to start with smaller discounts. The real protection is the mathematical override on the backend — even if a customer somehow manipulates the LLM into "agreeing" to a lower price, the backend will reject it and reset to the floor.

**Q: What stops two customers from simultaneously buying the last unit of a product?**  
A: The two-phase inventory model. Stock is only checked for availability (read-only) at session start. The `softAllocate` (which increments `allocated_stock` in the DB) only happens at approval time, which is a serialized write. Only the first negotiation to reach approval will successfully allocate the stock.

**Q: How does an AI agent authenticate without logging in?**  
A: The `clerk_user_id` (shown as "Agent API Key" in `/docs`) is passed directly in request bodies. The negotiation engine stores this ID against the session record, so all sessions are traceable to a real Clerk user. In a production hardening pass, this would be a signed JWT, but for this demo the Clerk user ID is sufficient.

**Q: What happens if someone sends malicious input in the chat message?**  
A: The session ID is validated via `sessionGuard` middleware before the message even reaches the LLM. The user message is passed to Gemini as a user input, not interpolated into the system prompt SQL or any query — there is no SQL injection surface. Prompt injection is mitigated by clearly delineating user input with `--- START USER INPUT ---` markers in the system prompt.

**Q: Can the merchant modify the `max_discount_pct` mid-negotiation to change outcomes?**  
A: No. The config is fetched fresh on every chat round, so changing it does affect future rounds. However, the cart items' `unit_price` is snapshotted at session creation time. So the total value baseline is fixed. Changing `max_discount_pct` mid-session would only tighten or loosen the ceiling for remaining rounds.

**Q: What is pgvector and why use it?**  
A: pgvector is a PostgreSQL extension that adds a native vector column type and cosine/L2 distance operators. By storing Gemini-generated product embeddings directly in Postgres, we can run semantic search queries like `ORDER BY embedding <=> $queryVector` without a separate vector database. This keeps the stack simple while enabling full semantic product discovery.

**Q: Can the merchant see live negotiations?**  
A: Yes. The Admin Dashboard has a Live Monitor tab that subscribes to a Socket.IO room (`merchant_monitor`). Every chat message on every active session emits a `new_message` WebSocket event in real time. The merchant can read every message from every buyer/agent without refreshing.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Clerk Auth, Tabler CSS |
| Backend | Node.js, Express, TypeScript |
| AI | Google Gemini Pro (chat + embeddings) |
| Database | PostgreSQL 15 + pgvector extension |
| Payments | Razorpay (Orders API + HMAC-SHA256 verification) |
| Realtime | Socket.IO |
| Deployment | Vercel (frontend) + Railway/Render (backend) |

---

## Project Structure

```
nexus-a2a/
├── backend/
│   ├── demo-a2a.js                  # A2A demo script (screen-recordable)
│   ├── a2a-test.js                  # Quick A2A smoke test
│   └── src/
│       ├── server.ts                # Express + Socket.IO setup
│       ├── routes/
│       │   ├── discovery.ts         # Semantic search (pgvector hybrid)
│       │   ├── negotiation.ts       # Core negotiation engine (all chat logic)
│       │   ├── checkout.ts          # Razorpay order + payment verification
│       │   ├── admin.ts             # Merchant admin (approve/reject/kill)
│       │   └── merchant.ts          # Catalog upload + config
│       ├── services/
│       │   ├── auto-vectorizer.ts   # Rule compiler + embedding generator
│       │   ├── constraint-solver.ts # Deterministic price ceiling calculator
│       │   ├── session-manager.ts   # Session CRUD + message logging
│       │   ├── inventory-manager.ts # Soft-allocate / hard-deduct logic
│       │   ├── gemini.ts            # Gemini Pro + embedding client
│       │   └── razorpay.ts          # Razorpay SDK wrapper
│       ├── middleware/
│       │   └── session-guard.ts     # x-session-id validation middleware
│       └── db/
│           └── client.ts            # pg Pool instance
└── frontend/
    └── app/
        ├── page.tsx                 # Landing page (GSAP + WebGL)
        ├── shop/page.tsx            # Customer shop + chat + checkout
        ├── dashboard/page.tsx       # Admin dashboard (charts, monitor, config)
        ├── docs/page.tsx            # A2A API documentation portal
        └── components/
            └── Nav.tsx              # Shared navigation
```

---

*Built for the Razorpay Hackathon · Nexus A2A Engine · 2026*
