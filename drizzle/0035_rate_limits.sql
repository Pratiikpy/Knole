-- Durable rate-limit buckets. The limiter was an in-memory Map, which on Vercel resets on every
-- cold start and is not shared across concurrent instances - so the only cost guard on the paid
-- inference endpoints enforced nothing under real load.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON rate_limits (reset_at);
