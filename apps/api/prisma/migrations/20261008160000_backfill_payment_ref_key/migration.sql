-- Backfill the normalised reference for payments created before the column existed.
UPDATE "Payment"
SET "transactionRefKey" = UPPER(REGEXP_REPLACE("transactionRef", '[^A-Za-z0-9]', '', 'g'))
WHERE "transactionRefKey" = '';
