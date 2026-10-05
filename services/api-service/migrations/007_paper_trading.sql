-- Paper trading (virtual funds, real Binance prices). Idempotent.
-- user_id has no FK on purpose (users live in auth-service's table).

CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id UUID PRIMARY KEY,
  balance NUMERIC(24, 8) NOT NULL DEFAULT 10000 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_count INT NOT NULL DEFAULT 0 CHECK (reset_count >= 0),
  last_reset_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL CHECK (char_length(symbol) <= 20),
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  qty NUMERIC(24, 8) NOT NULL CHECK (qty > 0),
  leverage INT NOT NULL CHECK (leverage BETWEEN 1 AND 50),
  entry_price NUMERIC(24, 8) NOT NULL CHECK (entry_price > 0),
  margin NUMERIC(24, 8) NOT NULL CHECK (margin > 0),
  sl_price NUMERIC(24, 8) CHECK (sl_price IS NULL OR sl_price > 0),
  tp_price NUMERIC(24, 8) CHECK (tp_price IS NULL OR tp_price > 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  exit_price NUMERIC(24, 8),
  exit_reason TEXT CHECK (exit_reason IS NULL OR exit_reason IN ('MANUAL', 'SL', 'TP', 'LIQUIDATED')),
  realized_pnl NUMERIC(24, 8),
  -- Total fees paid so far (open fee at open; open + close fee once closed).
  fee NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (fee >= 0)
);
CREATE INDEX IF NOT EXISTS idx_paper_positions_user_closed ON paper_positions(user_id, closed_at);
-- Fast "all open positions" sweep for the SL/TP engine.
CREATE INDEX IF NOT EXISTS idx_paper_positions_open ON paper_positions(user_id) WHERE closed_at IS NULL;
-- History keyset pagination + leaderboard window.
CREATE INDEX IF NOT EXISTS idx_paper_positions_history ON paper_positions(user_id, closed_at DESC, id DESC) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at ON paper_positions(closed_at) WHERE closed_at IS NOT NULL;
