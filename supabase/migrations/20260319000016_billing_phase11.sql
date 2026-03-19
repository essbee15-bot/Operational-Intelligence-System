-- ─── Migration: Billing Phase 11 ─────────────────────────────────────────────
--
-- Extends the organizations table with Stripe subscription detail columns.
-- stripe_customer_id and subscription_status already exist from initial schema.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT,
  ADD COLUMN IF NOT EXISTS subscription_plan        TEXT    NOT NULL DEFAULT 'free'
                                                      CHECK (subscription_plan IN ('free', 'starter', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS subscription_period_end  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_users                INTEGER NOT NULL DEFAULT 5;
