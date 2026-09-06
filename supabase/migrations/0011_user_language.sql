-- The language a player reads the game in.
--
-- It lives on the account rather than in the browser so the choice follows the
-- person: switch to English on a phone and the desktop session shows English
-- too. A browser that has never signed in still falls back to its own setting
-- client-side; this column is what a signed-in session trusts.

ALTER TABLE users
  ADD COLUMN language text NOT NULL DEFAULT 'tr'
    CONSTRAINT users_language_supported CHECK (language IN ('tr', 'en'));
