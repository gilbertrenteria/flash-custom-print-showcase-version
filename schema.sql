-- Flash Custom Apparel / Flash Signs -- D1 database schema
-- Run once: wrangler d1 execute flash-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject_label TEXT,
  breakdown TEXT,
  rush INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT 'apparel',
  description TEXT,
  qty INTEGER,
  amount REAL,
  contact_email TEXT,
  contact_phone TEXT,
  needed_by TEXT,
  notes TEXT,
  stage TEXT NOT NULL DEFAULT 'New Inquiry',
  is_example INTEGER NOT NULL DEFAULT 0,
  from_quote_id TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  -- Free-text detail about the initial contact (e.g. what they said, how it
  -- came in beyond just the source tag). Optional.
  contact_note TEXT,
  -- What was actually quoted -- kept separate from `description` (which is
  -- the customer's full ask) so the board can show a clean "quoted $X for Y"
  -- line. `amount` doubles as the quoted dollar figure.
  quoted_for TEXT,
  quoted_at TEXT,
  -- Captured when a card is marked Lost/Declined, so decline reasons build
  -- into real data over time instead of being guessed after the fact.
  lost_reason TEXT,
  lost_note TEXT,
  -- What a subcontractor actually charged for this job, for real per-order
  -- margin (amount - vendor_cost) instead of just the sell price.
  vendor_id TEXT,
  vendor_cost REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT,
  contact TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  notes TEXT,
  created_at TEXT NOT NULL
);

-- single-row table: business info reference card
CREATE TABLE IF NOT EXISTS business_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  divisions TEXT,
  location TEXT,
  years_in_business TEXT,
  legal_status TEXT,
  contact TEXT,
  model TEXT,
  supplier TEXT,
  volume TEXT,
  acquisition_today TEXT,
  growth_goal TEXT,
  pricing_notes TEXT,
  marketing_site_url TEXT
);

INSERT OR IGNORE INTO business_info (id, divisions, location, years_in_business, legal_status, contact, model, supplier, volume, acquisition_today, growth_goal, pricing_notes, marketing_site_url)
VALUES (
  1,
  'Custom Apparel (screen print, embroidery, DTF) and Custom Signs (yard signs, banners, business cards).',
  'Houston, TX',
  'Several years',
  'Established small business.',
  'Phone/Text: (555) 555-0100 · Email: hello@example.com · Instagram: @yourshop',
  'In-house design and fulfillment.',
  'Wholesale blank-apparel distributor (dealer account).',
  'Small, steady monthly order volume.',
  'Houston-local, via friend referrals and word of mouth.',
  'Scale to a national level and automate as much of the operation as possible.',
  'Apparel pricing drops at quantity tiers and varies by decoration method. Signs order minimums: Yard Signs 10-sign minimum, Business Cards 500-card minimum. Order stages: Quoted → Paid → Sent to Vendor → QC → Shipped.',
  ''
);

-- Live presence: one row per visitor session (upserted on every heartbeat
-- ping from the site), used to show "who's on your site right now."
CREATE TABLE IF NOT EXISTS visitors (
  session_id TEXT PRIMARY KEY,
  page TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- One row per unique visitor session's FIRST ping only (not every 20s
-- heartbeat) -- powers the dashboard's traffic/conversion/source charts and
-- is what the "new visitor" text alert is based on.
CREATE TABLE IF NOT EXISTS visits_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  landing_page TEXT,
  referrer TEXT,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_log_created ON visits_log(created_at);

-- One row per chat conversation. mode 'ai' = the assistant is answering;
-- 'human' = a Flash team member has taken over and the AI stops replying.
-- resolution tracks whether the visitor confirmed the AI actually answered
-- their question ('pending' until they respond to that check).
-- quote_submitted prevents the AI from auto-submitting more than one quote
-- per conversation.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'ai',
  last_page TEXT,
  started_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  resolution TEXT NOT NULL DEFAULT 'pending',
  quote_submitted INTEGER NOT NULL DEFAULT 0
);

-- Every message in every chat -- role is 'visitor', 'ai', or 'agent' (a Flash
-- team member replying from the dashboard).
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- One row per visitor session that has triggered a "new chat" alert --
-- lets the backend send at most one text/email per visitor within a short
-- window even if they open several chat sessions back to back.
CREATE TABLE IF NOT EXISTS chat_alert_throttle (
  visitor_key TEXT PRIMARY KEY,
  last_alert_at TEXT NOT NULL
);

-- Canned responses Gilbert can add/edit/reorder himself in the dashboard and
-- use as one-tap chips when replying to a live chat.
CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- A photo/logo a visitor attaches mid-chat (paperclip button next to the
-- chat input). At most one pending attachment per session -- attaching a
-- new file overwrites it. Picked up automatically whenever a quote is
-- submitted from that conversation, so it rides along as a real email
-- attachment, same as the on-site quote form.
CREATE TABLE IF NOT EXISTS chat_attachments (
  session_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
