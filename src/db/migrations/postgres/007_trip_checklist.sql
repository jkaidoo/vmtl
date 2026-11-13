-- Driver pre-trip inspection checklist, captured at trip start (JSON array of
-- { key, label, ok } items).
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_checklist TEXT;
