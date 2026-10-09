-- QA L24: the "My own domain (to be approved)" capstone option now asks for a
-- short description. Options are JSON, so this is a data-only change: flag that
-- option on courses that already have it (admins can flag others in the editor).
UPDATE "ScreeningQuestion" q
SET "options" = (
  SELECT jsonb_agg(
    CASE
      WHEN o->>'value' = 'own' AND o->>'labelEn' LIKE 'My own domain%' THEN o || '{"requiresDetail": true}'::jsonb
      ELSE o
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(q."options") WITH ORDINALITY AS t(o, ord)
)
WHERE q."type" = 'SINGLE_SELECT'
  AND jsonb_typeof(q."options") = 'array'
  AND q."options" @> '[{"value": "own"}]'::jsonb;
