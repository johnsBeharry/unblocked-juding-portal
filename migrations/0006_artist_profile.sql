-- Artist profile: bio, photo, and acceptance of the Terms of Service and
-- Privacy Policy. Also lets a code request carry the details typed on the
-- form, so the account is created with them when the email is verified
-- (by code or by link, in any browser).

ALTER TABLE artists ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE artists ADD COLUMN photo_key TEXT;              -- R2 key, artists/<id>/photo-<rand>.<ext>
ALTER TABLE artists ADD COLUMN terms_version TEXT;          -- version of the terms + privacy policy accepted
ALTER TABLE artists ADD COLUMN terms_accepted_at TEXT;

-- JSON {name, country, instagram, bio, termsVersion}; applied on verification.
ALTER TABLE artist_login_codes ADD COLUMN pending_profile TEXT;
-- R2 key of a photo sent with the code request (artists/pending/<rand>.<ext>).
ALTER TABLE artist_login_codes ADD COLUMN pending_photo_key TEXT;
