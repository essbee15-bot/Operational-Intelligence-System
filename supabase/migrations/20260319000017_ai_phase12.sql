-- ─── Migration: AI Phase 12 ───────────────────────────────────────────────────
--
-- 1. Enable pgvector extension (for semantic similarity search)
-- 2. Create ai_settings table (per-org AI provider configuration)
-- 3. Create ai_embeddings table (vector embeddings of org records)
-- 4. Add full-text search indexes on key tables

-- 1. pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. AI settings (one row per org)
CREATE TABLE IF NOT EXISTS ai_settings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  is_enabled        BOOLEAN     NOT NULL DEFAULT false,
  provider          TEXT        NOT NULL DEFAULT 'openai'
                                  CHECK (provider IN ('openai', 'anthropic')),
  api_key           TEXT,
  model             TEXT        NOT NULL DEFAULT 'gpt-4o-mini',
  -- OpenAI only — used for generating embeddings for vector search
  embedding_model   TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;

-- Only org admins can read or write ai_settings
CREATE POLICY "Org admins manage ai_settings"
  ON ai_settings FOR ALL
  USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- 3. Embeddings store (one row per record)
CREATE TABLE IF NOT EXISTS ai_embeddings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_type     TEXT        NOT NULL CHECK (record_type IN ('project', 'meeting', 'goal', 'action')),
  record_id       UUID        NOT NULL,
  content_text    TEXT        NOT NULL,  -- the text that was embedded (for re-embed detection)
  embedding       vector(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, record_type, record_id)
);

ALTER TABLE ai_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage ai_embeddings"
  ON ai_embeddings FOR ALL
  USING (organization_id = public.user_organization_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.user_organization_id() AND public.is_org_admin());

-- Index for fast cosine similarity search per org
CREATE INDEX IF NOT EXISTS ai_embeddings_org_idx ON ai_embeddings (organization_id, record_type);

-- 4. Full-text search indexes (for keyword-based retrieval without embeddings)
-- projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(outcomes, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS projects_fts_idx ON projects USING GIN (fts);

-- meetings
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(general_notes, '') || ' ' ||
      coalesce(outcomes, '') || ' ' ||
      coalesce(development_requests, '') || ' ' ||
      coalesce(project_involvement_notes, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS meetings_fts_idx ON meetings USING GIN (fts);
