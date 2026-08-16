-- Dates MENTIONED inside entries, extracted at save time. This is what lets "what did I write
-- about my birthday" match the entry that talks about it, not just entries created that day.
CREATE TABLE IF NOT EXISTS entry_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_dates_user_date_idx ON entry_dates (user_id, date);
CREATE INDEX IF NOT EXISTS entry_dates_entry_idx ON entry_dates (entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS entry_dates_uniq ON entry_dates (entry_id, date);
