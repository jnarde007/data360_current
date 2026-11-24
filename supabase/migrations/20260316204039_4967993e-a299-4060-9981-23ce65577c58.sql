DO $$
DECLARE
  admin_ids uuid[] := ARRAY[
    '501f21a3-e6fc-4c8d-8ca4-d6c07636bdde'::uuid,
    '359b5a2a-7f16-40b3-8487-f5ace09a014a'::uuid,
    '97fd333b-7360-4d3c-8352-7a7d1edcebae'::uuid
  ];
  r record;
BEGIN
  FOR r IN SELECT id FROM auth.users WHERE id != ALL(admin_ids)
  LOOP
    DELETE FROM auth.sessions WHERE user_id = r.id;
    DELETE FROM auth.identities WHERE user_id = r.id;
    DELETE FROM auth.mfa_factors WHERE user_id = r.id;
    DELETE FROM auth.refresh_tokens WHERE user_id = r.id::text;
    DELETE FROM auth.users WHERE id = r.id;
  END LOOP;
END;
$$