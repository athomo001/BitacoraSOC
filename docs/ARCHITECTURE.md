# 🧭 Arquitectura y Flujos - Bitacora SOC

Documentacion visual del funcionamiento general del sistema.

> Estado: Arquitectura en evolución (beta). Los módulos clave ya están operativos y separados por dominio funcional.
>
> Referencia visual de pantallas: ver `docs/SCREENSHOTS.md` para capturas reales de la interfaz.

---

## 🗺️ Mapa Conceptual (alto nivel)

```mermaid
flowchart LR
  U[Usuarios SOC] -->|UI Web| FE[Angular 20 SPA]
  FE -->|REST| BE[Express API]
  BE --> DB[(MongoDB)]
  BE --> SMTP[Servidor SMTP]
  BE --> SIEM[SIEM/SOAR Syslog/TLS]
  BE --> FS[Uploads y Backups]
  FE -->|iframe sandbox| CUI[Complementos UI]
  CUI -->|App Token| INT[/API Interna v1/]
  INT --> BE

  subgraph Schedulers
    CRON[Shift Scheduler] --> BE
    ALERT[Checklist Alert Scheduler] --> BE
  end
```

---

## 🧩 Módulos Administrativos (Frontend)

```mermaid
flowchart TD
  A[/main/admin/] --> B[Users]
  A --> C[Checklist Admin]
  A --> D[Work Shifts]
  A --> E[Catalog Admin]
  A --> F[Escalación Admin]
  A --> G[SMTP]
  A --> H[Integraciones SIEM/SOAR/NDR]
  A --> I[GLPI]
```

- Integraciones SIEM/SOAR/NDR y GLPI quedaron separados por diseño.
- GLPI opera como módulo independiente (API REST o correo collector).

---

## 🔐 Flujo de Autenticacion y Auditoria

```mermaid
sequenceDiagram
  participant User as Usuario
  participant FE as Frontend
  participant API as Backend
  participant DB as MongoDB
  participant AUD as AuditLog

  User->>FE: Login
  FE->>API: POST /api/auth/login
  API->>DB: Verifica usuario
  API->>AUD: Registra auth.login.*
  API-->>FE: Cookie HttpOnly auth_token + user base
  FE->>API: APP_INITIALIZER -> GET /api/users/me
  FE->>API: Requests con withCredentials
  API->>AUD: Registra evento (entry.create, shiftcheck.submit, etc.)
  API-->>FE: Respuesta
```

- La sesión web usa cookie `auth_token` HttpOnly.
- El frontend rehidrata sesión al arrancar usando `/api/users/me`.

---

## 📧 Flujo de Reporte de Turno

```mermaid
flowchart TD
  A[Fin de turno] --> B{Scheduler o Cierre manual}
  B --> C[Recolecta check inicio/cierre]
  C --> D[Recolecta entradas del periodo]
  D --> E[Genera HTML + texto]
  E --> F[Envia correo SMTP]
```

### Flujo de Boletín de Seguridad (actual)

```mermaid
sequenceDiagram
  participant U as Usuario autenticado
  participant FE as Report Generator (Angular)
  participant API as /api/reports/newsletter/send
  participant SMTP as Servidor SMTP

  U->>FE: Completa formulario Boletín + Generar
  FE->>FE: Precheck HTML (logo, color, secciones)
  U->>FE: Enviar a destinatarios
  FE->>API: POST newsletter/send (recipients[], cc[], subject, html)
  API->>SMTP: Envío 1:1 por destinatario + CC interno opcional
  API-->>FE: successCount/failCount + detalle
```

### Flujo objetivo IA local (planificado)

```mermaid
flowchart LR
  T[Eventos del turno] --> B[Backend Orchestrator]
  B --> O[Ollama local efímero]
  O --> S[Resumen estructurado]
  S --> N[Boletín/Correo]
  B --> A[AuditLog técnico]
```

- Este flujo IA está en preparación documental (`AI-SUMMARY-001`) y aún no está habilitado en producción.

---

## 🔌 Flujo de Integraciones (SIEM + GLPI)

```mermaid
flowchart LR
  AUD[AuditLog] --> FW[logForwarder]
  FW --> SIEM1[Conector SIEM #1]
  FW --> SIEM2[Conector SOAR/NDR #2]
  FW --> SIEMN[Conector N]

  ADMIN[Admin > GLPI] --> GLPIAPI[/api/glpi/config,/test]
  GLPIAPI --> GLPIREST[GLPI REST apirest.php]
  GLPIAPI --> GLPIMAIL[Correo collector GLPI]
```

- Forwarding SIEM soporta múltiples destinos activos en paralelo.
- GLPI tiene configuración propia y prueba de conectividad independiente.

---

## 🧩 Complementos

```mermaid
flowchart LR
  ADMIN[Admin UI] --> CRUD[/api/complements]
  ADMIN --> ZIP[/source validate preview publish/]
  CRUD --> ORCH[Complement Manager]
  ZIP --> ORCH
  ORCH --> GDB[(MongoDB General)]
  ORCH -. wipe-out seguro .-> PDB[(bitacora_ext_*)]
  ORCH --> PRE[/uploads/complements/preview/]
  ORCH --> PUB[/uploads/complements/published/]
  ORCH --> AUD[AuditLog complement.*]
  ORCH --> CIR[Circuit Breaker]
  CIR --> SLOT[Complement Container iframe]
  FE[Angular SPA] --> SLOT
  SLOT --> BRIDGE[Complement Bridge]
  BRIDGE --> INT[/API Interna v1/]
  INT --> ORCH
```

```mermaid
sequenceDiagram
  participant ADMIN as Admin
  participant UI as Admin Complementos
  participant API as /api/complements
  participant PUB as Publicador ZIP

  ADMIN->>UI: Sube ZIP
  UI->>API: POST /source/validate
  API-->>UI: Stack detectado + config sugerida
  UI->>API: POST /source/preview
  API->>PUB: Extrae a preview/<previewId>
  API-->>UI: previewUrl
  UI->>API: POST /source/publish
  API->>PUB: Publica en published/<slug>
  API-->>UI: Complemento activo
```

```mermaid
sequenceDiagram
  participant I as Iframe
  participant B as Bridge Angular
  participant API as /api/internal/v1
  participant DB as MongoDB

  I->>B: REQUEST_CONTEXT
  B-->>I: CONTEXT_UPDATE
  I->>API: POST /log-entry
  API->>DB: Insert Entry ownerComplementId
  API-->>I: 201 Created
```

- La publicación automática hoy solo soporta ZIP `static-html`.
- `browser-state` y `shared_storage` viven en `ComplementSharedRecord` dentro de la base general.
- `v2` existe en discovery/modelo, pero no es aún una API interna funcional.
