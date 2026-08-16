-- Stripe delivers webhooks at-least-once. Make the event id the idempotency key for credit grants
-- so a retried delivery cannot add the same credits twice.
CREATE UNIQUE INDEX IF NOT EXISTS reflection_artifacts_stripe_event_uniq
  ON reflection_artifacts ((content->>'eventId'))
  WHERE thread_key = 'stripe-event';
