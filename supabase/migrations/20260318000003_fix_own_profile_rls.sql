-- Users with a NULL organization_id (platform admins) are blocked by the existing
-- org-based SELECT policy because NULL = NULL is NULL (not TRUE) in SQL.
-- This policy ensures any authenticated user can always read their own profile row.

CREATE POLICY "Users can always read their own profile" ON users
  FOR SELECT USING (id = auth.uid());
