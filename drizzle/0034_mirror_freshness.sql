-- The weekly Us-mirror was cached per (couple, week) and never refreshed, so a couple who opened
-- it mid-week kept reading that version for the rest of the week. Record how many unlocked days it
-- was written from so it can be regenerated as the week fills in.
ALTER TABLE couple_mirrors ADD COLUMN IF NOT EXISTS unlocked_days integer NOT NULL DEFAULT 0;
