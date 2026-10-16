-- Numeración de tickets configurable (pedido del dueño 2026-10-16): prefijo,
-- año opcional y dígitos; una general y otras por área (varias áreas pueden
-- compartir una). Numera el área que pide el ticket y el correlativo nunca
-- vuelve a 1. Los tickets existentes conservan su número.
CREATE TABLE ticket_number_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  prefix TEXT NOT NULL CHECK (prefix ~ '^[A-Z0-9]{1,10}$'),
  -- none: sin año · yyyy: 2026 · yy: 26
  year_format TEXT NOT NULL DEFAULT 'yyyy' CHECK (year_format IN ('none', 'yyyy', 'yy')),
  digits INT NOT NULL DEFAULT 5 CHECK (digits BETWEEN 3 AND 10),
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ticket_number_series_default ON ticket_number_series (is_default) WHERE is_default;

-- La general es la de siempre (TKT-AAAA-NNNNN) y sigue desde el último número usado.
INSERT INTO ticket_number_series (name, prefix, year_format, digits, next_number, is_default)
SELECT 'General', 'TKT', 'yyyy', 5,
  COALESCE((SELECT max(substring(ticket_number FROM '(\d+)$')::bigint) FROM tickets), 0) + 1, true;

-- Sin numeración propia, el área usa la general.
ALTER TABLE areas ADD COLUMN ticket_series_id UUID REFERENCES ticket_number_series(id) ON DELETE SET NULL;
