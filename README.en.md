# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

> 🌐 **Language:** English | [Español](README.md)

Web platform for SOC operations with an operational logbook, shift checklists, escalation, auditing, backup, integrations and an embedded complements (plugins) module.

> Project status: stable. Always validate flows in a test environment before moving to formal operation.
>
> Current reference version (per `CHANGELOG.md`): **v1.8.1**

Main stack:

- frontend: Angular 20
- backend: Express 5 + Node 22 LTS
- database: MongoDB 8
- deployment: Docker Compose v2

---

## Table of contents

- [Key capabilities](#key-capabilities)
- [Comparison with similar tools](#comparison-with-similar-tools)
- [Recent updates](#recent-updates-quick-summary)
- [Quick Start with Docker](#quick-start-with-docker)
- [Quick UI preview](#quick-ui-preview)
- [Local development](#local-development)
- [Complements](#complements)
- [Repository structure](#repository-structure)
- [Documentation](#documentation)
- [License](#license)

---

## Key capabilities

- **Comprehensive Operational Logbook**: Continuous real-time logging of events, critical incidents, maintenance windows and security offenses, structured through narrative entries and hashtags.
- **Operational Discipline and Checklists**: Shift handover management via mandatory start/end-of-shift checklists, with reactive alerts and closure blockers when open non-conforming (NOK) findings remain.
- **Visual and Interactive Escalation Path**: Contact maps and interactive hierarchical diagrams per client and service, allowing anyone to visually identify who to call first when an incident occurs.
- **Escalation Flow Visualization**: Monitoring and review of call flows, email flows and the RACI responsibility matrix, editable from the admin panel.
- **Centralized Directory**: Unified email/phone address book for fast lookup of client contacts, on-call analysts and links to critical web services.
- **Shift and On-Call Email Automation**: Automated scheduling of periodic shift reports for analysts and clients. Emails (responsive premium HTML) are sent with badges and corporate colors according to shift status (On Duty, Remote Work, Vacation, Leave or Medical Appointments).
- **Interactive Email Testing**: Panel to run immediate test sends based on the live UI configuration, without altering production history or send dates.
- **SMTP Management and Branding**: Configuration of mail servers and sender identity, plus the ability to upload logos and customize application titles to match institutional branding.
- **Birthday Celebrations**: Automatic daily mapping of SOC analysts' birthdays with structured greetings and inline (CID) embedded kawaii images.
- **Robust Security and Access Control**:
  - Two-Factor Authentication support (TOTP - Google Authenticator, Authy, etc.).
  - Reference Single Sign-On (SSO) integration via Google and Microsoft Azure AD _(base module implemented; requires validation, provider API credentials and production configuration testing)_.
  - HTTPS management console with zero-downtime TLS certificate injection and rotation.
- **Automated Statistics and Reports**: Generation of executive reports and usage indicators based on logbook entries to assess team activity and operational compliance.
- **Resilience via Encrypted Backups**: Creation and restoration of MongoDB database backups and disk evidence with password-encrypted, downloadable packaging from the UI.
- **Extensibility via Complements (Plugins)**: Loading and execution of static utilities (ZIP) and external URLs integrated through sandboxed iframes, with selective access control to the shared API and Circuit Breaker protection against complement failures.
- **Integrations and API Keys (SOAR / Automation)**: Administrative CRUD for secure credentials (SHA-256) with granular permissions (scopes), real-time audit logs, and support for MJML report rendering plus automatic SMTP incident-alert delivery for integration with external tools.

---

## Comparison with similar tools

| Feature / Focus                   | Bitácora SOC                                                                                                                                                                                  | TheHive / Cortex                                                                                     | Generic ITSM / Ticketing (JSM, ServiceNow, GLPI, etc.)                                                                     |
| :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Primary Goal**                  | Shift-based operational continuity: what happened, who picked it up, what remains pending and who to call.                                                                                   | Cybersecurity incident management and deep technical investigation (IOC, forensics, response).       | Service request/incident management with administrative traceability and SLAs.                                            |
| **Center of Gravity**             | **Real-time operation and shift handover** (SOC, NOC, IT on-call and emergency teams).                                                                                                        | **Threat investigation** and specialized technical response focused on cybersecurity.                | **Service process** (tickets, queues, approvals, service catalog).                                                         |
| **Nature of Escalation**          | **Human and direct**: the logbook documents who to call, which team to contact and which path to follow; it does not depend on a ticket to trigger immediate help.                           | **Technical and case-oriented**: prioritizes analysis and orchestration over operational calling.    | **Automatic via service flow**: the ticket is routed to the defined area/queue and can be escalated by process rules.      |
| **Shift Governance**              | **Yes** (start/end-of-shift checklist, segregation by `shiftId`, compliance metrics and daily operational discipline).                                                                       | Not native (focus is on cases; not on shift open/close rituals).                                     | Partial (can be modeled with customization, but rarely ships as a ready-made shift handover flow).                        |
| **Team and Operations Management**| **Yes** (shift minutes/reports, remote-work/vacation visibility, internal assignments and automated reminders).                                                                              | Not oriented toward on-call staffing and coordination.                                               | Partial (strong on ticket assignment; weaker on a tactical view of on-shift staffing).                                     |
| **Analytics and Operational KPIs**| **Yes** (per-user usage metrics, entry volume, logged actions, attended alerts and activity traceability to measure operational discipline).                                                 | Focus more oriented to cases and investigation than to daily handover KPIs.                          | Yes, but centered on SLAs, queues and handling times, not on shift logbooks.                                               |
| **Alerts and Acknowledgements**   | **Yes** (checklist notices, NOK alerts, reminders and per-client alerts; the user can acknowledge read/close where applicable and re-close them according to the operational flow).          | Yes, but oriented to security incidents/cases.                                                       | Yes, typically via notifications and ticket statuses.                                                                      |
| **Entry Flexibility**             | **High** (narrative logbook with hashtags for incidents, maintenance, physical on-call shifts and multi-area operations).                                                                    | Medium-low (structure centered on cyber cases).                                                      | Medium (structured fields and forms; less natural for chronological shift narrative).                                     |
| **Operational Data Model**        | **Event + narrative + checklist + audit** (prioritizes shift context, continuity between people and action tracking).                                                                        | **Case + observable + task** (prioritizes investigation and technical evidence).                     | **Ticket + status + SLA** (prioritizes the service lifecycle).                                                             |
| **Search and Traceability**       | Text/narrative search by content and hashtags, useful for operational reconstruction and historical backup.                                                                                  | Technical search by observables/IOCs for threat correlation.                                         | Search by ticket, fields, statuses and service reports.                                                                    |
| **Reporting and Communication**   | Executive bulletins/reports sent by email, grouped by domain, with send history to know when clients or teams were notified.                                                                 | Requires additional layers for client-facing executive reporting.                                    | Very strong on service/SLA reporting; less focused on shift-handover narrative.                                            |
| **Audit and Compliance**          | Persistent, cross-cutting audit trail (operational and administrative actions) + role-based access control (admin/user/auditor/guest).                                                       | Audit oriented to investigation and actions on cases.                                                | Mature administrative audit, generally centered on the ITSM process.                                                       |
| **Resilience and Backups**        | UI-driven backups/restores with encryption and full scope (DB + evidence + secrets).                                                                                                          | Usually delegated to infrastructure/platform strategy.                                               | Depends on the product/plan; usually handled at the platform/instance level.                                               |
| **Operator Extensibility**        | Embedded complements with sandbox, context bridge and circuit breaker for field utilities.                                                                                                   | Extensible through security-oriented integrations.                                                   | Robust marketplace and integrations, usually oriented to corporate ITSM flows.                                             |
| **Domain Coverage**               | **SOC-first but not SOC-only**: also applies to NOC, IT help desks, physical on-call shifts and teams with multiple escalation/monitoring paths.                                             | **Cybersecurity-first and specialized**.                                                              | **Enterprise-first and cross-cutting**, focused on service governance rather than shift logbooks.                          |
| **Learning Curve**                | Low to medium (quick onboarding for N1/on-call operators, with progressive growth).                                                                                                           | Medium-high (N2/N3 security analyst profile).                                                        | Medium (requires process adoption and catalog/flow configuration).                                                         |

---

## Recent updates (quick summary)

> Full detailed history in [`docs/history/CHANGELOG.md`](docs/history/CHANGELOG.md).

### v1.8.1 / v1.8.0 (Audit Logs: date-range calendar picker, filter by User, filter layout and timezone bugfix)

- **Single-calendar date range picker**: replaces the separate "Start date"/"End date" fields with a single Material date range picker (`mat-date-range-picker`) that lets you pick the start and end day in one interaction.
- **Filter by User instead of "Event"**: lists people by their real name instead of the raw technical event dropdown.
- **Reordered filter layout**: "Search" now has its own, wider row; "Category", "User", "Level" and "Date range" share the row below it.
- **24-hour Date/Time format** in the audit table (previously showed AM/PM).
- **Bugfix (Backend)**: the date-range filter returned no results for the current day in timezones behind UTC (e.g. `America/Santiago`); fixed in `buildDateRange`.

### Local AI status

- scope defined in `docs/history/ISSUES.md` (epic `AI-SUMMARY-001` and sub-items).
- AI positioned as ephemeral, controlled operational assistance (no end-user chat).
- current status: planned/documented, not enabled in production.

---

## Quick Start with Docker

```bash
# 1. Prepare variables
cp .env.example .env

# 2. Edit required credentials
#    - MONGO_ROOT_PASSWORD
#    - ADMIN_PASSWORD
#    - JWT_SECRET
#    - ENCRYPTION_KEY
#    - COMPLEMENT_TOKEN_SECRET
#    - (Optional) GOOGLE_CLIENT_ID / AZURE_CLIENT_ID / AZURE_TENANT_ID (for SSO)
#    - (Optional) RATE_LIMIT_RESET_SECRET — rate limit reset; see docs/06_SEGURIDAD.md

# 3. Bring up the stack
docker compose up -d --build

# 4. Initialize base data
docker compose exec backend node src/scripts/seed-admin.js
# or, if you need a test environment:
docker compose exec backend node src/scripts/seed.js
```

### Already deployed: just bring it up or update

```bash
# Bring it up (already downloaded, just needs to start)
docker compose build --no-cache && docker compose up -d

# Update to the latest version
git pull origin main && docker compose build --no-cache && docker compose up -d
```

Default access:

- frontend (Docker): `http://localhost`
- backend health: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/api-docs`

Quick notes:

- the project uses `docker compose`, not `docker-compose`
- the `docker-compose.complements.yml` overlay is optional and today mainly serves the lab `complement-stub`
- the `scripts/compose-up.*` and `scripts/compose-rebuild.*` scripts already include that overlay

Quick diagnostics if the backend doesn't come up:

```bash
# General status
docker compose ps

# Backend and Mongo logs
docker compose logs backend --tail=200
docker compose logs mongodb --tail=120

# Full rebuild when dependencies change
docker compose up -d --build
```

If you see missing-module errors in the backend during startup, run a rebuild to force reinstalling the image's dependencies.

---

## Quick UI preview

Condensed visual gallery of the product. For the full set, see `docs/SCREENSHOTS.md`.

### Main screens

![Main screen](docs/images/screenshots/01-main-nueva-entrada.png)

![Retro CRT Login screen](docs/images/screenshots/13.1-Login.png)

![Report generator](docs/images/screenshots/04-generador-reportes.png)
![Report generator](docs/images/screenshots/04.1-generador-reportes.png?v=1)
![Report generator](docs/images/screenshots/04.2-generador-reportes.png?v=1)

![Admin configuration](docs/images/screenshots/05-menu-configuracion.png)
![Admin configuration](docs/images/screenshots/05.1-menu-configuracion.png?v=1)

![Shifts module](docs/images/screenshots/11-Turnos.png?v=1)

![Backup module](docs/images/screenshots/06-menu-admin-backup.png)

![Security configuration (HTTPS & SSO)](docs/images/screenshots/15-HTTPS-SSO.png)

> 💡 **Note on the Security Console (HTTPS & SSO):** The unified HTTPS and Single Sign-On (SSO) panel is fully integrated. Support for **HTTPS** certificate injection and rotation (zero-downtime) is highly functional and stable, while SSO login (Google/Microsoft) is available as a base scheme (subject to configuration and final testing with the corporate identity provider).

---

## Local development

### Backend

```bash
cd backend
cp .env.example .env
pnpm install
pnpm run dev
```

### Frontend

```bash
cd frontend
pnpm install
pnpm start
```

Package manager policy:

- This repository uses `pnpm@11` exclusively.
- Do not use `npm` to install or run scripts.
- See details in `docs/PNPM_POLICY.md`.

Local access:

- frontend dev: `http://localhost:4200`
- backend dev: `http://localhost:3000`

The current frontend uses an HttpOnly `auth_token` cookie and bootstraps the session via `/api/users/me`, so the backend must have `ALLOWED_ORIGINS=http://localhost:4200` set in development.

---

## Complements

The complements module currently supports two production-ready paths:

1. manual registration of an already-deployed service or frontend
2. managed publishing of a static `simple HTML/JS` ZIP

The `validate -> preview -> publish` flow already exists in the admin console, but automatic publishing today only supports `static-html`. The `Vite`, `React + Vite` and `Node.js` stacks are analyzed, but must be deployed externally and then registered manually.

Full details are in `docs/COMPLEMENTS.md`.

### Complements under `Extras/`

The `Extras/` folder includes ready-to-use complements and samples for lab work, QA or publishing as `zip-static`:

- `Extras/doom-browser/`: static complement to run DOOM in an embedded browser.
- `Extras/diccionario-logs-ciber/`: static log-helper/technical-dictionary complement for SOC analysis.
- `Extras/complement-stub/`: minimal complement stub for Docker integration testing.
- `Extras/complement-samples/`: reference examples (`no-db-static`, `internal-db-local`, `external-db-api`) to speed up new development.
- `Extras/Imagenes/`: supporting screenshots of tools/complements for operational documentation.

The catalog of test complements (with image and short description) is in `docs/COMPLEMENTS_CATALOG.md`.

---

## Repository structure

```text
BitacoraSOC/
|- backend/                  Express API, models, routes, utilities
|- frontend/                 Angular SPA
|- docs/                     Technical and operational documentation
|- scripts/                  Support scripts for compose and versioning
|- docker-compose.yml        Main stack
|- docker-compose.complements.yml
`- .env.example             Global variable template
```

---

## Documentation

Main documents (Harmonized Governance) — currently written in Spanish:

- `docs/01_ARQUITECTURA.md`: System architecture, Mermaid flows and TLS/SSL design.
- `docs/02_DESPLIEGUE_Y_CONFIG.md`: Installation guide, environment variables (.env) and Docker Compose deployment.
- `docs/03_OPERACIONES.md`: General operations guide, logbooks, shift checklists, user roles, backup/restore and the SOC runbook.
- `docs/04_DESARROLLO_Y_API.md`: REST API documentation, Swagger and integrated endpoints.
- `docs/05_MODULOS_EXTRAS.md`: Management and integration of the complements module and sandboxed iframe.
- `docs/06_SEGURIDAD.md`: Hardening, Helmet, rate limiting, Zip Slip mitigation and security directives.
- `docs/07_MONGO_REPLICA_SET.md`: Optional guide for configuring a MongoDB Replica Set for high availability.
- `docs/SCREENSHOTS.md`: Visual gallery of the interface and main modules.
- `docs/api-v1-manual.md`: Technical manual for the external v1 API, with Postman and SOAR integration examples.
- `CHANGELOG.md`: History of relevant changes and version control for the project.
- `docs/history/ISSUES.md`: SOC work plan and issue tracking.

Complementary functional documents:

- `docs/UI-GOVERNANCE.md`: Interface and component development standards.

---

## License

The project is distributed under the Business Source License 1.1. See `LICENSE.md` for the formal details.
The file includes the base text in English and an informational section in Spanish to ease reading.
