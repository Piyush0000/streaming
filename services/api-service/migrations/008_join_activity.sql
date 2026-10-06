-- Social "who just joined" feed. One row per user (first-touch acquisition
-- source). No FK on purpose (users live in auth-service's table). Idempotent.
CREATE TABLE IF NOT EXISTS join_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('x','facebook','instagram','youtube','reddit','telegram','whatsapp','google','direct','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_join_events_created ON join_events (created_at DESC);
