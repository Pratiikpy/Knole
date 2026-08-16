-- Share-then-fork (khoj's PublicConversation): a reflection published as a frozen snapshot at a
-- public slug. The rest of the journal stays sealed - only the chosen entry + reflection go out.
CREATE TABLE IF NOT EXISTS shared_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  entry_text text NOT NULL,
  reflection_text text NOT NULL,
  revoked_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_reflections_user_idx ON shared_reflections (user_id)
