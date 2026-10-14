-- Inventario (spec/16 §4.2, 9.2, diseño aprobado 2026-10-14).
--
-- Tipos de equipo con sus campos (los define el admin). `base_type` es el
-- asset_type de siempre, que sigue usando Escalamiento.
CREATE TABLE asset_kinds (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'category',
  base_type asset_type NOT NULL DEFAULT 'device',
  -- [{key, label, kind: text|number|list|date, options: [..]}], en orden.
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO asset_kinds (code, name, icon, base_type, sort_order, fields) VALUES
('server', 'Servidor', 'dns', 'device', 10, '[{"key":"os","label":"Sistema operativo","kind":"text"},{"key":"os_version","label":"Versión","kind":"text"},{"key":"cpu","label":"CPU","kind":"text"},{"key":"ram_gb","label":"RAM (GB)","kind":"number"},{"key":"disk","label":"Disco","kind":"text"},{"key":"virtualization","label":"Virtualización","kind":"list","options":["Físico","VMware","Hyper-V","Proxmox","Nube"]}]'),
('computer', 'Computador', 'computer', 'device', 20, '[{"key":"os","label":"Sistema operativo","kind":"text"},{"key":"os_version","label":"Versión","kind":"text"},{"key":"cpu","label":"CPU","kind":"text"},{"key":"ram_gb","label":"RAM (GB)","kind":"number"},{"key":"disk","label":"Disco","kind":"text"}]'),
('network', 'Red', 'router', 'device', 30, '[{"key":"equipment","label":"Equipo","kind":"list","options":["Switch","Router","Firewall","Access point","Balanceador","Otro"]},{"key":"os","label":"Sistema (IOS / firmware)","kind":"text"},{"key":"os_version","label":"Versión","kind":"text"},{"key":"ports","label":"Puertos","kind":"text"},{"key":"poe","label":"PoE","kind":"list","options":["No","PoE","PoE+","PoE++"]},{"key":"role","label":"Rol","kind":"list","options":["Core","Distribución","Acceso","Borde"]},{"key":"stack","label":"Stack","kind":"text"},{"key":"mgmt_vlan","label":"VLAN de gestión","kind":"text"}]'),
('device', 'Dispositivo', 'memory', 'device', 40, '[{"key":"equipment","label":"Equipo","kind":"text"},{"key":"os","label":"Sistema (IOS / firmware)","kind":"text"},{"key":"os_version","label":"Versión","kind":"text"},{"key":"ports","label":"Puertos","kind":"text"},{"key":"role","label":"Rol","kind":"text"}]'),
('link', 'Enlace', 'settings_ethernet', 'link', 50, '[{"key":"carrier","label":"Proveedor","kind":"text"},{"key":"bandwidth","label":"Ancho de banda","kind":"text"},{"key":"service_id","label":"ID de servicio","kind":"text"},{"key":"media","label":"Medio","kind":"list","options":["Fibra","Cobre","Radio","Satelital","Celular"]}]'),
('circuit', 'Circuito', 'cable', 'circuit', 60, '[{"key":"carrier","label":"Proveedor","kind":"text"},{"key":"bandwidth","label":"Ancho de banda","kind":"text"},{"key":"service_id","label":"ID de circuito","kind":"text"}]'),
('site', 'Sitio', 'apartment', 'site', 70, '[{"key":"power_backup","label":"Respaldo de energía","kind":"text"}]'),
('other', 'Otro', 'category', 'device', 80, '[{"key":"description","label":"Descripción","kind":"text"}]');

-- De qué se encarga cada responsable (lista que el admin amplía).
CREATE TABLE responsibility_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO responsibility_types (code, name, sort_order) VALUES
('config', 'Configuración y sistema', 10),
('hardware', 'Hardware', 20),
('power', 'Energía y conectividad', 30),
('user', 'Usuario', 40),
('field', 'Mantención en terreno', 50);

-- Los equipos: área dueña, tipo, campos comunes y los del tipo. La localidad
-- pasa a ser opcional (un notebook no siempre tiene una). Los de hoy son del NOC.
ALTER TABLE assets
  ALTER COLUMN territorial_unit_id DROP NOT NULL,
  ADD COLUMN area_id UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000002' REFERENCES areas(id) ON DELETE RESTRICT,
  ADD COLUMN kind_code TEXT REFERENCES asset_kinds(code) ON UPDATE CASCADE,
  ADD COLUMN model TEXT,
  ADD COLUMN serial TEXT,
  ADD COLUMN rack TEXT,
  ADD COLUMN rack_position TEXT,
  ADD COLUMN attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE assets SET kind_code = type::text;
CREATE INDEX idx_assets_area ON assets(area_id);

-- Varias IP por equipo, cada una con su tipo (red, VIP, administración…).
CREATE TABLE asset_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('network', 'vip', 'management', 'other')),
  address INET NOT NULL,
  note TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_asset_ips_asset ON asset_ips(asset_id, sort_order);
CREATE INDEX idx_asset_ips_address ON asset_ips(address);
INSERT INTO asset_ips (asset_id, kind, address) SELECT id, 'network', ip_address FROM assets WHERE ip_address IS NOT NULL;

-- Responsables: un área, una persona o una organización externa, con de qué se encarga.
CREATE TABLE asset_responsibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type_code TEXT NOT NULL REFERENCES responsibility_types(code) ON UPDATE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_asset_responsible_one CHECK ((area_id IS NOT NULL)::int + (user_id IS NOT NULL)::int + (organization_id IS NOT NULL)::int = 1)
);
CREATE INDEX idx_asset_responsibles_asset ON asset_responsibles(asset_id, sort_order);
CREATE INDEX idx_asset_responsibles_area ON asset_responsibles(area_id) WHERE area_id IS NOT NULL;

-- Historial de cada equipo: altas, cambios de ficha, trabajos, tickets, cargas.
CREATE TABLE asset_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'edited', 'work', 'ticket', 'import', 'deactivated', 'reactivated')),
  description TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_events_asset ON asset_events(asset_id, happened_at DESC);
INSERT INTO asset_events (asset_id, kind, description) SELECT id, 'created', 'Equipo existente antes del inventario.' FROM assets;

-- Solicitudes de desactivar o borrar: las decide el admin o la jefatura del área dueña.
CREATE TABLE asset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('deactivate', 'delete')),
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_requests_pending ON asset_requests(asset_id) WHERE status = 'pending';
