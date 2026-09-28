-- Respaldos al nivel del legacy (decisión del dueño 2026-09-27): programación
-- automática con retención y destino, origen de cada copia, e interruptor
-- "Permitir purga" (apagado por defecto: solo ambientes de prueba).

-- Origen de cada copia: la pantalla distingue automático / manual / subido /
-- el respaldo de seguridad que se toma antes de "Reemplazar todo".
ALTER TABLE backup_runs
  ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'auto', 'upload', 'pre_restore'));

-- Configuración de respaldos automáticos (fila única). La frase de cifrado se
-- guarda cifrada con APP_ENCRYPTION_KEY (internal/crypto), nunca en claro:
-- sin ella el planificador no podría cifrar las copias automáticas.
CREATE TABLE backup_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_days INT NOT NULL DEFAULT 1 CHECK (interval_days BETWEEN 1 AND 365),
  run_at TIME NOT NULL DEFAULT '03:00',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  retention_days INT NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  destination_type TEXT NOT NULL DEFAULT 'local' CHECK (destination_type IN ('local', 'smb', 'nfs')),
  destination_path TEXT,                          -- Obligatorio para smb/nfs: carpeta ya montada en el servidor
  passphrase_encrypted TEXT,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_status IN ('idle', 'running', 'success', 'failed')),
  last_message TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO backup_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

INSERT INTO system_features (code, name, description) VALUES
  ('allow_purge', 'Permitir purga', 'Muestra "Purgar base de datos" en Respaldos. Solo para ambientes de prueba: borra todos los datos y deja el sistema como recién instalado.')
ON CONFLICT (code) DO NOTHING;
