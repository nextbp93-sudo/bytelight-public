-- Migration 0015: let dreams carry an optional type and the question that
-- emerged from them. Existing dreams remain untyped and without a question.

ALTER TABLE dreams ADD COLUMN dream_type TEXT;
ALTER TABLE dreams ADD COLUMN emerged_question TEXT;
