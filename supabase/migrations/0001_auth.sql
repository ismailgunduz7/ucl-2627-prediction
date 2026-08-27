-- Phase 0: auth foundation (PLAN.md §8.1, §9.1).
-- Competitions are visibility scopes only; they carry no rule/scoring/config
-- overrides. Users are admin-provisioned (no public self-registration).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- competitions -------------------------------------------------------------
CREATE TABLE competitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- users --------------------------------------------------------------------
-- Created only via the admin API. `is_admin` accounts are excluded from
-- participant leaderboards (§3.1) and do not play on the same account.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL,
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  is_admin       boolean NOT NULL DEFAULT false,
  competition_id uuid REFERENCES competitions (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Usernames are unique case-insensitively so login lookups are unambiguous.
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
CREATE INDEX users_competition_idx ON users (competition_id);

-- Every non-admin participant must belong to a competition (visibility scope).
-- Admins may be unscoped.
ALTER TABLE users
  ADD CONSTRAINT users_participant_has_competition
  CHECK (is_admin OR competition_id IS NOT NULL);

-- refresh_tokens -----------------------------------------------------------
-- Rotation-safe refresh sessions (§9.1). We store only a hash of the token so a
-- DB leak does not expose usable refresh tokens. Rotation: on refresh, mark the
-- presented token `rotated_at`/`replaced_by` and issue a fresh row.
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  rotated_at   timestamptz,
  replaced_by  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  user_agent   text,
  ip           text
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

-- Keep updated_at fresh on mutation.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER competitions_set_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
