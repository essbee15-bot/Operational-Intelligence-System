-- ============================================================
-- Migration: Full RLS Policies + Platform Admin Column
-- ============================================================
-- This migration:
-- 1. Adds is_platform_admin flag to users (set via Supabase dashboard only)
-- 2. Fixes overly-broad SELECT policies for meetings and action_items
-- 3. Adds INSERT / UPDATE / DELETE policies for all tables
-- 4. Locks down organization creation to service role only (no user can self-register a company)
-- ============================================================

-- Add platform admin flag. Only set via Supabase dashboard / service role. Never via app UI.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Helper functions (SECURITY DEFINER so they run as postgres,
-- not as the calling user, preventing RLS recursion issues)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'manager')
  );
$$;

-- ============================================================
-- ORGANIZATIONS
-- Lock creation to service role only. Users can only view/update their own org.
-- ============================================================

-- Block all user-level INSERTs (only service role, which bypasses RLS, can create orgs)
CREATE POLICY "Users cannot create organizations" ON organizations
  FOR INSERT WITH CHECK (FALSE);

-- Org admins can update their org settings (e.g., name)
CREATE POLICY "Org admins can update their organization" ON organizations
  FOR UPDATE
  USING (id = public.user_organization_id() AND public.is_org_admin())
  WITH CHECK (id = public.user_organization_id() AND public.is_org_admin());

-- No user-level DELETE (only service role)
CREATE POLICY "Users cannot delete organizations" ON organizations
  FOR DELETE USING (FALSE);

-- ============================================================
-- USERS
-- Org admins can create/update/delete users in their org.
-- All user creation goes through service role on the server,
-- but the RLS policy below adds defense-in-depth.
-- ============================================================

-- INSERT: only org admins can add users to their org via RLS.
-- (Platform admin uses service role and bypasses RLS entirely.)
CREATE POLICY "Org admins can create users in their org" ON users
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id() AND public.is_org_admin()
  );

-- UPDATE: a user can update their own profile (e.g., name, password change triggers this)
CREATE POLICY "Users can update their own profile" ON users
  FOR UPDATE
  USING (id = auth.uid() AND organization_id = public.user_organization_id())
  WITH CHECK (
    id = auth.uid()
    AND organization_id = public.user_organization_id()
    -- Prevent self-promotion: a user cannot change their own role or is_platform_admin
    AND role = (SELECT role FROM public.users WHERE id = auth.uid())
    AND is_platform_admin = (SELECT is_platform_admin FROM public.users WHERE id = auth.uid())
  );

-- UPDATE: org admins can update any user in their org (role, manager_id, etc.)
CREATE POLICY "Org admins can update users in their org" ON users
  FOR UPDATE
  USING (organization_id = public.user_organization_id() AND public.is_org_admin())
  WITH CHECK (
    organization_id = public.user_organization_id()
    -- Admins cannot set is_platform_admin via app (only via service role)
    AND is_platform_admin = FALSE
  );

-- DELETE: org admins can remove users, but not themselves
CREATE POLICY "Org admins can remove users from their org" ON users
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
    AND id != auth.uid()
  );

-- ============================================================
-- TEAMS
-- Only org admins can create/update/delete teams.
-- ============================================================

CREATE POLICY "Org admins can manage teams" ON teams
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id() AND public.is_org_admin()
  );

CREATE POLICY "Org admins can update teams" ON teams
  FOR UPDATE
  USING (organization_id = public.user_organization_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org admins can delete teams" ON teams
  FOR DELETE USING (
    organization_id = public.user_organization_id() AND public.is_org_admin()
  );

-- ============================================================
-- TEMPLATES
-- Admins and managers can create/update. Only admins can delete.
-- ============================================================

CREATE POLICY "Managers and admins can create templates" ON templates
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id() AND public.is_manager_or_admin()
  );

CREATE POLICY "Managers and admins can update templates" ON templates
  FOR UPDATE
  USING (organization_id = public.user_organization_id() AND public.is_manager_or_admin())
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org admins can delete templates" ON templates
  FOR DELETE USING (
    organization_id = public.user_organization_id() AND public.is_org_admin()
  );

-- ============================================================
-- MEETINGS
-- FIX: DROP the overly-broad SELECT policy (all org members could see all meetings).
-- Meetings contain sensitive HR/performance data. Only organizer, attendee, and admins should see them.
-- ============================================================

DROP POLICY IF EXISTS "Tenant isolation for meetings" ON meetings;

CREATE POLICY "Meeting participants and admins can view meetings" ON meetings
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND (
      organizer_id = auth.uid()
      OR attendee_id = auth.uid()
      OR public.is_org_admin()
    )
  );

-- INSERT: only managers and admins can create meetings (they are the organizers)
CREATE POLICY "Managers and admins can create meetings" ON meetings
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id()
    AND organizer_id = auth.uid()
    AND public.is_manager_or_admin()
  );

-- UPDATE: organizer or org admin
CREATE POLICY "Organizer or admin can update meetings" ON meetings
  FOR UPDATE
  USING (
    organization_id = public.user_organization_id()
    AND (organizer_id = auth.uid() OR public.is_org_admin())
  )
  WITH CHECK (organization_id = public.user_organization_id());

-- DELETE: organizer or org admin
CREATE POLICY "Organizer or admin can delete meetings" ON meetings
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND (organizer_id = auth.uid() OR public.is_org_admin())
  );

-- ============================================================
-- PROJECTS
-- All org members can view. Owner/manager/admin can modify.
-- ============================================================

CREATE POLICY "Org members can create projects" ON projects
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id()
    AND owner_id = auth.uid()
  );

CREATE POLICY "Owner, manager, or admin can update projects" ON projects
  FOR UPDATE
  USING (
    organization_id = public.user_organization_id()
    AND (
      owner_id = auth.uid()
      OR public.is_manager_or_admin()
    )
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Owner or admin can delete projects" ON projects
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND (owner_id = auth.uid() OR public.is_org_admin())
  );

-- ============================================================
-- ACTION ITEMS
-- FIX: DROP the overly-broad SELECT policy.
-- Assignee sees their own. Managers see their direct reports'. Admins see all.
-- ============================================================

DROP POLICY IF EXISTS "Tenant isolation for action_items" ON action_items;

CREATE POLICY "Users see their own action items, managers see reports, admins see all" ON action_items
  FOR SELECT USING (
    organization_id = public.user_organization_id()
    AND (
      assignee_id = auth.uid()
      OR public.is_org_admin()
      OR EXISTS (
        SELECT 1 FROM public.users
        WHERE id = action_items.assignee_id
          AND manager_id = auth.uid()
      )
    )
  );

-- INSERT: any authenticated org member can create action items
CREATE POLICY "Org members can create action items" ON action_items
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id()
  );

-- UPDATE: assignee (status changes) or admin
CREATE POLICY "Assignee or admin can update action items" ON action_items
  FOR UPDATE
  USING (
    organization_id = public.user_organization_id()
    AND (assignee_id = auth.uid() OR public.is_org_admin())
  )
  WITH CHECK (organization_id = public.user_organization_id());

-- DELETE: org admin only
CREATE POLICY "Org admins can delete action items" ON action_items
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ============================================================
-- KPIS
-- Managers and admins can create/update. Only admins can delete.
-- ============================================================

CREATE POLICY "Managers and admins can create KPIs" ON kpis
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  );

CREATE POLICY "Managers and admins can update KPIs" ON kpis
  FOR UPDATE
  USING (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org admins can delete KPIs" ON kpis
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );

-- ============================================================
-- KPI RECORDS
-- Managers and admins can add/update records. Only admins can delete.
-- ============================================================

CREATE POLICY "Managers and admins can insert KPI records" ON kpi_records
  FOR INSERT WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  );

CREATE POLICY "Managers and admins can update KPI records" ON kpi_records
  FOR UPDATE
  USING (
    organization_id = public.user_organization_id()
    AND public.is_manager_or_admin()
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "Org admins can delete KPI records" ON kpi_records
  FOR DELETE USING (
    organization_id = public.user_organization_id()
    AND public.is_org_admin()
  );
