-- ============================================================================
-- BitacoraSOC — Esquema PostgreSQL del núcleo obligatorio
-- Ver spec/02-alcance-y-roadmap.md sección 1 para qué queda dentro/fuera de
-- este alcance, y spec/01-arquitectura.md para el razonamiento de diseño.
--
-- `escalation_policies` usa tres columnas FK nullable con constraint
-- "exactamente una no-nula" en vez de un patrón polimórfico scope_type/scope_id,
-- para mantener integridad referencial real de Postgres en vez de validarlo
-- solo en la aplicación. Mismo patrón en team_members (user_id/contact_id).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS ltree;     -- territorial_units.path

-- ===== AUTH =====
CREATE TYPE user_role AS ENUM ('admin','user','auditor','guest');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  -- Nunca texto plano (spec/10-armonizacion.md, pregunta directa del dueño).
  -- bcrypt (golang.org/x/crypto/bcrypt), costo 12 para hashes nuevos — ver
  -- 07-backend-arquitectura-go.md sección 6.5 para el razonamiento completo
  -- (por qué bcrypt y no Argon2id, migración directa de los hashes legacy
  -- costo 8 sin resetear contraseñas, y re-hash oportunista en login).
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  cargo_label TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_encrypted TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  guest_expires_at TIMESTAMPTZ,
  -- spec/10-armonizacion.md (barrido de gaps): el legacy bloquea todo endpoint
  -- salvo perfil-propio/logout mientras este flag esté en true (código
  -- `FORCE_SETUP_REQUIRED`) — se usa tanto para cuentas nuevas creadas por
  -- admin con contraseña temporal como para `POST /api/users/force-reset-all`
  -- (ver `04-contratos-api.md`). No estaba en el núcleo nuevo.
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role) WHERE active;

-- spec/10-armonizacion.md (barrido de gaps): `failed_login_attempts`/`locked_until`
-- de arriba son bloqueo POR CUENTA (un usuario específico) — el legacy además
-- tiene un rate limit POR IP en `POST /api/auth/login` (5 intentos/15min,
-- `rate-limiter.js`), un control complementario y distinto: sin él, un
-- atacante puede probar contraseñas contra MUCHOS usuarios distintos desde la
-- misma IP sin disparar el bloqueo de ninguna cuenta individual (user
-- enumeration / password spraying). Se modela en Postgres (no en memoria del
-- proceso Go) específicamente para que el límite sea correcto en el clúster
-- HA de 2 nodos (`09-alta-disponibilidad-2-nodos.md`) — un atacante
-- alternando de nodo no debe poder duplicar su cupo de intentos. Volumen bajo
-- (solo intentos de login), así que el costo de una consulta a Postgres por
-- intento es insignificante.
CREATE TABLE login_rate_limits (
  ip_address TEXT PRIMARY KEY,
  attempt_count INT NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token_denylist (
  jti UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_token_denylist_expires ON token_denylist(expires_at);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Grupos de permisos atomizados (spec/10-armonizacion.md punto 1).
--
-- Reemplaza el patrón ad-hoc del legacy (`backend/src/routes/directory.js`:
-- `EDIT_ONLY_CARGOS`/`FULL_DIRECTORY_CARGOS`, dos Set() de strings de
-- `cargoLabel` normalizados a mano, comparados con texto libre y hardcodeados
-- en el código — un typo en el cargo de un usuario rompe el permiso en
-- silencio, y no hay forma de gobernarlo desde la GUI). No reemplaza `role`
-- (admin/user/auditor/guest seguirá gobernando privilegios de administración
-- del sistema) — es una capa adicional para acotar en qué módulo (SOC/NOC) y
-- con qué capacidades opera un usuario `role='user'`. Un usuario puede estar
-- en varios grupos a la vez (ej. "N1" + "CSM"); sus capacidades y su alcance
-- de módulo son la UNIÓN de todos sus grupos. `admin` siempre tiene todo,
-- sin pasar por grupos (mismo atajo que `isAdmin(req)` en el legacy).
-- El alcance de módulo de un grupo se cruza con `app_config.soc_module_enabled`/
-- `noc_module_enabled`: un grupo puede autorizar 'noc', pero si la instancia
-- nunca activó el módulo NOC, sigue sin aplicar (dos gates independientes).
-- -----------------------------------------------------------------------------
CREATE TYPE permission_group_module_scope AS ENUM ('soc', 'noc', 'both', 'none');

CREATE TABLE permission_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,           -- Ej: 'n1', 'n2', 'csm', 'jefe_area'
  name TEXT NOT NULL,                  -- Ej: 'Analista N1'
  module_scope permission_group_module_scope NOT NULL DEFAULT 'both',
  capabilities TEXT[] NOT NULL DEFAULT '{}', -- Ej: '{directory:write, directory:delete, tickets:assign}'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_permission_groups (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_group_id UUID NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, permission_group_id)
);
CREATE INDEX idx_user_permission_groups_group ON user_permission_groups(permission_group_id);

-- ===== TERRITORIO / ORGANIZACIONES / ACTIVOS =====
-- spec/10-armonizacion.md: estos 4 valores son niveles ESTRUCTURALES genéricos
-- (profundidad en el árbol ltree), no terminología chilena hardcodeada — el
-- sistema no asume "región"/"comuna" en ningún punto del código ni del DDL.
-- Lo que SÍ es específico de cada país es cómo se LLAMA cada nivel ("Región"
-- en Chile, "Departamento" en Colombia/Perú, "Estado" en México/Brasil,
-- "Provincia" en Argentina/España) — eso se configura en
-- `app_config.territorial_kind_labels` (ver abajo), nunca en un ENUM ni en
-- código Go. Los DATOS (qué regiones/comunas/ciudades existen) tampoco se
-- hardcodean: se cargan vía `POST /api/territorial-units/import` (JSON
-- anidado, no CSV — es un árbol, no una lista plana; ver `04-contratos-api.md`
-- y la nota de armonización en `01-arquitectura.md` sección 4), incluido el
-- seed de Chile.
CREATE TYPE territorial_kind AS ENUM ('country','region','zone','site');

CREATE TABLE territorial_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES territorial_units(id),
  kind territorial_kind NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  path LTREE NOT NULL,
  address TEXT,                     -- spec/10-armonizacion.md: preparar el terreno para mapas (OpenStreetMap/Leaflet) a futuro. Tiene sentido sobre todo en kind='site' (una región/zona no tiene una única dirección); no se restringe por CHECK porque cargar una dirección aproximada en una zona tampoco es un error de negocio real.
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_territorial_units_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_territorial_units_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_territorial_units_path ON territorial_units USING GIST (path);

-- Organizaciones unificadas: clientes finales, empresas contratistas/terciarias,
-- carriers de enlace y nuestra propia operación interna.
CREATE TYPE organization_type AS ENUM ('client', 'contractor', 'carrier', 'internal');

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  type organization_type NOT NULL DEFAULT 'client',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_organizations_type ON organizations(type) WHERE active;

-- Vista o alias para mantener compatibilidad semántica con 'clients' del núcleo
CREATE VIEW clients AS
  SELECT id, name, code, active, created_at
  FROM organizations
  WHERE type = 'client';

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(organization_id, name)
);

-- -----------------------------------------------------------------------------
-- Fuentes de logs y orígenes tecnológicos de telemetría (desacoplado de clientes)
-- -----------------------------------------------------------------------------
CREATE TABLE catalog_log_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,          -- Ej: 'fortinet_firewall', 'crowdstrike_edr', 'cisco_switch'
  display_name TEXT NOT NULL,         -- Ej: 'Firewall Perimetral Fortinet'
  category TEXT NOT NULL,             -- 'network', 'endpoint', 'identity', 'cloud'
  default_parser TEXT,                -- Parser o normalizador asociado
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalog_log_sources_cat ON catalog_log_sources(category) WHERE active;

-- =============================================================================
-- FASE 8 (DIFERIDO) — auditoría de alcance: ingesta Zabbix/webhook, "Tormenta de
-- Enlaces" y el dashboard /metrics se movieron al Backlog Post-Corte (ver 08-fase6-modulos-
-- diferidos.md sección "Integraciones"/"Reportes"). No se borran estas tablas
-- (otra sesión puede estar trabajando sobre ellas), solo se marcan como fuera
-- del corte inicial -- no construir en núcleo hasta que se retomen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plantillas de mensajes para redacción rápida asistida (Zabbix -> Cajón Bitácora)
-- -----------------------------------------------------------------------------
CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                  -- Ej: 'Notificación Inicial Caída Enlace BGP'
  category TEXT NOT NULL,              -- 'incident_start', 'incident_update', 'incident_resolved'
  title_template TEXT NOT NULL,        -- Ej: '[ALERTA] Corte en {{.AssetName}} (Circuito: {{.CircuitId}})'
  body_template TEXT NOT NULL,         -- Markdown: 'Estimados,\nSe detecta corte en {{.AssetName}}...'
  suggested_severity TEXT NOT NULL DEFAULT 'critical',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Reglas de integración y alertas en pantalla (Zabbix / Webhooks Inbound)
-- -----------------------------------------------------------------------------
CREATE TABLE alert_ingestion_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,           -- 'zabbix', 'generic_webhook', 'prometheus'
  name TEXT NOT NULL,                  -- 'Zabbix - Caída Enlace Troncal'
  match_severity TEXT,                 -- 'Disaster', 'High', 'critical'
  match_host_pattern TEXT,             -- Regex o wildcard para hostname de Zabbix
  template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  play_sound BOOLEAN NOT NULL DEFAULT true,
  toast_priority TEXT NOT NULL DEFAULT 'high', -- 'normal', 'high', 'urgent'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- BANDERAS DE CARACTERÍSTICAS GOBERNADAS DESDE LA GUI WEB (Cero .env)
-- =============================================================================
CREATE TABLE system_features (
  code TEXT PRIMARY KEY,               -- 'native_tickets', 'zabbix_inbound', 'glpi_sync'
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  config_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE itil_impact AS ENUM ('low', 'medium', 'high');
CREATE TYPE itil_urgency AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE itil_priority AS ENUM ('p1_critical', 'p2_high', 'p3_medium', 'p4_low');
CREATE TYPE ticket_status AS ENUM ('new', 'assigned', 'in_progress', 'pending_vendor', 'resolved', 'closed', 'cancelled');
CREATE TYPE ticket_type AS ENUM ('incident', 'service_request'); -- Distinción ITIL entre Incidente y Requerimiento
-- entry_scope se define acá (adelantado desde la sección BITÁCORA más abajo,
-- su lugar temático natural) porque tickets.scope ya lo necesita en esta
-- misma tabla — un CREATE TABLE no puede usar un tipo que todavía no existe.
-- Se reutiliza tal cual en entries/system_events/scheduled_alerts más abajo.
CREATE TYPE entry_scope AS ENUM ('soc','noc','general');

-- Investigación de buenas prácticas ITIL (spec/10-armonizacion.md punto 3), aplicadas
-- de forma acotada al dominio real (carrier/contrata es el cuello de botella típico
-- del NOC, no un caso de borde):
--   - SLA con pausa: al pasar a 'pending_vendor', el backend fija `sla_on_hold_since`;
--     al salir de ese estado, acumula el tiempo transcurrido en `sla_paused_seconds` y
--     limpia `sla_on_hold_since`. El vencimiento real de SLA = due_at + paused_seconds
--     acumulado — la espera de un tercero no debe contar como incumplimiento del equipo.
--   - Reapertura con ventana: si llega una nueva entrada de bitácora o comentario de
--     cliente sobre un ticket 'resolved' dentro de una ventana corta (ver
--     `app_config`, valor por definir en la Fase 10 del roadmap — legacy no tenía este concepto,
--     es una mejora nueva), se reabre (`reopened_count++`, vuelve a `in_progress`)
--     en vez de forzar un ticket duplicado.
--   - Deliberadamente NO se incorpora ahora: Problem Management (agrupar incidentes
--     recurrentes bajo un registro de causa raíz) ni encuesta CSAT post-cierre —
--     quedan como candidatos de Backlog Post-Corte (ver `08-fase6-modulos-diferidos.md`), no hay
--     evidencia de que el equipo chico los necesite para el corte inicial.
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE, -- Ej: 'TKT-2026-00042'
  ticket_type ticket_type NOT NULL DEFAULT 'incident', -- Incidente (SLA rápido) vs Requerimiento (Planificado)
  scope entry_scope NOT NULL DEFAULT 'general',        -- 'soc', 'noc', 'general'
  client_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID,                      -- Se vincula a assets(id) más abajo (ALTER TABLE, la tabla se crea después)
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  assigned_team_id UUID,              -- Área resolutora (reutiliza teams única) — se vincula a teams(id) más abajo
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_contact_id UUID,           -- Se vincula a contacts(id) más abajo
  status ticket_status NOT NULL DEFAULT 'new',
  impact itil_impact NOT NULL DEFAULT 'medium',
  urgency itil_urgency NOT NULL DEFAULT 'medium',
  priority itil_priority NOT NULL DEFAULT 'p3_medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  sla_response_due_at TIMESTAMPTZ,
  sla_resolution_due_at TIMESTAMPTZ,
  sla_on_hold_since TIMESTAMPTZ,        -- No nulo mientras status='pending_vendor': pausa el reloj de SLA (espera de contrata/carrier no es responsabilidad del equipo)
  sla_paused_seconds INT NOT NULL DEFAULT 0, -- Acumulado de todas las pausas anteriores, se suma al calcular vencimiento real
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  reopened_count INT NOT NULL DEFAULT 0,  -- Buenas prácticas ITIL: reabrir dentro de la ventana en vez de duplicar el ticket
  reopened_at TIMESTAMPTZ,
  public_tracking_token TEXT UNIQUE,                 -- Token seguro para vista de solo lectura del cliente
  public_tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  public_tracking_pin TEXT,                          -- PIN opcional de 6 dígitos para protección reforzada
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_status ON tickets(status) WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX idx_tickets_type_status ON tickets(ticket_type, status);
CREATE INDEX idx_tickets_team ON tickets(assigned_team_id);
CREATE INDEX idx_tickets_client ON tickets(client_id);
CREATE INDEX idx_tickets_public_token ON tickets(public_tracking_token) WHERE public_tracking_enabled;

-- Comentarios e historial de seguimiento del ticket (con separación público vs interno)
CREATE TABLE ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,          -- true: visible para el cliente externo con token; false: nota interna
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_comments_ticket ON ticket_comments(ticket_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- Tareas del ticket con registro de tiempo trabajado (equivalente a "Tareas"/
-- ITILTask de GLPI: content + actiontime, ver historial de conversación).
-- Deliberadamente SEPARADA de `ticket_comments`: un comentario es comunicación
-- ("le avisé al cliente"), una tarea es trabajo real medido en tiempo ("probé
-- OTDR en terreno, 45 min") — GLPI ya modela esto como dos entidades distintas
-- (ITILFollowup vs ITILTask) y no hay razón para conflacionarlas acá.
-- Ni el legacy ni una versión anterior de esta spec tenían nada de esto — el
-- enriquecimiento GLPI (`GET /api/glpi/tickets/:id/enrichment`) solo trae
-- título/cliente/técnico/estado, nunca tareas ni tiempo invertido.
-- -----------------------------------------------------------------------------
CREATE TABLE ticket_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id), -- Quién ejecutó el trabajo (a diferencia de ticket_comments.user_id, nunca nulo: una tarea sin autor no tiene sentido)
  content TEXT NOT NULL,                      -- Markdown: qué se hizo (ver convención global de Markdown en 04-contratos-api.md)
  time_spent_seconds INT NOT NULL CHECK (time_spent_seconds > 0), -- Tiempo real invertido, no la ventana de SLA (esa ya vive en tickets.sla_*)
  is_public BOOLEAN NOT NULL DEFAULT false,   -- Mismo criterio que ticket_comments: el detalle de trabajo interno no se expone en /p/tickets/:token por defecto
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- Cuándo se hizo el trabajo (puede cargarse retroactivo, distinto de created_at)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_tasks_ticket ON ticket_tasks(ticket_id, performed_at ASC);
CREATE INDEX idx_ticket_tasks_user ON ticket_tasks(user_id, performed_at DESC); -- Soporta "cuánto tiempo registró cada analista" para métricas/carga de trabajo (Backlog Post-Corte)

CREATE TYPE asset_type AS ENUM ('circuit','link','site','device');

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type asset_type NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  ip_address INET,                                      -- spec/10-armonizacion.md: "tener la IP, el nombre y el responsable" — INET nativo de Postgres (valida formato, soporta IPv4/IPv6, indexable)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,           -- Catch-all extensible (serie, modelo, vendor, firmware...) — no se enumeran columnas rígidas para un inventario que todavía no se terminó de levantar; si un campo se vuelve de consulta/filtro frecuente, se promueve a columna propia después
  address TEXT,                                         -- Dirección física puntual del activo — opcional: si es NULL, la UI puede caer al `address`/lat/lng del `territorial_unit_id` (el sitio general) en vez de repetir el dato
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  territorial_unit_id UUID NOT NULL REFERENCES territorial_units(id),
  client_id UUID REFERENCES organizations(id),          -- Cliente dueño del circuito
  contractor_id UUID REFERENCES organizations(id),      -- Empresa contratista responsable
  log_source_id UUID REFERENCES catalog_log_sources(id),-- Tecnología o fuente de logs
  parent_asset_id UUID REFERENCES assets(id),
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_assets_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_assets_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_assets_territorial_unit ON assets(territorial_unit_id);
CREATE INDEX idx_assets_contractor ON assets(contractor_id) WHERE contractor_id IS NOT NULL;
CREATE INDEX idx_assets_log_source ON assets(log_source_id) WHERE log_source_id IS NOT NULL;
CREATE UNIQUE INDEX uq_assets_ip_address ON assets(ip_address) WHERE ip_address IS NOT NULL;

-- Nota de alcance (spec/10-armonizacion.md, pedido de "preparar esto para
-- usar OpenMaps/OpenStreetMap a futuro más fácilmente"): se guardan
-- coordenadas como NUMERIC simple, NO como tipo `geography`/`geometry` de
-- PostGIS. Alcanza y sobra para pintar pines en un mapa (Leaflet/OSM solo
-- pide {lat, lng} numéricos) sin sumar una extensión nueva de Postgres que
-- hoy nadie necesita (el DDL solo usa `pgcrypto` y `ltree`, ver cabecera de
-- este archivo) — si en algún momento se necesitan consultas espaciales
-- reales ("activos a 5 km de este punto"), ESE es el momento de evaluar
-- PostGIS, no antes (YAGNI, ver `06-frontend-arquitectura-y-ui.md` sección 7.3).

-- -----------------------------------------------------------------------------
-- Cobertura NO uniforme dentro de una misma localidad (spec/10-armonizacion.md
-- punto 1: "6 routers son de Calama pero no existe un técnico que vea los 6,
-- están repartidos entre 3 personas"). NO hace falta una tabla nueva: el
-- mecanismo ya existe en `escalation_policies` (definida más abajo en este
-- mismo archivo) al permitir el scope por `asset_id` además de por
-- `territorial_unit_id` — la
-- regla de precedencia (asset > territorial) se define y documenta en
-- `01-arquitectura.md` sección 4 punto 5 y en `04-contratos-api.md`
-- (`GET /api/escalation/resolve`), no en el DDL.
-- -----------------------------------------------------------------------------

-- Directorio centralizado único (reemplaza DirectoryContact, Contact y ExternalPerson).
-- Una persona pertenece a una organización (sea cliente, contratista o interno).
CREATE TYPE contact_scope AS ENUM ('internal', 'external');
CREATE TYPE contact_source AS ENUM ('manual', 'user_sync', 'csv_import');

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT,
  specialty TEXT, -- Especialidad técnica: 'Fibra Óptica', 'Radioenlace', 'Clima', 'Energía', 'Supervisor'
  scope contact_scope NOT NULL DEFAULT 'external',
  source contact_source NOT NULL DEFAULT 'manual',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  email_encrypted TEXT,
  email_hash TEXT,
  phone_encrypted TEXT,
  phone_hash TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_org ON contacts(organization_id);
CREATE INDEX idx_contacts_specialty ON contacts(specialty) WHERE specialty IS NOT NULL;
CREATE INDEX idx_contacts_favorites ON contacts(is_favorite) WHERE is_favorite AND active;
CREATE INDEX idx_contacts_email_hash ON contacts(email_hash);
CREATE INDEX idx_contacts_phone_hash ON contacts(phone_hash);

-- Canales de contacto explícitos (llamada/WhatsApp/SMS/correo/otro), varios por
-- persona, con uno marcado preferido. Reemplaza el supuesto implícito de "todo
-- es email" del modelo legacy (EscalationRule.recipientsTo/CC). El valor va
-- cifrado igual que email/phone en contacts si es un teléfono/correo real.
CREATE TYPE contact_channel_type AS ENUM ('call','whatsapp','sms','email','other');

CREATE TABLE contact_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel_type contact_channel_type NOT NULL,
  value_encrypted TEXT NOT NULL,     -- número o correo cifrado (AES-256-GCM, mismo patrón que contacts)
  label TEXT,                        -- ej. "WhatsApp Cuadrilla Calama", "Celular de Guardia 24/7"
  preferred BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_contact_channel_owner CHECK (
    (contact_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX idx_contact_channels_contact ON contact_channels(contact_id) WHERE active;
CREATE INDEX idx_contact_channels_user ON contact_channels(user_id) WHERE active;
-- A lo sumo un canal preferido activo por dueño:
CREATE UNIQUE INDEX uq_contact_channels_preferred_contact ON contact_channels(contact_id) WHERE preferred AND active AND contact_id IS NOT NULL;
CREATE UNIQUE INDEX uq_contact_channels_preferred_user ON contact_channels(user_id) WHERE preferred AND active AND user_id IS NOT NULL;

-- ===== NÚCLEO NOC/SOC: TEAMS Y ESCALACIÓN =====

-- Capa organizacional sobre teams (empresa -> grupo de equipos -> equipos -> contactos).
-- No participa en la resolución de escalation_steps (que sigue apuntando a teams
-- concretos) -- es taxonomía/filtrado, para no duplicar el motor de resolución.
CREATE TABLE team_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES organizations(id), -- 'clients' es una VIEW: no se puede hacer FK a una vista
  active BOOLEAN NOT NULL DEFAULT true
);

-- audience distingue las dos aristas de la escalación: 'internal' (N2 / otra
-- area de la empresa) vs 'client' (contacto del lado del cliente) -- se expone
-- directo en /resolve y /notify para que alguien nuevo no tenga que adivinar.
CREATE TYPE team_audience AS ENUM ('internal','client');

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id), -- Contrata o empresa a la que pertenece la cuadrilla/equipo
  team_group_id UUID REFERENCES team_groups(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'escalation',  -- escalation | oncall | raci | contractor_field | noc_internal
  audience team_audience NOT NULL DEFAULT 'internal',
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_teams_team_group ON teams(team_group_id);
CREATE INDEX idx_teams_audience ON teams(audience) WHERE active;

-- Vínculo diferido de tickets: assets/teams/contacts se definen recién acá,
-- así que las FK de tickets.asset_id/assigned_team_id/assigned_contact_id se
-- agregan por ALTER (mismo patrón ya usado abajo para work_shifts↔checklist_templates
-- y escalation_action_logs↔entries) en vez de moverlas en el archivo — tickets
-- queda junto al resto del bloque ITIL para lectura, sin importar el orden real
-- de ejecución de este script.
ALTER TABLE tickets
  ADD CONSTRAINT fk_tickets_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tickets_assigned_team FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tickets_assigned_contact FOREIGN KEY (assigned_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TYPE recipient_type AS ENUM ('to','cc');
CREATE TYPE team_role AS ENUM ('primary','backup','lead');

CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  contact_id UUID REFERENCES contacts(id),
  recipient_type recipient_type NOT NULL DEFAULT 'to',
  role_in_team team_role NOT NULL DEFAULT 'primary',
  priority INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_team_member_exactly_one CHECK (
    (user_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX idx_team_members_team ON team_members(team_id) WHERE active;

CREATE TABLE team_coverage (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  territorial_unit_id UUID NOT NULL REFERENCES territorial_units(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, territorial_unit_id)
);

CREATE TABLE escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id),
  asset_id UUID REFERENCES assets(id),
  territorial_unit_id UUID REFERENCES territorial_units(id),
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_escalation_policy_one_scope CHECK (
    (service_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int + (territorial_unit_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX uq_escalation_policy_service ON escalation_policies(service_id) WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX uq_escalation_policy_asset ON escalation_policies(asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX uq_escalation_policy_territorial ON escalation_policies(territorial_unit_id) WHERE territorial_unit_id IS NOT NULL;

CREATE TYPE escalation_mode AS ENUM ('unique','pool','sequential');

CREATE TABLE escalation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  team_id UUID NOT NULL REFERENCES teams(id),
  mode escalation_mode NOT NULL DEFAULT 'unique',
  wait_before_escalate_minutes INT NOT NULL DEFAULT 0,
  UNIQUE(policy_id, step_order)
);

-- Trazabilidad inmutable de intentos de escalamiento: escudo del operador ante
-- incidentes donde la contrata o técnico no responde.
CREATE TYPE contact_attempt_result AS ENUM ('answered','no_answer','busy','unreachable','escalated_next_tier');

CREATE TABLE escalation_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID,                                     -- Se vincula a entries(id) una vez creada la tabla
  policy_id UUID REFERENCES escalation_policies(id),
  step_order INT NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  channel_type contact_channel_type NOT NULL,
  result contact_attempt_result NOT NULL,
  notes TEXT,                                        -- Comentarios del intento: "Sin tono, se escala a supervisor"
  operator_id UUID NOT NULL REFERENCES users(id),    -- Analista que ejecutó la acción
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()      -- Timestamp inmutable
);
CREATE INDEX idx_escalation_action_logs_created ON escalation_action_logs(created_at DESC);

-- Toma la idea de fondo de ClientEscalationRule (legacy: ventana con
-- blocking/no-blocking, precedencia por tipo -- ver clientAlertController.js),
-- pero NO es el mismo mecanismo: ClientEscalationRule es pull (se consulta al
-- generar un reporte, el usuario "acusa recibo" en readBy) y no bloquea ningún
-- envío automático porque ese envío no existe en el legacy. maintenance_windows
-- es el gate real de PRE-envío para POST /api/escalation/notify, que sí es
-- nuevo: si hay una ventana activa con suppress_notifications=true para el
-- scope del incidente, no se despacha; si es false, se anota en el cuerpo del
-- aviso. No incluye toda la UI de administración de ventanas recurrentes del
-- legacy (recurrencia semanal, feriados, canales) -- eso sigue diferido al Backlog Post-Corte.
CREATE TABLE maintenance_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id),
  asset_id UUID REFERENCES assets(id),
  territorial_unit_id UUID REFERENCES territorial_units(id),
  title TEXT NOT NULL,
  notes TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  suppress_notifications BOOLEAN NOT NULL DEFAULT false,
  priority INT NOT NULL DEFAULT 100, -- Desempate si dos ventanas activas aplican al mismo scope (idea del legacy ClientEscalationRule.priority, ver 08-fase6-modulos-diferidos.md); columna barata hoy para no migrar en caliente cuando llegue la recurrencia del Backlog Post-Corte
  created_by UUID NOT NULL REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_maintenance_window_one_scope CHECK (
    (service_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int + (territorial_unit_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT chk_maintenance_window_dates CHECK (ends_at > starts_at)
);
CREATE INDEX idx_maintenance_windows_service ON maintenance_windows(service_id, starts_at, ends_at) WHERE active;
CREATE INDEX idx_maintenance_windows_asset ON maintenance_windows(asset_id, starts_at, ends_at) WHERE active;
CREATE INDEX idx_maintenance_windows_territorial ON maintenance_windows(territorial_unit_id, starts_at, ends_at) WHERE active;

-- raci_assignments: dato desde la Fase 7 del roadmap (Motor de Escalación), sin UI de edición propia hasta el Backlog Post-Corte
CREATE TYPE raci_role AS ENUM ('responsible','accountable','consulted','informed');

CREATE TABLE raci_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES organizations(id), -- 'clients' es una VIEW: no se puede hacer FK a una vista
  service_id UUID REFERENCES services(id),
  asset_id UUID REFERENCES assets(id),
  topic TEXT NOT NULL,
  role raci_role NOT NULL,
  team_id UUID NOT NULL REFERENCES teams(id),
  active BOOLEAN NOT NULL DEFAULT true
);

-- ===== TURNOS UNIFICADOS =====
CREATE TABLE rotation_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  start_day_of_week INT NOT NULL,
  start_time_utc TIME NOT NULL,
  duration_days INT NOT NULL DEFAULT 7,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE rotation_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES rotation_cycles(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES team_members(id),
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  paused_reason TEXT
);
CREATE INDEX idx_rotation_slots_window ON rotation_slots(week_start_date, week_end_date);

CREATE TABLE rotation_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES rotation_cycles(id),
  original_team_member_id UUID REFERENCES team_members(id),
  replacement_team_member_id UUID NOT NULL REFERENCES team_members(id),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rotation_overrides_window ON rotation_overrides(start_date, end_date);

CREATE TABLE work_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_cycle_id UUID REFERENCES rotation_cycles(id),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  shift_type TEXT NOT NULL DEFAULT 'regular',
  checklist_template_start_id UUID,
  checklist_template_end_id UUID,
  email_recipients TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true
);

-- ===== CHECKLISTS =====
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_shifts
  ADD CONSTRAINT fk_work_shifts_checklist_start FOREIGN KEY (checklist_template_start_id) REFERENCES checklist_templates(id),
  ADD CONSTRAINT fk_work_shifts_checklist_end FOREIGN KEY (checklist_template_end_id) REFERENCES checklist_templates(id);

CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  parent_item_id UUID REFERENCES checklist_items(id),
  title TEXT NOT NULL,
  item_order INT NOT NULL DEFAULT 0
);

CREATE TYPE checklist_check_type AS ENUM ('inicio','cierre');
CREATE TYPE checklist_status AS ENUM ('verde','rojo');

CREATE TABLE shift_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_template_id UUID NOT NULL REFERENCES checklist_templates(id),
  user_id UUID NOT NULL REFERENCES users(id),
  work_shift_id UUID NOT NULL REFERENCES work_shifts(id),
  check_type checklist_check_type NOT NULL,
  check_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  has_red_services BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_shift_checks_shift_date ON shift_checks(work_shift_id, check_date DESC);

-- Mejoras sobre el legacy investigadas en frontend/checklist.component.ts y
-- backend/utils/shift-report.js (spec: "mejoremos los checklist de inicio y
-- fin de turno"), no inventadas desde cero:
--   - `checklist_item_id`: el legacy solo guardaba `serviceTitle` como texto
--     suelto, sin FK a la plantilla — imposible cruzar "cuántas veces este
--     ítem exacto ha estado en rojo este mes" de forma confiable (solo por
--     coincidencia de texto). Se agrega la referencia real.
--   - `is_computed`: el legacy calcula en el frontend (`getAggregateStatus`,
--     regla "peor estado gana": si algún hijo es rojo, el padre es rojo; si
--     falta algún hijo, el padre queda pendiente) el estado de los ítems con
--     sub-items y limpia su observación — pero nunca persiste CUÁL estado fue
--     calculado vs. cuál fue tipeado a mano por el analista. Se guarda para
--     que el historial y el PDF puedan distinguirlos igual que la UI en vivo.
--   - `correlated_from_service_id`: el legacy correlaciona (`correlateBackendServices`,
--     por coincidencia de palabras clave) un ítem rojo sin observación con la
--     observación de otro ítem rojo del mismo check, pero SOLO al renderizar
--     el reporte de turno por correo — nunca se guarda, así que la bitácora y
--     el historial en pantalla no se benefician, solo el correo. Se persiste
--     al enviar el check para que toda vista (detalle, historial, PDF, correo)
--     lo muestre igual. No reemplaza la observación propia del ítem líder
--     (ver CHECK abajo) — es una sugerencia/vínculo adicional, no un atajo
--     para saltarse la explicación en items hoja.
CREATE TABLE shift_check_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_check_id UUID NOT NULL REFERENCES shift_checks(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES checklist_items(id) ON DELETE SET NULL,
  service_title TEXT NOT NULL,
  status checklist_status NOT NULL,
  is_computed BOOLEAN NOT NULL DEFAULT false, -- true = estado derivado de sub-items (regla "peor estado gana"), no tipeado por el analista
  observation TEXT,
  correlated_from_service_id UUID REFERENCES shift_check_services(id),
  CONSTRAINT chk_red_requires_observation CHECK (is_computed OR status <> 'rojo' OR observation IS NOT NULL)
);
CREATE INDEX idx_shift_check_services_item ON shift_check_services(checklist_item_id) WHERE checklist_item_id IS NOT NULL;

-- ===== BITÁCORA =====
CREATE TYPE entry_type AS ENUM ('operativa','incidente','ofensa','checklist');
-- entry_scope: definido más arriba, antes de `tickets` (primer tipo que lo necesita).

CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  entry_type entry_type NOT NULL,
  scope entry_scope NOT NULL DEFAULT 'general', -- Distinción de ámbito operativa: SOC, NOC o General
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  service_id UUID REFERENCES services(id),
  asset_id UUID REFERENCES assets(id),
  work_shift_id UUID REFERENCES work_shifts(id),
  glpi_ticket_id TEXT,
  glpi_linked_at TIMESTAMPTZ,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL, -- Enlace opcional a Ticketera Nativa ITIL
  image_url TEXT,                     -- Máximo 1 imagen por entrada (optimizada en WebP)
  image_hash TEXT,                    -- SHA-256 de la imagen para integridad
  image_size_bytes INT,               -- Tamaño optimizado (máx 2MB)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entries_created ON entries(created_at DESC);
CREATE INDEX idx_entries_scope ON entries(scope, created_at DESC);
CREATE INDEX idx_entries_tags ON entries USING GIN(tags);
CREATE INDEX idx_entries_fulltext ON entries USING GIN(to_tsvector('spanish', content));
CREATE INDEX idx_entries_glpi ON entries(glpi_ticket_id) WHERE glpi_ticket_id IS NOT NULL;
CREATE INDEX idx_entries_ticket ON entries(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_entries_has_image ON entries(created_at) WHERE image_url IS NOT NULL;

-- Enlazar auditoría de escalamiento con la entrada de bitácora
ALTER TABLE escalation_action_logs
  ADD CONSTRAINT fk_escalation_action_logs_entry FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL;

-- Comentarios cronológicos dentro de una entrada de bitácora (seguimiento de incidentes)
CREATE TABLE entry_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  is_system_generated BOOLEAN NOT NULL DEFAULT false, -- true si se generó por salto de escalación automática
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entry_comments_entry ON entry_comments(entry_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- Adjuntos y evidencias de bitácora almacenados en BD para replicación continua HA
-- -----------------------------------------------------------------------------
CREATE TABLE entry_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  file_data BYTEA NOT NULL,
  hash_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_attachment_size CHECK (size_bytes <= 5242880) -- Máx 5 MB por archivo
);
CREATE INDEX idx_entry_attachments_entry ON entry_attachments(entry_id);

-- -----------------------------------------------------------------------------
-- Registro ordenado de eventos del sistema (Buffer SSE con soporte Last-Event-ID)
-- -----------------------------------------------------------------------------
CREATE TABLE system_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,                             -- 'entry_created', 'escalation_action', etc.
  scope entry_scope NOT NULL DEFAULT 'general',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_events_created ON system_events(created_at DESC);


-- ===== GESTIÓN DE DOTACIÓN Y TELETRABAJO (NOC/SOC) =====
-- Resuelve la matriz semanal Lun-Vie de personal y ausencias
CREATE TYPE telework_condition AS ENUM (
  'telework',
  'office',
  'guardia',
  'vacation',
  'medical_leave',
  'medical_appointment',
  'training'
);

CREATE TABLE work_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_date DATE NOT NULL,
  condition telework_condition NOT NULL DEFAULT 'office',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, assigned_date)
);
CREATE INDEX idx_work_shift_assignments_date ON work_shift_assignments(assigned_date);

-- Enlaces públicos de solo lectura con token criptográfico (Pantalla/TV de sala NOC sin login)
CREATE TABLE public_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,                           -- ej. 'telework'
  token_hash TEXT NOT NULL UNIQUE,              -- SHA-256 del token para consulta segura
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);
CREATE INDEX idx_public_share_links_lookup ON public_share_links(token_hash) WHERE is_active;

-- spec/10-armonizacion.md (barrido de gaps): resumen periódico por correo de
-- la matriz de dotación/teletrabajo (`ShiftNotificationSchedule` legacy, ej.
-- "Reporte de Guardia" semanal a RRHH) — distinto de `scheduled_alerts`
-- (alertas EN PANTALLA con sonido, ya núcleo): esto es un envío de correo
-- periódico con lista de destinatarios/CC propia, no una alerta visual.
-- Dotación ya es núcleo (revertida desde el Backlog Post-Corte, ver `02-alcance-y-roadmap.md`),
-- así que este acompañante natural entra con ella.
CREATE TYPE notification_schedule_frequency AS ENUM ('weekly', 'monthly');

CREATE TABLE work_shift_notification_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- Ej: 'Reporte de Guardia RRHH'
  enabled BOOLEAN NOT NULL DEFAULT true,
  frequency notification_schedule_frequency NOT NULL DEFAULT 'weekly',
  day_of_week INT NOT NULL DEFAULT 1 CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo
  send_time TIME NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  role_filter TEXT[] NOT NULL DEFAULT '{}', -- Vacío = todos; ej. '{N1,N2}' para filtrar la matriz enviada
  recipients TEXT[] NOT NULL DEFAULT '{}',
  cc_recipients TEXT[] NOT NULL DEFAULT '{}',
  last_sent_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_work_shift_notification_schedules_enabled ON work_shift_notification_schedules(enabled, frequency, day_of_week);

-- ===== CIERRE FORMAL DE TURNO Y DESPACHO =====
CREATE TABLE shift_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  shift_start_at TIMESTAMPTZ NOT NULL,
  shift_end_at TIMESTAMPTZ NOT NULL,
  closure_check_id UUID NOT NULL REFERENCES shift_checks(id),
  total_entries INT NOT NULL DEFAULT 0,
  total_incidents INT NOT NULL DEFAULT 0,
  services_down TEXT[] NOT NULL DEFAULT '{}',
  observations TEXT,
  -- spec/10-armonizacion.md punto 4: en el legacy, "pendientes para el siguiente
  -- turno" es solo una convención de uso (docs/03_OPERACIONES.md paso 3.2) que el
  -- analista escribe, si se acuerda, en su Nota Personal — privada y desconectada
  -- del cierre formal, así que el turno entrante no la ve a menos que la busque.
  -- Se sube a campo de primera clase del cierre para que el analista entrante la
  -- vea siempre al hacer su checklist de inicio (ver 04-contratos-api.md).
  pending_for_next_shift TEXT,
  -- Buenas prácticas de shift-handover investigadas (spec: "mejoremos los
  -- checklist... algo en internet que pueda ayudar"): un handover confiable
  -- no es solo que el saliente entregue, es que el entrante confirme que lo
  -- vio ("incoming lead acknowledgment" en checklists de handover NOC de
  -- referencia) — mismo principio que ya usa `readBy[]`/`acknowledgementRequired`
  -- de `ClientEscalationRule.js` legacy para ventanas de mantenimiento
  -- (ver `08-fase6-modulos-diferidos.md`), aplicado acá al relevo de turno.
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  -- KPIs livianos de salida de turno (mismo checklist de referencia NOC:
  -- "outgoing shift KPIs" — total resuelto, incumplimientos de SLA). Versión
  -- mínima aquí; el desglose completo con tendencias es el dashboard
  -- `/metrics` del Backlog Post-Corte (ver `08-fase6-modulos-diferidos.md`), esto no lo
  -- reemplaza, solo evita que el cierre de turno quede ciego mientras tanto.
  tickets_resolved_count INT NOT NULL DEFAULT 0,
  sla_breaches_count INT NOT NULL DEFAULT 0,
  sent_via TEXT NOT NULL DEFAULT 'none',        -- 'email', 'glpi', 'api', 'webhook', 'none'
  integration_name TEXT,                        -- Qué integración concreta se usó si sent_via='api'/'webhook' (paridad con ShiftClosure.js legacy)
  sent_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'success', 'failed'
  sent_error TEXT,                              -- Motivo si sent_status='failed' (paridad con ShiftClosure.js legacy)
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shift_closures_user ON shift_closures(user_id, shift_end_at DESC);

-- ===== AUDITORÍA (append-only) =====
-- spec/10-armonizacion.md ("en legacy tengo módulos para saber literalmente
-- todo lo que hace el usuario... revisa si eso está en el spec"): el legacy
-- (`backend/src/utils/audit.js`) tiene ~118 eventos distintos de dominio
-- (`dominio.accion`, ver catálogo completo corriendo
-- `grep -rhoE "event: '[a-zA-Z_.]+'" backend/src` sobre el repo legacy) y un
-- helper único con más contexto del que el núcleo actual capturaba —
-- columnas agregadas para no perderlo al portar:
--   - `request_id`: correlaciona un registro de auditoría con logs/trazas de
--     ese mismo request.
--   - `user_agent`, `device_fingerprint`: el legacy ya los capturaba en cada
--     evento (huella de dispositivo, no solo IP).
--   - `ip_changed`/`previous_ip`: el legacy detecta cuando la IP de una
--     sesión activa cambia a mitad de camino (posible secuestro de sesión o
--     simplemente el analista cambió de red) y lo audita como `warn` sin
--     bloquear — ver `auth.js` legacy. No estaba en el núcleo nuevo.
--   - `source`/`source_id`: distingue eventos del núcleo (`'core'`) de
--     eventos originados por un complemento/plugin (Backlog Post-Corte) — columna barata
--     hoy para no migrar en caliente cuando el sistema de complementos exista.
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  event TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  actor_user_id UUID REFERENCES users(id),
  actor_username TEXT,
  actor_role TEXT,
  request_id TEXT,
  request_ip TEXT,
  request_path TEXT,
  request_method TEXT,
  user_agent TEXT,
  device_fingerprint TEXT,
  ip_changed BOOLEAN NOT NULL DEFAULT false,
  previous_ip TEXT,
  success BOOLEAN NOT NULL,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'core',
  source_id TEXT,
  metadata JSONB
);
CREATE INDEX idx_audit_timestamp_event ON audit_log("timestamp" DESC, event);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, "timestamp" DESC);
CREATE INDEX idx_audit_request_id ON audit_log(request_id) WHERE request_id IS NOT NULL;
-- Inmutabilidad: se aplica en el repositorio Go (sin método Update/Delete expuesto)
-- y se refuerza con un rol de DB de solo INSERT+SELECT sobre esta tabla.

-- ===== NOTAS OPERATIVAS (Paridad Legacy) =====
-- Nota global de difusión para toda la sala (broadcast)
CREATE TABLE admin_notes (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  content TEXT NOT NULL DEFAULT '',
  last_edited_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Libreta privada personal por usuario (1:1 con autosave cada 3s)
CREATE TABLE personal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_personal_notes_user ON personal_notes(user_id);

-- Generaliza el mismo patrón de autosave de personal_notes a cualquier
-- formulario largo (bitácora, ítem de checklist, nota de escalación) para que
-- un reinicio del contenedor `bitacora-app` o un despliegue no pierda trabajo
-- en curso. Ver 09-alta-disponibilidad-2-nodos.md sección 9.2.
-- `draft_key` es una clave libre generada por el cliente, NO una FK: el
-- recurso final (ej. la entrada de bitácora) puede no existir todavía en el
-- momento del autosave.
CREATE TABLE entry_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL,          -- 'entry', 'checklist_item', 'escalation_note'
  draft_key TEXT NOT NULL,          -- ej. 'new' o el id del recurso en edición
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE(user_id, form_type, draft_key)
);
CREATE INDEX idx_entry_drafts_user_expires ON entry_drafts(user_id, expires_at);

-- ===== ALERTAS Y RECORDATORIOS PROGRAMADOS DE SALA =====
CREATE TYPE scheduled_alert_type AS ENUM ('one_time', 'recurring');
CREATE TYPE scheduled_alert_target AS ENUM ('all', 'role', 'user', 'shift');

CREATE TABLE scheduled_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  alert_type scheduled_alert_type NOT NULL DEFAULT 'one_time',
  cron_expression TEXT,                -- Ej. '0 */2 * * *' (cada 2 horas) o '0 7 * * *' (a las 7 AM)
  scheduled_at TIMESTAMPTZ,            -- Para alertas puntuales de una sola vez
  target_type scheduled_alert_target NOT NULL DEFAULT 'shift',
  target_role TEXT,                    -- Ej. 'N1', 'N2', o NULL para todos
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope entry_scope NOT NULL DEFAULT 'general', -- 'soc', 'noc', 'general'
  severity TEXT NOT NULL DEFAULT 'warning',     -- 'info', 'warning', 'critical'
  sound_alert BOOLEAN NOT NULL DEFAULT true,   -- Notificación sonora en el navegador
  suggested_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL, -- Plantilla a precargar en bitácora
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scheduled_alerts_active ON scheduled_alerts(active, scheduled_at);
CREATE INDEX idx_scheduled_alerts_target ON scheduled_alerts(target_type, target_role, target_user_id) WHERE active;

-- ===== CONFIG (singleton) =====
CREATE TABLE app_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  shift_check_cooldown_hours INT NOT NULL DEFAULT 4,
  alert_nok_enabled BOOLEAN NOT NULL DEFAULT true,
  alert_nok_role_target TEXT[] NOT NULL DEFAULT '{N2}',
  audit_ttl_days INT NOT NULL DEFAULT 395,
  backup_retention_days INT NOT NULL DEFAULT 30,
  soc_module_enabled BOOLEAN NOT NULL DEFAULT false,
  noc_module_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Etiquetas de la jerarquía territorial, editables por el admin durante el
  -- setup NOC o después — así "region"/"zone" (los kind técnicos del ENUM
  -- territorial_kind) se muestran con el nombre real del país de la
  -- instalación, sin tocar código. Default razonable para Chile (mercado
  -- inicial del proyecto), reemplazable por cualquier país.
  territorial_kind_labels JSONB NOT NULL DEFAULT '{"country":"País","region":"Región","zone":"Zona","site":"Sitio"}'::jsonb,
  setup_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Regla de negocio (aplicada en el servicio, no como CHECK de DB): al completar
-- el setup inicial, al menos uno de soc_module_enabled/noc_module_enabled debe
-- quedar en true. Ver spec/01-arquitectura.md sección 5 y spec/05-historias-usuario.md HU-0.

CREATE TABLE smtp_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  host TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password_encrypted TEXT,
  from_address TEXT NOT NULL,
  require_tls BOOLEAN NOT NULL DEFAULT true
);

-- ===== BACKUPS (metadata; el archivo vive en disco comprimido con zstd nivel 19) =====
CREATE TYPE backup_kind AS ENUM ('full', 'delta');

CREATE TABLE backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind backup_kind NOT NULL DEFAULT 'full',
  window_from TIMESTAMPTZ,                           -- Inicio de ventana temporal (solo para delta)
  window_to TIMESTAMPTZ,                             -- Fin de ventana temporal (solo para delta)
  records_count INT NOT NULL DEFAULT 0,              -- Total de registros operacionales incluidos
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',            -- 'running', 'success', 'failed'
  file_path TEXT,
  file_size_bytes BIGINT,
  checksum_sha256 TEXT,                              -- Integridad SHA-256 para validación antes de ingesta
  compression_algorithm TEXT NOT NULL DEFAULT 'zstd-19',
  encrypted BOOLEAN NOT NULL DEFAULT true,
  triggered_by UUID REFERENCES users(id),
  error_message TEXT
);
CREATE INDEX idx_backup_runs_kind_started ON backup_runs(kind, started_at DESC);

