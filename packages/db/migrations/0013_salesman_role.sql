-- Add 'salesman' as a valid role in the members table.
-- Salesman-role users are linked to a specific salesman row via
-- capabilities->>'salesmanId' and can only view their own account.
ALTER TABLE members DROP CONSTRAINT IF EXISTS member_role;
ALTER TABLE members ADD CONSTRAINT member_role
  CHECK (role = ANY (ARRAY['owner'::text, 'manager'::text, 'salesman'::text]));

