-- Make the pay-with-0G claim atomic: the dedupe key becomes a real constraint, so two concurrent
-- claims of the same transaction can never both credit. Partial, so it only covers credit claims.
CREATE UNIQUE INDEX IF NOT EXISTS reflection_artifacts_og_credit_tx_uniq
  ON reflection_artifacts ((content->>'txHash'))
  WHERE thread_key = 'og-credit';
