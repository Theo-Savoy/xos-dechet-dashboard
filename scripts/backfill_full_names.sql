-- Backfill full_name from email local-part for profiles that lack a name.
-- "christophe.hirtz@xos-learning.fr" -> "Christophe Hirtz"
-- "ada.lovelace" -> "Ada Lovelace"
-- Skips rows where the local part cannot be parsed into at least one word.
UPDATE profiles
SET full_name = (
  SELECT string_agg(initcap(part), ' ')
  FROM unnest(string_to_array(split_part(email, '@', 1), '.')) AS part
  WHERE part ~ '[A-Za-z]'
)
WHERE full_name IS NULL
  AND email IS NOT NULL
  AND split_part(email, '@', 1) ~ '[A-Za-z]'
RETURNING id, email, full_name;