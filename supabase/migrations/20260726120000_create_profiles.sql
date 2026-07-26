/*
  # Create profiles table

  ## Purpose
  CrewChief has no per-user record beyond the `auth.users` row. There is
  nowhere to store a display name, a units preference, or notification
  settings — all of which Phase 1's account settings screen needs, and which
  the mobile companion will need for push preferences.

  ## Design notes

  ### Populated by trigger, not application code
  A profile is created by an AFTER INSERT trigger on `auth.users`. Doing this
  in the app would mean every signup path has to remember, and a missed path
  produces a user with no profile — a null-check that then has to be handled
  forever. The trigger makes "every user has a profile" an invariant.

  ### Units matter more than they look
  The app assumes miles everywhere. `distance_unit` is stored so the mobile
  app and any future non-US user get consistent formatting from one source
  rather than per-component guesses.

  ### notification_preferences is JSONB deliberately
  Phase 4 adds push notifications (maintenance reminders, mileage prompts).
  The exact keys aren't settled, and a JSONB column avoids a migration per
  toggle. Structure is enforced in application code, not the schema.

  ## Security
  - RLS on, no anon access at all. Unlike vehicles there is no demo case —
    the demo user's profile should never be readable by visitors.
  - A user can read and update only their own row.
  - No INSERT policy: rows come from the trigger, which runs as definer.
  - No DELETE policy: profiles disappear via the cascade from auth.users.
    Making them individually deletable would let a user orphan themselves.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_storage_path TEXT,
  distance_unit TEXT NOT NULL DEFAULT 'mi' CHECK (distance_unit IN ('mi', 'km')),
  currency TEXT NOT NULL DEFAULT 'USD',
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policies — owner only, no anon path
-- ============================================================

DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Anon has no business here at all.
REVOKE ALL ON profiles FROM anon;

-- ============================================================
-- updated_at maintenance
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profiles_updated_at();

-- ============================================================
-- Auto-create a profile for every new auth user
-- ============================================================

/*
  SECURITY DEFINER because it writes to a table the inserting role has no
  INSERT policy for. search_path is pinned — an unpinned search_path on a
  definer function is a privilege-escalation vector, and the June 2026
  hardening pass fixed exactly this on four other functions.

  ON CONFLICT DO NOTHING keeps the trigger idempotent, so a replayed insert
  or a backfill race cannot fail signup.
*/
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    -- Best-effort friendly default; the user can change it in settings.
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Backfill existing users
-- ============================================================

INSERT INTO public.profiles (id, display_name)
SELECT id, split_part(email, '@', 1)
FROM auth.users
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);
