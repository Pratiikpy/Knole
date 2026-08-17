-- Typed entity-to-entity relationships (graphiti's EntityEdge, on Postgres). The entity arm was a
-- flat entity -> memories bag; edges give "the story with Mara" actual structure: who connects to
-- whom, how, since when, and until when (bi-temporal, supersede-not-delete like memories).
CREATE TABLE IF NOT EXISTS memory_entity_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  target_name text NOT NULL,
  relation text NOT NULL,
  fact text NOT NULL,
  source_memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  valid_at timestamp DEFAULT now() NOT NULL,
  invalid_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS entity_edges_user_source_idx ON memory_entity_edges (user_id, source_name);
CREATE INDEX IF NOT EXISTS entity_edges_user_target_idx ON memory_entity_edges (user_id, target_name)
