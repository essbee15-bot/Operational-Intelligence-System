-- ============================================================
-- Migration: Remove rating_last_month
-- Old single-number rating replaced by multi-dimension scoring system
-- ============================================================

ALTER TABLE meetings DROP COLUMN IF EXISTS rating_last_month;
