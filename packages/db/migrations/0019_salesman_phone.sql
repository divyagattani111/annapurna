-- Migration: add phone column to salesmen table for WhatsApp sharing
-- Stored normalized as 91XXXXXXXXXX (12 digits, E.164 without '+')
ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS phone text;

-- Backfill from details->>'phone' if previously stored in jsonb
UPDATE salesmen SET phone = clean_phone 
FROM (
  SELECT id, 
    CASE 
      WHEN (details->>'phone') IS NOT NULL AND (details->>'phone') != '' THEN
        CASE 
          WHEN length(regexp_replace(details->>'phone', '\D', '', 'g')) = 10 
            THEN '91' || regexp_replace(details->>'phone', '\D', '', 'g')
          WHEN length(regexp_replace(details->>'phone', '\D', '', 'g')) = 12 
               AND regexp_replace(details->>'phone', '\D', '', 'g') LIKE '91%' 
            THEN regexp_replace(details->>'phone', '\D', '', 'g')
          ELSE regexp_replace(details->>'phone', '\D', '', 'g')
        END
      ELSE NULL 
    END AS clean_phone
  FROM salesmen
) sub
WHERE salesmen.id = sub.id 
  AND (salesmen.phone IS NULL OR salesmen.phone = '') 
  AND sub.clean_phone IS NOT NULL;
