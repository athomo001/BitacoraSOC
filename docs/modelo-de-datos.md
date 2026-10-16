# Modelo de datos

> Generado por `backend-go/cmd/er-docs` desde `backend-go/sql/schema/0001_init_schema.sql`, el esquema que usa sqlc, con todas las migraciones aplicadas. **No se edita a mano**: si cambia el esquema, se regenera con `go run ./cmd/er-docs` desde `backend-go/`.

102 tablas en PostgreSQL, agrupadas en 15 dominios. Notación pata de gallo: `||` uno, `|o` / `o|` cero o uno, `o{` cero o muchos. La etiqueta de cada línea es la columna que hace la referencia.

- Cada entidad muestra todas sus columnas salvo `created_at` y `updated_at`. `PK` clave primaria, `FK` referencia a otra tabla, `UK` valor único.
- Las tablas de otros dominios aparecen como cajas sin columnas: son la misma tabla, dibujada donde se une.
- Las columnas de autoría que apuntan a `users` (`created_by`, `closed_by`…) se listan pero no se dibujan, para que los diagramas se puedan leer.
- Los tipos, restricciones e índices exactos están en el esquema.

Correspondencia con el legacy (MongoDB): [modelo-er-legacy-2.0.md](modelo-er-legacy-2.0.md).

## Índice

1. [Usuarios, acceso y permisos](#1-usuarios-acceso-y-permisos) — 9 tablas
2. [Territorio, organizaciones y activos](#2-territorio-organizaciones-y-activos) — 14 tablas
3. [Directorio de contactos](#3-directorio-de-contactos) — 2 tablas
4. [Ticketera](#4-ticketera) — 8 tablas
5. [Equipos y escalamiento](#5-equipos-y-escalamiento) — 14 tablas
6. [Turnos, guardias y dotación](#6-turnos-guardias-y-dotación) — 11 tablas
7. [Agenda](#7-agenda) — 8 tablas
8. [Notificaciones y avisos con acuse](#8-notificaciones-y-avisos-con-acuse) — 6 tablas
9. [Checklists](#9-checklists) — 4 tablas
10. [Bitácora](#10-bitácora) — 5 tablas
11. [Reportes y avisos por cliente](#11-reportes-y-avisos-por-cliente) — 5 tablas
12. [Auditoría, notas y alertas de sala](#12-auditoría-notas-y-alertas-de-sala) — 4 tablas
13. [Configuración y respaldos](#13-configuración-y-respaldos) — 6 tablas
14. [Complementos](#14-complementos) — 4 tablas
15. [Ingesta de alertas (después del corte)](#15-ingesta-de-alertas-después-del-corte) — 2 tablas

---

## 1. Usuarios, acceso y permisos

Cuentas, sesiones revocadas, llaves de API y los grupos de permisos que acotan qué módulos y capacidades tiene cada usuario.

```mermaid
erDiagram
    USERS {
        uuid id PK
        text username UK
        text email UK
        text full_name
        text phone
        date birthday
        text avatar_url
        text password_hash
        user_role role
        text cargo_label
        boolean mfa_enabled
        text mfa_secret_encrypted
        boolean is_guest
        timestamptz guest_expires_at
        boolean must_change_password
        int failed_login_attempts
        timestamptz locked_until
        text reset_password_token_hash
        timestamptz reset_password_expires_at
        boolean active
        timestamptz last_login_at
    }
    LOGIN_RATE_LIMITS {
        text ip_address PK
        int attempt_count
        timestamptz window_started_at
    }
    TOKEN_DENYLIST {
        uuid jti PK
        uuid user_id FK
        timestamptz expires_at
    }
    API_KEYS {
        uuid id PK
        text name
        text key_prefix UK
        text key_hash
        text[] scopes
        boolean active
        timestamptz last_used_at
        timestamptz expires_at
        uuid created_by FK
    }
    PERMISSION_GROUPS {
        uuid id PK
        text code UK
        text name
        text[] capabilities
        boolean active
        text profile
        uuid level_id FK
    }
    PERMISSION_GROUP_AREAS {
        uuid permission_group_id PK, FK
        uuid area_id PK, FK
    }
    AREAS {
        uuid id PK
        text code UK
        text name
        boolean active
        boolean is_system
        int sort_order
        text default_profile
        uuid ticket_series_id FK
    }
    LEVELS {
        uuid id PK
        text code UK
        text name
        int rank
        boolean active
    }
    USER_PERMISSION_GROUPS {
        uuid user_id PK, FK
        uuid permission_group_id PK, FK
        timestamptz assigned_at
        uuid assigned_by FK
    }

    AREAS ||--o{ PERMISSION_GROUP_AREAS : "area_id"
    LEVELS |o--o{ PERMISSION_GROUPS : "level_id"
    PERMISSION_GROUPS ||--o{ PERMISSION_GROUP_AREAS : "permission_group_id"
    PERMISSION_GROUPS ||--o{ USER_PERMISSION_GROUPS : "permission_group_id"
    TICKET_NUMBER_SERIES |o--o{ AREAS : "ticket_series_id"
    USERS ||--o{ TOKEN_DENYLIST : "user_id"
    USERS ||--o{ USER_PERMISSION_GROUPS : "user_id"
```

---

## 2. Territorio, organizaciones y activos

Árbol territorial genérico (país → región → zona → sitio), organizaciones con tipos configurables, sus servicios y los activos (el Inventario: tipos con sus campos, IP, responsables, historial y solicitudes de baja), más la importación desde GLPI (conexión, reglas y cada corrida).

```mermaid
erDiagram
    TERRITORIAL_UNITS {
        uuid id PK
        uuid parent_id FK
        territorial_kind kind
        text name
        text code UK
        ltree path
        text address
        numeric latitude
        numeric longitude
        boolean active
    }
    ORGANIZATION_TYPES {
        text code PK
        text name
        text description
        boolean is_client
        boolean system
        int sort_order
    }
    ORGANIZATIONS {
        uuid id PK
        text name
        text code UK
        text type FK
        boolean active
        uuid via_organization_id FK
        timestamptz archived_at
    }
    SERVICES {
        uuid id PK
        uuid organization_id FK
        text name
        text code UK
        boolean active
    }
    CATALOG_LOG_SOURCES {
        uuid id PK
        text code UK
        text display_name
        text category
        text default_parser
        boolean active
    }
    ASSETS {
        uuid id PK
        asset_type type
        text name
        text code UK
        inet ip_address
        jsonb metadata
        text address
        numeric latitude
        numeric longitude
        uuid territorial_unit_id FK
        uuid client_id FK
        uuid contractor_id FK
        uuid log_source_id FK
        uuid parent_asset_id FK
        boolean active
        uuid area_id FK
        text kind_code FK
        text model
        text serial
        text rack
        text rack_position
        jsonb attributes
        text glpi_itemtype
        int glpi_id
        timestamptz glpi_removed_at
    }
    ASSET_KINDS {
        text code PK
        text name
        text icon
        asset_type base_type
        jsonb fields
        int sort_order
        boolean active
    }
    RESPONSIBILITY_TYPES {
        text code PK
        text name
        int sort_order
        boolean active
    }
    ASSET_IPS {
        uuid id PK
        uuid asset_id FK
        text kind
        inet address
        text note
        int sort_order
    }
    ASSET_RESPONSIBLES {
        uuid id PK
        uuid asset_id FK
        text type_code FK
        uuid area_id FK
        uuid user_id FK
        uuid organization_id FK
        int sort_order
    }
    ASSET_EVENTS {
        uuid id PK
        uuid asset_id FK
        text kind
        text description
        timestamptz happened_at
        uuid user_id FK
        uuid ticket_id FK
    }
    ASSET_REQUESTS {
        uuid id PK
        uuid asset_id FK
        text action
        text reason
        uuid requested_by FK
        text status
        uuid decided_by FK
        timestamptz decided_at
        text decision_note
    }
    GLPI_CONFIG {
        boolean id PK
        text api_url
        text app_token_encrypted
        text user_token_encrypted
        boolean verify_tls
        int timeout_seconds
        boolean import_computers
        boolean import_network
        uuid area_id FK
        jsonb computer_types
        jsonb entities
        text auto_mode
        timestamptz last_auto_at
        date last_failure_notified_on
        timestamptz last_test_at
        boolean last_test_ok
        jsonb last_test
    }
    GLPI_IMPORT_RUNS {
        uuid id PK
        text trigger
        uuid user_id FK
        timestamptz started_at
        timestamptz finished_at
        boolean ok
        int created
        int updated
        int deactivated
        int reactivated
        int skipped
        int unchanged
        int held_back
        text message
    }

    AREAS |o--o{ ASSET_RESPONSIBLES : "area_id"
    AREAS |o--o{ GLPI_CONFIG : "area_id"
    AREAS ||--o{ ASSETS : "area_id"
    ASSETS |o--o{ ASSETS : "parent_asset_id"
    ASSETS ||--o{ ASSET_EVENTS : "asset_id"
    ASSETS ||--o{ ASSET_IPS : "asset_id"
    ASSETS ||--o{ ASSET_REQUESTS : "asset_id"
    ASSETS ||--o{ ASSET_RESPONSIBLES : "asset_id"
    ASSET_KINDS |o--o{ ASSETS : "kind_code"
    CATALOG_LOG_SOURCES |o--o{ ASSETS : "log_source_id"
    ORGANIZATIONS |o--o{ ASSETS : "client_id"
    ORGANIZATIONS |o--o{ ASSETS : "contractor_id"
    ORGANIZATIONS |o--o{ ASSET_RESPONSIBLES : "organization_id"
    ORGANIZATIONS |o--o{ ORGANIZATIONS : "via_organization_id"
    ORGANIZATIONS ||--o{ SERVICES : "organization_id"
    ORGANIZATION_TYPES ||--o{ ORGANIZATIONS : "type"
    RESPONSIBILITY_TYPES ||--o{ ASSET_RESPONSIBLES : "type_code"
    TERRITORIAL_UNITS |o--o{ ASSETS : "territorial_unit_id"
    TERRITORIAL_UNITS |o--o{ TERRITORIAL_UNITS : "parent_id"
    TICKETS |o--o{ ASSET_EVENTS : "ticket_id"
    USERS |o--o{ ASSET_EVENTS : "user_id"
    USERS |o--o{ ASSET_RESPONSIBLES : "user_id"
    USERS |o--o{ GLPI_IMPORT_RUNS : "user_id"
```

---

## 3. Directorio de contactos

Personas externas e internas a las que se avisa, con sus canales.

```mermaid
erDiagram
    CONTACTS {
        uuid id PK
        uuid organization_id FK
        text name
        text position
        text specialty
        contact_scope scope
        contact_source source
        boolean is_favorite
        text email_encrypted
        text email_hash
        text phone_encrypted
        text phone_hash
        text notes
        boolean active
    }
    CONTACT_CHANNELS {
        uuid id PK
        uuid contact_id FK
        uuid user_id FK
        contact_channel_type channel_type
        text value_encrypted
        text label
        boolean preferred
        boolean active
    }

    CONTACTS |o--o{ CONTACT_CHANNELS : "contact_id"
    ORGANIZATIONS ||--o{ CONTACTS : "organization_id"
    USERS |o--o{ CONTACT_CHANNELS : "user_id"
```

---

## 4. Ticketera

Tickets con SLA, comentarios, tareas con tiempo, resolutores, imágenes, padre/hijo y unidos.

```mermaid
erDiagram
    TICKETS {
        uuid id PK
        text ticket_number UK
        ticket_type ticket_type
        entry_scope scope
        uuid client_id FK
        uuid asset_id FK
        uuid service_id FK
        uuid assigned_team_id FK
        uuid assigned_user_id FK
        uuid assigned_contact_id FK
        ticket_status status
        itil_impact impact
        itil_urgency urgency
        itil_priority priority
        text title
        text description
        timestamptz sla_response_due_at
        timestamptz sla_resolution_due_at
        timestamptz sla_on_hold_since
        int sla_paused_seconds
        timestamptz first_responded_at
        timestamptz resolved_at
        timestamptz closed_at
        int reopened_count
        timestamptz reopened_at
        text public_tracking_token UK
        boolean public_tracking_enabled
        text public_tracking_pin
        uuid created_by FK
        uuid parent_id FK
        uuid merged_into_id FK
        boolean affects_client
        text[] notify_to
        text[] notify_cc
        timestamptz sla_response_breach_notified_at
        timestamptz sla_resolution_warn_notified_at
        timestamptz sla_resolution_breach_notified_at
        uuid territorial_unit_id FK
        uuid area_id FK
        uuid requested_area_id FK
    }
    TICKET_COMMENTS {
        uuid id PK
        uuid ticket_id FK
        uuid user_id FK
        text author_name
        text content
        boolean is_public
        text origin
    }
    TICKET_TASKS {
        uuid id PK
        uuid ticket_id FK
        uuid user_id FK
        text content
        int time_spent_seconds
        boolean is_public
        timestamptz performed_at
    }
    TICKET_RESOLVERS {
        uuid ticket_id PK, FK
        uuid user_id PK, FK
        uuid added_by FK
        timestamptz added_at
    }
    TICKET_IMAGES {
        uuid id PK
        uuid ticket_id FK
        uuid comment_id FK
        text file_name
        text mime_type
        int size_bytes
        bytea file_data
        text hash_sha256
        uuid uploaded_by FK
    }
    TICKET_SETTINGS {
        boolean id PK
        int sla_p1_response_minutes
        int sla_p1_resolution_minutes
        int sla_p2_response_minutes
        int sla_p2_resolution_minutes
        int sla_p3_response_minutes
        int sla_p3_resolution_minutes
        int sla_p4_response_minutes
        int sla_p4_resolution_minutes
        int sla_request_response_minutes
        int sla_request_resolution_minutes
        int at_risk_percent
        text public_signature
        boolean mail_enabled
        boolean mail_team_link
        boolean mail_skip_actor
        boolean mail_team_enabled
        text[] mail_backup_emails
        boolean mail_client_enabled
        text mail_affects_rule
        int mail_comment_batch_minutes
        boolean mail_include_pin
        text[] mail_events
         'team.assigned'
         'team.resolver_added'
         'team.sla_response_breached'
         'team.sla_resolution_breached'
         'team.reopened'
         'team.merged'
         'team.client_changed'
         'client.opened'
         'client.comment'
         'client.resolved'
        ] 'client.reopened'
    }
    TICKET_MAIL_OUTBOX {
        uuid id PK
        uuid ticket_id FK
        text event
        text mail_group
        text[] to_emails
        text[] cc_emails
        text subject
        text html
        text body_text
        jsonb comments
        text status
        int attempts
        text last_error
        timestamptz send_after
        timestamptz sent_at
        uuid created_by FK
    }
    TICKET_NUMBER_SERIES {
        uuid id PK
        text name
        text prefix
        text year_format
        int digits
        bigint next_number
        boolean is_default
    }

    AREAS ||--o{ TICKETS : "area_id"
    AREAS ||--o{ TICKETS : "requested_area_id"
    ASSETS |o--o{ TICKETS : "asset_id"
    CONTACTS |o--o{ TICKETS : "assigned_contact_id"
    ORGANIZATIONS ||--o{ TICKETS : "client_id"
    SERVICES |o--o{ TICKETS : "service_id"
    TEAMS |o--o{ TICKETS : "assigned_team_id"
    TERRITORIAL_UNITS |o--o{ TICKETS : "territorial_unit_id"
    TICKETS |o--o{ TICKETS : "merged_into_id"
    TICKETS |o--o{ TICKETS : "parent_id"
    TICKETS ||--o{ TICKET_COMMENTS : "ticket_id"
    TICKETS ||--o{ TICKET_IMAGES : "ticket_id"
    TICKETS ||--o{ TICKET_MAIL_OUTBOX : "ticket_id"
    TICKETS ||--o{ TICKET_RESOLVERS : "ticket_id"
    TICKETS ||--o{ TICKET_TASKS : "ticket_id"
    TICKET_COMMENTS |o--o{ TICKET_IMAGES : "comment_id"
    USERS |o--o{ TICKETS : "assigned_user_id"
    USERS |o--o{ TICKET_COMMENTS : "user_id"
    USERS ||--o{ TICKET_RESOLVERS : "user_id"
    USERS ||--o{ TICKET_TASKS : "user_id"
```

---

## 5. Equipos y escalamiento

Equipos, políticas con sus llamados, pools con nombre, incidentes con sus intentos y notas, ventanas de mantenimiento (también las que se repiten, con su serie) y RACI. Un equipo con `kind = 'step'` es el grupo de personas de un solo llamado: no tiene organización, no aparece en Equipos y se borra con su paso.

```mermaid
erDiagram
    TEAM_GROUPS {
        uuid id PK
        text name
        text slug UK
        uuid client_id FK
        boolean active
    }
    TEAMS {
        uuid id PK
        uuid organization_id FK
        uuid team_group_id FK
        text name
        text slug UK
        text kind
        team_audience audience
        boolean active
        boolean deactivated_by_org
        uuid area_id FK
    }
    TEAM_MEMBERS {
        uuid id PK
        uuid team_id FK
        uuid user_id FK
        uuid contact_id FK
        recipient_type recipient_type
        team_role role_in_team
        int priority
        boolean active
        uuid pool_id FK
    }
    TEAM_COVERAGE {
        uuid team_id PK, FK
        uuid territorial_unit_id PK, FK
        int priority
    }
    ESCALATION_POLICIES {
        uuid id PK
        uuid service_id FK
        uuid asset_id FK
        uuid territorial_unit_id FK
        boolean active
        text reminder
        uuid area_id FK
    }
    ESCALATION_STEPS {
        uuid id PK
        uuid policy_id FK
        int step_order
        uuid team_id FK
        escalation_mode mode
        int wait_before_escalate_minutes
        text title
    }
    ESCALATION_POOLS {
        uuid id PK
        uuid organization_id FK
        text name
        boolean active
    }
    ESCALATION_POOL_MEMBERS {
        uuid id PK
        uuid pool_id FK
        uuid contact_id FK
        uuid user_id FK
        int position
    }
    ESCALATION_INCIDENTS {
        uuid id PK
        uuid service_id FK
        uuid asset_id FK
        uuid territorial_unit_id FK
        text title
        text glpi_ticket
        uuid ticket_id FK
        uuid opened_by FK
        timestamptz opened_at
        uuid closed_by FK
        timestamptz closed_at
        uuid entry_id FK
    }
    ESCALATION_INCIDENT_NOTES {
        uuid id PK
        uuid incident_id FK
        uuid user_id FK
        text note
    }
    ESCALATION_ACTION_LOGS {
        uuid id PK
        uuid entry_id FK
        uuid policy_id FK
        int step_order
        uuid contact_id FK
        contact_channel_type channel_type
        contact_attempt_result result
        text notes
        uuid operator_id FK
        uuid incident_id FK
    }
    MAINTENANCE_WINDOWS {
        uuid id PK
        uuid service_id FK
        uuid asset_id FK
        uuid territorial_unit_id FK
        text title
        text notes
        timestamptz starts_at
        timestamptz ends_at
        boolean suppress_notifications
        int priority
        uuid created_by FK
        boolean active
        uuid organization_id FK
        uuid area_id FK
        uuid team_id FK
        uuid agenda_task_id FK
        timestamptz closed_at
        uuid closed_by FK
        boolean notified_start
        boolean notified_end
        uuid series_id FK
        date series_day
        text holiday_name
        uuid approved_by FK
        timestamptz approved_at
    }
    MAINTENANCE_WINDOW_SERIES {
        uuid id PK
        uuid service_id FK
        uuid asset_id FK
        uuid territorial_unit_id FK
        uuid organization_id FK
        uuid area_id FK
        uuid team_id FK
        text title
        text notes
        boolean suppress_notifications
        int priority
        jsonb rule
        date valid_from
        date valid_to
        text timezone
        boolean active
        uuid created_by FK
    }
    RACI_ASSIGNMENTS {
        uuid id PK
        uuid client_id FK
        uuid service_id FK
        uuid asset_id FK
        text topic
        raci_role role
        uuid team_id FK
        boolean active
    }

    AGENDA_TASKS |o--o{ MAINTENANCE_WINDOWS : "agenda_task_id"
    AREAS |o--o{ MAINTENANCE_WINDOWS : "area_id"
    AREAS |o--o{ MAINTENANCE_WINDOW_SERIES : "area_id"
    AREAS |o--o{ TEAMS : "area_id"
    AREAS ||--o{ ESCALATION_POLICIES : "area_id"
    ASSETS |o--o{ ESCALATION_INCIDENTS : "asset_id"
    ASSETS |o--o{ ESCALATION_POLICIES : "asset_id"
    ASSETS |o--o{ MAINTENANCE_WINDOWS : "asset_id"
    ASSETS |o--o{ MAINTENANCE_WINDOW_SERIES : "asset_id"
    ASSETS |o--o{ RACI_ASSIGNMENTS : "asset_id"
    CONTACTS |o--o{ ESCALATION_ACTION_LOGS : "contact_id"
    CONTACTS |o--o{ ESCALATION_POOL_MEMBERS : "contact_id"
    CONTACTS |o--o{ TEAM_MEMBERS : "contact_id"
    ENTRIES |o--o{ ESCALATION_ACTION_LOGS : "entry_id"
    ENTRIES |o--o{ ESCALATION_INCIDENTS : "entry_id"
    ESCALATION_INCIDENTS |o--o{ ESCALATION_ACTION_LOGS : "incident_id"
    ESCALATION_INCIDENTS ||--o{ ESCALATION_INCIDENT_NOTES : "incident_id"
    ESCALATION_POLICIES |o--o{ ESCALATION_ACTION_LOGS : "policy_id"
    ESCALATION_POLICIES ||--o{ ESCALATION_STEPS : "policy_id"
    ESCALATION_POOLS |o--o{ TEAM_MEMBERS : "pool_id"
    ESCALATION_POOLS ||--o{ ESCALATION_POOL_MEMBERS : "pool_id"
    MAINTENANCE_WINDOW_SERIES |o--o{ MAINTENANCE_WINDOWS : "series_id"
    ORGANIZATIONS |o--o{ ESCALATION_POOLS : "organization_id"
    ORGANIZATIONS |o--o{ MAINTENANCE_WINDOWS : "organization_id"
    ORGANIZATIONS |o--o{ MAINTENANCE_WINDOW_SERIES : "organization_id"
    ORGANIZATIONS |o--o{ RACI_ASSIGNMENTS : "client_id"
    ORGANIZATIONS |o--o{ TEAMS : "organization_id"
    ORGANIZATIONS |o--o{ TEAM_GROUPS : "client_id"
    SERVICES |o--o{ ESCALATION_INCIDENTS : "service_id"
    SERVICES |o--o{ ESCALATION_POLICIES : "service_id"
    SERVICES |o--o{ MAINTENANCE_WINDOWS : "service_id"
    SERVICES |o--o{ MAINTENANCE_WINDOW_SERIES : "service_id"
    SERVICES |o--o{ RACI_ASSIGNMENTS : "service_id"
    TEAMS |o--o{ MAINTENANCE_WINDOWS : "team_id"
    TEAMS |o--o{ MAINTENANCE_WINDOW_SERIES : "team_id"
    TEAMS ||--o{ ESCALATION_STEPS : "team_id"
    TEAMS ||--o{ RACI_ASSIGNMENTS : "team_id"
    TEAMS ||--o{ TEAM_COVERAGE : "team_id"
    TEAMS ||--o{ TEAM_MEMBERS : "team_id"
    TEAM_GROUPS |o--o{ TEAMS : "team_group_id"
    TERRITORIAL_UNITS |o--o{ ESCALATION_INCIDENTS : "territorial_unit_id"
    TERRITORIAL_UNITS |o--o{ ESCALATION_POLICIES : "territorial_unit_id"
    TERRITORIAL_UNITS |o--o{ MAINTENANCE_WINDOWS : "territorial_unit_id"
    TERRITORIAL_UNITS |o--o{ MAINTENANCE_WINDOW_SERIES : "territorial_unit_id"
    TERRITORIAL_UNITS ||--o{ TEAM_COVERAGE : "territorial_unit_id"
    TICKETS |o--o{ ESCALATION_INCIDENTS : "ticket_id"
    USERS |o--o{ ESCALATION_POOL_MEMBERS : "user_id"
    USERS |o--o{ TEAM_MEMBERS : "user_id"
    USERS ||--o{ ESCALATION_ACTION_LOGS : "operator_id"
    USERS ||--o{ ESCALATION_INCIDENT_NOTES : "user_id"
```

---

## 6. Turnos, guardias y dotación

Turnos de trabajo y sus integrantes, guardias con hora exacta (ciclos, tramos y reemplazos), dotación, recordatorios y cierre de turno.

```mermaid
erDiagram
    WORK_SHIFTS {
        uuid id PK
        uuid rotation_cycle_id FK
        text name
        time start_time
        time end_time
        text timezone
        text shift_type
        uuid checklist_template_start_id FK
        uuid checklist_template_end_id FK
        text[] email_recipients
        boolean active
        boolean email_include_checklist
        boolean email_include_entries
        text email_subject_template
        int sort_order
    }
    WORK_SHIFT_MEMBERS {
        uuid id PK
        uuid work_shift_id FK
        uuid user_id FK
        int[] weekdays
        boolean active
        date valid_from
        date valid_to
    }
    WORK_SHIFT_ASSIGNMENTS {
        uuid id PK
        uuid user_id FK
        date assigned_date
        telework_condition condition
        text notes
    }
    WORK_SHIFT_NOTIFICATION_SCHEDULES {
        uuid id PK
        text name
        boolean enabled
        notification_schedule_frequency frequency
        int day_of_week
        time send_time
        text timezone
        text[] role_filter
        text[] recipients
        text[] cc_recipients
        timestamptz last_sent_at
        uuid created_by FK
        text target_period
        text email_format
    }
    ROTATION_CYCLES {
        uuid id PK
        uuid team_id FK
        int start_day_of_week
        time start_time_utc
        int duration_days
        text timezone
        boolean active
        boolean must_be_covered
        boolean remind_uncovered
    }
    ROTATION_SLOTS {
        uuid id PK
        uuid cycle_id FK
        uuid team_member_id FK
        date week_start_date
        date week_end_date
        boolean is_paused
        text paused_reason
        timestamptz starts_at
        timestamptz ends_at
    }
    ROTATION_OVERRIDES {
        uuid id PK
        uuid cycle_id FK
        uuid original_team_member_id FK
        uuid replacement_team_member_id FK
        timestamptz start_date
        timestamptz end_date
        text reason
        uuid created_by FK
    }
    SHIFT_REMINDERS {
        uuid id PK
        text label
        text reminder_text
        text frequency_type
        int interval_hours
        text[] fixed_times
        uuid[] target_shift_ids
        boolean enabled
        uuid created_by FK
    }
    SHIFT_REMINDER_SENDS {
        uuid reminder_id PK, FK
        uuid work_shift_id PK, FK
        text trigger_key PK
        int recipients_count
        text status
        text error
        timestamptz sent_at
    }
    SHIFT_CLOSURES {
        uuid id PK
        uuid user_id FK
        timestamptz shift_start_at
        timestamptz shift_end_at
        uuid closure_check_id FK
        int total_entries
        int total_incidents
        text[] services_down
        text observations
        text pending_for_next_shift
        uuid acknowledged_by FK
        timestamptz acknowledged_at
        int tickets_resolved_count
        int sla_breaches_count
        text sent_via
        text integration_name
        text sent_status
        text sent_error
        timestamptz sent_at
    }
    PUBLIC_SHARE_LINKS {
        uuid id PK
        text slug
        text token_hash UK
        boolean is_active
        uuid created_by FK
        timestamptz last_accessed_at
    }

    CHECKLIST_TEMPLATES |o--o{ WORK_SHIFTS : "checklist_template_end_id"
    CHECKLIST_TEMPLATES |o--o{ WORK_SHIFTS : "checklist_template_start_id"
    ROTATION_CYCLES |o--o{ WORK_SHIFTS : "rotation_cycle_id"
    ROTATION_CYCLES ||--o{ ROTATION_OVERRIDES : "cycle_id"
    ROTATION_CYCLES ||--o{ ROTATION_SLOTS : "cycle_id"
    SHIFT_CHECKS ||--o{ SHIFT_CLOSURES : "closure_check_id"
    SHIFT_REMINDERS ||--o{ SHIFT_REMINDER_SENDS : "reminder_id"
    TEAMS ||--o{ ROTATION_CYCLES : "team_id"
    TEAM_MEMBERS |o--o{ ROTATION_OVERRIDES : "original_team_member_id"
    TEAM_MEMBERS ||--o{ ROTATION_OVERRIDES : "replacement_team_member_id"
    TEAM_MEMBERS ||--o{ ROTATION_SLOTS : "team_member_id"
    USERS ||--o{ SHIFT_CLOSURES : "user_id"
    USERS ||--o{ WORK_SHIFT_ASSIGNMENTS : "user_id"
    USERS ||--o{ WORK_SHIFT_MEMBERS : "user_id"
    WORK_SHIFTS ||--o{ SHIFT_REMINDER_SENDS : "work_shift_id"
    WORK_SHIFTS ||--o{ WORK_SHIFT_MEMBERS : "work_shift_id"
```

---

## 7. Agenda

Tareas programadas (una vez o recurrentes en días hábiles) con su responsable (persona, nivel o guardia), cada ocurrencia con su estado, y el calendario hábil: horario de la Agenda y feriados. Un flujo une tareas de varias áreas en orden (cada paso es una tarea con `flow_id`); cada vuelta del flujo tiene una ocurrencia por paso. También el enlace propio de cada persona para ver su Agenda en Outlook y la foto del resumen mensual de cada área.

```mermaid
erDiagram
    AGENDA_TASKS {
        uuid id PK
        text name
        text description
        uuid area_id FK
        uuid organization_id FK
        text assignee_kind
        uuid assignee_user_id FK
        uuid assignee_level_id FK
        uuid assignee_team_id FK
        jsonb recurrence
        int[] warn_days
        text[] steps
        text doc_url
        text report_kind
        boolean active
        uuid created_by FK
        uuid flow_id FK
        int flow_position
        boolean flow_after
        int flow_days
    }
    AGENDA_OCCURRENCES {
        uuid id PK
        uuid task_id FK
        date due_date
        date moved_from
        text status
        uuid user_id FK
        uuid offered_level_id FK
        uuid absent_user_id FK
        int[] steps_done
        text note
        text link
        text skip_reason
        uuid closed_by FK
        timestamptz closed_at
        uuid report_history_id FK
        uuid flow_run_id FK
    }
    AGENDA_SETTINGS {
        boolean id PK
        int[] work_days
        time day_start
        time day_end
        text timezone
        text holiday_country
    }
    HOLIDAYS {
        date day PK
        text name
        text source
    }
    AGENDA_FLOWS {
        uuid id PK
        text name
        uuid organization_id FK
        jsonb recurrence
        boolean active
        uuid created_by FK
    }
    AGENDA_FLOW_RUNS {
        uuid id PK
        uuid flow_id FK
        date start_date
    }
    CALENDAR_FEEDS {
        uuid user_id PK, FK
        text token_hash UK
        text token_encrypted
        boolean include_windows
        timestamptz last_read_at
    }
    MONTHLY_SUMMARIES {
        uuid area_id PK, FK
        date month PK
        jsonb data
        timestamptz frozen_at
    }

    AGENDA_FLOWS |o--o{ AGENDA_TASKS : "flow_id"
    AGENDA_FLOWS ||--o{ AGENDA_FLOW_RUNS : "flow_id"
    AGENDA_FLOW_RUNS |o--o{ AGENDA_OCCURRENCES : "flow_run_id"
    AGENDA_TASKS ||--o{ AGENDA_OCCURRENCES : "task_id"
    AREAS ||--o{ AGENDA_TASKS : "area_id"
    AREAS ||--o{ MONTHLY_SUMMARIES : "area_id"
    LEVELS |o--o{ AGENDA_OCCURRENCES : "offered_level_id"
    LEVELS |o--o{ AGENDA_TASKS : "assignee_level_id"
    ORGANIZATIONS |o--o{ AGENDA_FLOWS : "organization_id"
    ORGANIZATIONS |o--o{ AGENDA_TASKS : "organization_id"
    REPORT_HISTORY |o--o{ AGENDA_OCCURRENCES : "report_history_id"
    TEAMS |o--o{ AGENDA_TASKS : "assignee_team_id"
    USERS |o--o{ AGENDA_OCCURRENCES : "absent_user_id"
    USERS |o--o{ AGENDA_OCCURRENCES : "user_id"
    USERS |o--o{ AGENDA_TASKS : "assignee_user_id"
    USERS ||--o| CALENDAR_FEEDS : "user_id"
```

---

## 8. Notificaciones y avisos con acuse

La campana de cada persona, sus preferencias, lo que fija el admin, los avisos de la Agenda ya enviados y los avisos con acuse de lectura con quién los leyó.

```mermaid
erDiagram
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text kind
        text title
        text body
        text link
        text group_key
        int count
        boolean toast
        boolean browser
        timestamptz read_at
    }
    NOTIFICATION_PREFS {
        uuid user_id PK, FK
        jsonb prefs
        boolean digest
        boolean browser
    }
    NOTIFICATION_SETTINGS {
        boolean id PK
        time digest_time
        text[] locked_kinds
        int group_minutes
        int retention_days
        date last_digest_day
    }
    AGENDA_OCCURRENCE_ALERTS {
        uuid occurrence_id PK, FK
        text alert PK
        timestamptz sent_at
    }
    NOTICES {
        uuid id PK
        text title
        text body
        jsonb audience
        timestamptz publish_at
        timestamptz expires_at
        boolean published
        uuid created_by FK
    }
    NOTICE_RECIPIENTS {
        uuid notice_id PK, FK
        uuid user_id PK, FK
        timestamptz read_at
        timestamptz reminded_at
    }

    AGENDA_OCCURRENCES ||--o{ AGENDA_OCCURRENCE_ALERTS : "occurrence_id"
    NOTICES ||--o{ NOTICE_RECIPIENTS : "notice_id"
    USERS ||--o{ NOTICE_RECIPIENTS : "user_id"
    USERS ||--o{ NOTIFICATIONS : "user_id"
    USERS ||--o| NOTIFICATION_PREFS : "user_id"
```

---

## 9. Checklists

Plantillas de checklist de inicio y cierre de turno y sus ejecuciones.

```mermaid
erDiagram
    CHECKLIST_TEMPLATES {
        uuid id PK
        text name
        boolean is_active
        boolean alert_nok_enabled
        text[] alert_nok_cargos
    }
    CHECKLIST_ITEMS {
        uuid id PK
        uuid template_id FK
        uuid parent_item_id FK
        text title
        int item_order
    }
    SHIFT_CHECKS {
        uuid id PK
        uuid checklist_template_id FK
        uuid user_id FK
        uuid work_shift_id FK
        checklist_check_type check_type
        timestamptz check_date
        boolean has_red_services
    }
    SHIFT_CHECK_SERVICES {
        uuid id PK
        uuid shift_check_id FK
        uuid checklist_item_id FK
        text service_title
        checklist_status status
        boolean is_computed
        text observation
        uuid correlated_from_service_id FK
    }

    CHECKLIST_ITEMS |o--o{ CHECKLIST_ITEMS : "parent_item_id"
    CHECKLIST_ITEMS |o--o{ SHIFT_CHECK_SERVICES : "checklist_item_id"
    CHECKLIST_TEMPLATES ||--o{ CHECKLIST_ITEMS : "template_id"
    CHECKLIST_TEMPLATES ||--o{ SHIFT_CHECKS : "checklist_template_id"
    SHIFT_CHECKS ||--o{ SHIFT_CHECK_SERVICES : "shift_check_id"
    SHIFT_CHECK_SERVICES |o--o{ SHIFT_CHECK_SERVICES : "correlated_from_service_id"
    USERS ||--o{ SHIFT_CHECKS : "user_id"
    WORK_SHIFTS ||--o{ SHIFT_CHECKS : "work_shift_id"
```

---

## 10. Bitácora

Entradas, comentarios, adjuntos, borradores y eventos del sistema.

```mermaid
erDiagram
    ENTRIES {
        uuid id PK
        uuid user_id FK
        entry_type entry_type
        entry_scope scope
        text content
        text[] tags
        uuid service_id FK
        uuid asset_id FK
        uuid work_shift_id FK
        text glpi_ticket_id
        timestamptz glpi_linked_at
        uuid ticket_id FK
        text image_url
        text image_hash
        int image_size_bytes
        uuid owner_complement_id FK
        text owner_complement_name
    }
    ENTRY_COMMENTS {
        uuid id PK
        uuid entry_id FK
        uuid user_id FK
        text comment
        boolean is_system_generated
    }
    ENTRY_ATTACHMENTS {
        uuid id PK
        uuid entry_id FK
        text file_name
        text mime_type
        int size_bytes
        bytea file_data
        text hash_sha256
    }
    ENTRY_DRAFTS {
        uuid id PK
        uuid user_id FK
        text form_type
        text draft_key
        jsonb content
        timestamptz expires_at
    }
    SYSTEM_EVENTS {
        bigserial id PK
        text event_type
        entry_scope scope
        jsonb payload
    }

    ASSETS |o--o{ ENTRIES : "asset_id"
    COMPLEMENTS |o--o{ ENTRIES : "owner_complement_id"
    ENTRIES |o--o{ ENTRY_ATTACHMENTS : "entry_id"
    ENTRIES ||--o{ ENTRY_COMMENTS : "entry_id"
    SERVICES |o--o{ ENTRIES : "service_id"
    TICKETS |o--o{ ENTRIES : "ticket_id"
    USERS ||--o{ ENTRIES : "user_id"
    USERS ||--o{ ENTRY_COMMENTS : "user_id"
    USERS ||--o{ ENTRY_DRAFTS : "user_id"
    WORK_SHIFTS |o--o{ ENTRIES : "work_shift_id"
```

---

## 11. Reportes y avisos por cliente

Historial de reportes enviados, tipos de operación, eventos del informe y las reglas de aviso por cliente con su acuse.

```mermaid
erDiagram
    REPORT_HISTORY {
        uuid id PK
        text kind
        text title
        text subject
        uuid organization_id FK
        uuid service_id FK
        text[] recipients
        text[] cc_recipients
        text html
        jsonb payload
        text status
        text error
        uuid sent_by FK
        text sent_by_username
    }
    REPORT_OPERATION_TYPES {
        uuid id PK
        text name UK
        text info_default
        boolean enabled
    }
    REPORT_EVENTS {
        uuid id PK
        text name
        text parent
        text description
        text motivo_default
        boolean enabled
    }
    CLIENT_ALERT_RULES {
        uuid id PK
        uuid organization_id FK
        text name
        boolean enabled
        text[] contexts
        text timezone
        int priority
        timestamptz valid_from
        timestamptz valid_to
        date[] holiday_dates
        jsonb time_windows
        text[] channels
        text message
        boolean requires_ack
        uuid updated_by FK
    }
    CLIENT_ALERT_ACKS {
        uuid id PK
        uuid rule_id FK
        uuid user_id FK
        text occurrence_key
        text context
        timestamptz acked_at
    }

    CLIENT_ALERT_RULES ||--o{ CLIENT_ALERT_ACKS : "rule_id"
    ORGANIZATIONS |o--o{ REPORT_HISTORY : "organization_id"
    ORGANIZATIONS ||--o{ CLIENT_ALERT_RULES : "organization_id"
    SERVICES |o--o{ REPORT_HISTORY : "service_id"
    USERS ||--o{ CLIENT_ALERT_ACKS : "user_id"
```

---

## 12. Auditoría, notas y alertas de sala

Registro de auditoría (solo se agrega), notas del admin y personales, y alertas programadas en pantalla.

```mermaid
erDiagram
    AUDIT_LOG {
        uuid id PK
        timestamptz timestamp
        text event
        text level
        uuid actor_user_id FK
        text actor_username
        text actor_role
        text request_id
        text request_ip
        text request_path
        text request_method
        text user_agent
        text device_fingerprint
        boolean ip_changed
        text previous_ip
        boolean success
        text reason
        text source
        text source_id
        jsonb metadata
    }
    ADMIN_NOTES {
        boolean id PK
        text content
        uuid last_edited_by FK
    }
    PERSONAL_NOTES {
        uuid id PK
        uuid user_id FK, UK
        text content
    }
    SCHEDULED_ALERTS {
        uuid id PK
        text title
        text message
        scheduled_alert_type alert_type
        text cron_expression
        timestamptz scheduled_at
        scheduled_alert_target target_type
        text target_role
        uuid target_user_id FK
        entry_scope scope
        text severity
        boolean sound_alert
        uuid suggested_template_id FK
        boolean active
        uuid created_by FK
    }

    MESSAGE_TEMPLATES |o--o{ SCHEDULED_ALERTS : "suggested_template_id"
    USERS |o--o{ AUDIT_LOG : "actor_user_id"
    USERS |o--o{ SCHEDULED_ALERTS : "target_user_id"
    USERS ||--o| PERSONAL_NOTES : "user_id"
```

---

## 13. Configuración y respaldos

Configuración única de la instalación, correo, marca, funcionalidades activables y respaldos.

```mermaid
erDiagram
    APP_CONFIG {
        boolean id PK
        int shift_check_cooldown_minutes
        boolean alert_nok_enabled
        text[] alert_nok_role_target
        int audit_ttl_days
        int backup_retention_days
        jsonb territorial_kind_labels
        timestamptz setup_completed_at
        boolean birthday_emails_enabled
        text birthday_emails_time
        text birthday_emails_cc
        date birthday_emails_last_date
        smallint password_min_length
        boolean soc_module_enabled
        boolean noc_module_enabled
        text map_tiles_mode
        text map_tiles_url
        boolean checklist_missing_enabled
        text checklist_missing_time
        uuid checklist_missing_team_id FK
        text[] checklist_missing_cargos
        date checklist_missing_last_date
        boolean guard_reminder_enabled
        int guard_reminder_days_ahead
        text[] guard_reminder_cargos
        date guard_reminder_last_date
        date guard_reminder_last_week
        bytea birthday_image
        text birthday_image_type
        timestamptz birthday_image_updated_at
    }
    SMTP_CONFIG {
        boolean id PK
        text host
        int port
        text username
        text password_encrypted
        text from_address
        boolean require_tls
        text from_name
        timestamptz last_test_at
        boolean last_test_ok
        text last_test_error
    }
    APP_BRANDING {
        boolean id PK
        text app_title
        bytea logo
        text logo_type
        text logo_name
        bytea favicon
        text favicon_type
        text favicon_url
        text title_font
        bytea font_file
        text font_type
        text font_name
        text incident_palette
        text bulletin_color
        text login_theme
        int version
        uuid updated_by FK
    }
    SYSTEM_FEATURES {
        text code PK
        text name
        text description
        boolean is_enabled
        jsonb config_payload
        uuid updated_by FK
    }
    BACKUP_CONFIG {
        boolean id PK
        boolean enabled
        int interval_days
        time run_at
        text timezone
        int retention_days
        text destination_type
        text destination_path
        text passphrase_encrypted
        timestamptz next_run_at
        timestamptz last_run_at
        text last_status
        text last_message
        uuid updated_by FK
    }
    BACKUP_RUNS {
        uuid id PK
        backup_kind kind
        timestamptz window_from
        timestamptz window_to
        int records_count
        timestamptz started_at
        timestamptz finished_at
        text status
        text file_path
        bigint file_size_bytes
        text checksum_sha256
        text compression_algorithm
        boolean encrypted
        uuid triggered_by FK
        text error_message
        text trigger_source
    }

    TEAMS |o--o{ APP_CONFIG : "checklist_missing_team_id"
```

---

## 14. Complementos

Complementos instalados, sus archivos y su almacenamiento.

```mermaid
erDiagram
    COMPLEMENTS {
        uuid id PK
        text slug UK
        text name
        text description
        text icon
        complement_source source_type
        complement_status status
        text entry_path
        text base_url
        text internal_base_url
        text health_path
        text api_version
        text[] scopes
        text[] allowed_collections
        text[] connect_hosts
        text[] visible_roles
        uuid[] visible_permission_group_ids
        text token_hash
        timestamptz token_issued_at
        text artifact_sha256
        bigint artifact_bytes
        int artifact_files
        timestamptz published_at
        uuid created_by FK
    }
    COMPLEMENT_FILES {
        uuid complement_id PK, FK
        text path PK
        text content_type
        text sha256
        bytea content
    }
    COMPLEMENT_UPLOADS {
        uuid id PK
        text filename
        jsonb analysis
        bytea content
        uuid uploaded_by FK
        timestamptz expires_at
    }
    COMPLEMENT_STORAGE {
        uuid complement_id PK, FK
        text key PK
        jsonb value
        uuid updated_by_user_id FK
        text updated_via
    }

    COMPLEMENTS ||--o{ COMPLEMENT_FILES : "complement_id"
    COMPLEMENTS ||--o{ COMPLEMENT_STORAGE : "complement_id"
    USERS |o--o{ COMPLEMENT_STORAGE : "updated_by_user_id"
```

---

## 15. Ingesta de alertas (después del corte)

Tablas creadas para la ingesta de alertas del backlog posterior al corte; todavía sin uso.

```mermaid
erDiagram
    MESSAGE_TEMPLATES {
        uuid id PK
        text name
        text category
        text title_template
        text body_template
        text suggested_severity
        boolean active
    }
    ALERT_INGESTION_RULES {
        uuid id PK
        text source_type
        text name
        text match_severity
        text match_host_pattern
        uuid template_id FK
        boolean play_sound
        text toast_priority
        boolean active
    }

    MESSAGE_TEMPLATES |o--o{ ALERT_INGESTION_RULES : "template_id"
```
