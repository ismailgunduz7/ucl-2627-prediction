-- The newest release notes an account has read.
--
-- A player who signs in after a release is shown what changed, once. The mark
-- lives on the account rather than in the browser so that closing the dialog
-- on a phone means not seeing it again on the desktop. Null is an account that
-- has read nothing yet, which is every account until the first release with
-- notes ships, and every account created after it until its first sign-in.

ALTER TABLE users
  ADD COLUMN last_seen_release text;
