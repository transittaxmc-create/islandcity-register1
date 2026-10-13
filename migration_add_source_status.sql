-- Add traceability for Claris bill imports
ALTER TABLE recurring_projections
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Helpful index for Claris imports
CREATE INDEX IF NOT EXISTS idx_recurring_projections_source_external
  ON recurring_projections(source, external_id);

-- Optional: backfill existing rows
UPDATE recurring_projections
SET source = 'manual',
    status = 'pending'
WHERE source IS NULL;
