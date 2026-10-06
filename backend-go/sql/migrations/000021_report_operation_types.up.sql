-- 000021: tipos de operación del informe de incidente (catalogOperationTypes
-- del legacy: "Ofensas", "Caza de Amenazas"…). Al elegir uno, el formulario
-- de Reportes rellena "Información adicional" con su texto por defecto.
CREATE TABLE report_operation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  info_default TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
