-- Enable pgvector extension (required once on Neon)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABLE: merchant_config
-- Controls the AI personality, universal rules, and workflow
-- ============================================================
CREATE TABLE IF NOT EXISTS merchant_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  max_discount_pct        FLOAT NOT NULL DEFAULT 3.0,
  max_rounds              INT   NOT NULL DEFAULT 3,
  session_timeout_minutes INT   NOT NULL DEFAULT 15,
  llm_personality         TEXT  CHECK (llm_personality IN ('STRICT', 'BALANCED', 'FLEXIBLE')) DEFAULT 'STRICT',
  require_manual_approval BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- TABLE: products
-- Full product data, semantic embedding, and stock management
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  brand            TEXT NOT NULL,
  model            TEXT NOT NULL,
  category         TEXT NOT NULL,
  description      TEXT NOT NULL,
  specs            JSONB,
  price            NUMERIC(12,2) NOT NULL,
  stock            INT NOT NULL CHECK (stock >= 0),
  allocated_stock  INT NOT NULL DEFAULT 0 CHECK (allocated_stock >= 0),
  unstructured_rules TEXT,
  parsed_rules     JSONB,
  embedding        vector(768),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ivfflat index for fast approximate nearest-neighbour search
CREATE INDEX IF NOT EXISTS products_embedding_idx ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Trigger to auto-update updated_at on product changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: sessions
-- Tracks the full lifecycle of one buyer interaction
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_type        TEXT CHECK (buyer_type IN ('HUMAN', 'AGENT')) NOT NULL,
  status            TEXT CHECK (status IN (
                      'ACTIVE',
                      'PENDING_MERCHANT_REVIEW',
                      'APPROVED',
                      'TERMINATED',
                      'COMPLETED'
                    )) DEFAULT 'ACTIVE',
  rounds_used       INT DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  terminated_reason TEXT,
  clerk_user_id     TEXT
);

-- ============================================================
-- TABLE: session_messages
-- The immutable audit trail of every message and system decision
-- ============================================================
CREATE TABLE IF NOT EXISTS session_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT CHECK (role IN ('USER', 'AGENT', 'SYSTEM', 'MERCHANT')) NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: cart_items
-- Products added to the cart during a session
-- ============================================================
CREATE TABLE IF NOT EXISTS cart_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  quantity    INT NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12,2) NOT NULL,
  final_price NUMERIC(12,2)
);

-- ============================================================
-- TABLE: razorpay_orders
-- Created only after merchant approval (auto or manual)
-- ============================================================
CREATE TABLE IF NOT EXISTS razorpay_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID REFERENCES sessions(id),
  razorpay_order_id TEXT NOT NULL,
  amount_paise      BIGINT NOT NULL,
  currency          TEXT DEFAULT 'INR',
  status            TEXT CHECK (status IN ('CREATED', 'PAID', 'FAILED')) DEFAULT 'CREATED',
  customer_phone    TEXT,
  shipping_address  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: user_carts
-- Persistent cloud storage for a user's pre-negotiation cart
-- ============================================================
CREATE TABLE IF NOT EXISTS user_carts (
  clerk_user_id TEXT PRIMARY KEY,
  cart_data     JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
