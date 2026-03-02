# 🧭 Arquitectura y Flujos - Bitacora SOC

Documentacion visual del funcionamiento general del sistema.

> Estado: Arquitectura en evolución (beta). Los módulos clave ya están operativos y separados por dominio funcional.

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
  API-->>FE: JWT
  FE->>API: Request con Bearer token
  API->>AUD: Registra evento (entry.create, shiftcheck.submit, etc.)
  API-->>FE: Respuesta
```

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
