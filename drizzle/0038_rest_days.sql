-- Rest days (habitica's Inn, translated): a day the user DECLARES as rest does not break a
-- streak. Declared, never automatic - the honesty of the streak depends on rest being a choice
-- made in advance or on the day, not a retroactive excuse.
CREATE TABLE IF NOT EXISTS rest_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rest_days_user_date_uniq ON rest_days (user_id, date)
