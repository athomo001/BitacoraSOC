# Arquitectura General

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

### 🔑 Flujo de Autenticación de Terceros (SSO)

```mermaid
sequenceDiagram
  participant User as Analista
  participant FE as Frontend (Angular)
  participant Providers as Proveedor SSO (Google/MS)
  participant API as Backend (Express)
  participant DB as MongoDB

  User->>FE: Click "Iniciar sesión con Google/Microsoft"
  FE->>Providers: Redirección / Solicitud de Autenticación
  Providers-->>FE: Retorna ID Token / Token de Acceso
  FE->>API: POST /api/auth/sso (idToken / provider)
  API->>Providers: Valida token con API pública del proveedor
  API->>DB: Busca usuario por hash determinista SHA-256 de email
  API-->>FE: Cookie HttpOnly auth_token + Datos de usuario
```

### 🔐 Flujo de Autenticación Multifactor (MFA - TOTP)

El sistema soporta MFA por software (TOTP - RFC 6238). Por defecto está desactivado. El administrador lo habilita individualmente por usuario.

```mermaid
sequenceDiagram
  participant User as Analista
  participant FE as Frontend (Angular)
  participant API as Backend (Express)
  participant DB as MongoDB

  User->>FE: Hace Login (Base o SSO)
  FE->>API: POST /api/auth/login o /api/auth/sso
  API->>DB: Verifica credenciales
  Note over API: Si MFA está habilitado por el Admin
  API-->>FE: Retorna HTTP 200 con status "MFA_PENDING"
  Note over FE: Redirecciona a pantalla de verificación TOTP
  User->>FE: Introduce código TOTP de su app Authenticator
  FE->>API: POST /api/auth/verify-mfa (código TOTP)
  API->>API: Verifica código temporal
  API-->>FE: Retorna cookie de sesión final auth_token
```

### 🔒 Arquitectura de Privacidad y Cifrado PII

Para asegurar el cumplimiento de privacidad de la información personal identificable (PII), los campos `email` y `phone` se protegen mediante criptografía fuerte en MongoDB:
1. **Cifrado Probabilístico:** Se utiliza **AES-256-GCM** con un Vector de Inicialización (IV) aleatorio por cada registro. Esto garantiza que el mismo correo cifrado dos veces tenga salidas cifradas distintas en base de datos.
2. **Búsqueda Indexada Determinista:** Se genera un hash **SHA-256** determinista de los campos PII (`emailHash` y `phoneHash`) indexados en MongoDB. De este modo, las búsquedas por correo se resuelven de forma extremadamente rápida sin descifrar toda la colección.

### ⚡ Paginación Nativa en Base de Datos (`$unionWith`)

Para optimizar el rendimiento y evitar el consumo excesivo de memoria Heap en el backend al mezclar registros de `Entry` y `ShiftCheck`, la paginación y ordenamiento se delegan por completo a MongoDB utilizando la etapa `$unionWith`. El pipeline unifica las colecciones, aplica `$sort` por fecha, y segmenta con `$skip` y `$limit` de forma nativa antes de poblar las referencias de usuarios.

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
  FE->>API: POST newsletter/send (recipients[], cc[], groupByDomain, subject, html)
  API->>API: Valida conflicto Para/CC (si repite correo => 400)
  API->>SMTP: Envío por dominio (default) o 1:1 + CC interno opcional
  API-->>FE: successCount/failCount + processedGroups + detalle
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


# Arquitectura TLS/SSL

# Arquitectura TLS/SSL en Bitácora SOC (Implementación Detallada)

Este documento explica en profundidad técnica el diseño, la implementación y el funcionamiento de la capa de seguridad TLS/SSL en el proyecto **Bitácora SOC**. Este sistema fue diseñado para ofrecer máxima seguridad (E2E encryption), alta disponibilidad (cero caídas al rotar certificados) y tolerancia a fallos en el arranque inicial.

---

## 1. Diagrama de Arquitectura Global

El siguiente diagrama ilustra cómo se estructuran y se comunican los componentes en la red de Docker para proveer una conexión cifrada, así como el flujo de recarga de certificados "En Caliente" (Hot Reload):

```mermaid
sequenceDiagram
    participant Admin as Administrador
    participant Nginx as Frontend (Nginx Proxy)
    participant API as Backend (Node.js)
    participant DB as MongoDB (AppConfig)
    
    Note over Nginx: Arranque Inicial<br/>Si no hay certs, genera Dummy Cert auto-firmado
    
    Admin->>Nginx: Accede a panel HTTPS (Auto-firmado)
    Nginx->>API: /api/config/security/certificates (POST)
    Note over API: 1. tls-validator.js (Validación Matemática)
    Note over API: 2. Guarda en disco (.data/tls)
    API->>DB: Guarda paths en colección AppConfig
    Note over API: 3. Ejecuta applyRuntimeSecurityConfig()
    Note over API: 4. SNICallback actualiza SecureContext en memoria
    API-->>Admin: 200 OK - HTTPS Activado
    
    Note over Nginx: Siguiente Petición
    Admin->>Nginx: Usa API
    Nginx->>API: Petición HTTPS Nativa proxy_pass
    Note over API: Responde con el nuevo certificado sin reiniciar
```

---

## 2. Capa Frontend: Proxy Nginx y Contenedor Tolerante a Fallos

Nginx sirve como el servidor perimetral que presenta la interfaz SPA de Angular y hace de proxy reverso hacia el backend.

### 2.1. Problema del Huevo y la Gallina en Docker
Si configuras Nginx para escuchar en el puerto `443` activando `ssl_certificate`, Nginx fallará catastróficamente **si esos archivos no existen en disco** al momento del arranque. En un despliegue virgen, el usuario aún no ha tenido oportunidad de subir certificados.

### 2.2. Solución: Generación de Certificados Dummy en el Arranque
Para asegurar que el contenedor inicie siempre, el `Dockerfile` del frontend incluye el binario `openssl`, y el `docker-compose.yml` inyecta un script de comprobación antes de arrancar Nginx:

**En `docker-compose.yml`:**
```yml
    command: >
      sh -c ' if [ ! -f /etc/nginx/certs/cert.pem ]; then
        echo "Generando certificados autofirmados dummy para arranque inicial...";
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/nginx/certs/key.pem -out /etc/nginx/certs/cert.pem -subj "/CN=localhost";
      fi; nginx -g "daemon off;" '
```
**Resultado**: Si el directorio `/etc/nginx/certs` está vacío, se crea un certificado autofirmado que permite que Nginx arranque. Luego, el administrador accederá (aceptando la advertencia del navegador) y usará la app para subir los certificados reales.

---

## 3. Capa Backend: Hot Reloading y SNICallback en Express.js

La "magia" para poder recargar certificados y habilitar/deshabilitar HTTPS **sin reiniciar ni detener el backend** reside en el uso del contexto de servidor dual y el `SNICallback`.

### 3.1 Servidor Dual Plegable
El backend de Bitácora levanta en HTTP (por defecto puerto 3000) de manera obligatoria. El servidor HTTPS (por defecto 3443) solo se instancia si la propiedad `httpsEnabled` en base de datos es `true`.

### 3.2. Recarga en Caliente (Hot Reloading) con SNICallback
El protocolo TLS permite que el servidor decida qué certificado proveer dependiendo del dominio que solicitó el cliente (SNI). Nosotros abusamos de este mecanismo para actualizar el certificado completo del servidor.

**Snippet en `server.js`:**
```javascript
let currentSecureContext = null;

httpsServer = https.createServer({
  SNICallback: (domain, cb) => {
    // Si hay un contexto seguro cargado en memoria, se despacha.
    // Si no lo hay, falla la negociación TLS.
    if (currentSecureContext) {
      cb(null, currentSecureContext);
    } else {
      cb(new Error('Contexto TLS no disponible'));
    }
  }
}, app);
```

Cuando un usuario sube un nuevo certificado desde el Admin Panel:
1. Se guarda en base de datos la ubicación (`secrets/...`).
2. Se llama a la función global `app.locals.applyRuntimeSecurityConfig()`.
3. Esta función lee los nuevos archivos de disco y recrea la variable `currentSecureContext` usando `tls.createSecureContext({ cert, key })`.
4. Listo. **La siguiente petición milisegundos después** recibirá el nuevo certificado, sin interrupciones.

---

## 4. Validación Matemática Estricta de Certificados (Pre-guardado)

Node.js es extremadamente frágil si le entregas un certificado y una llave que no coinciden matemáticamente; un error fatal arrojará una excepción "Uncaught Exception" que botará el proceso `node`.

Para evitar que un error humano de un admin tire la plataforma, se diseñó `backend/src/utils/tls-validator.js`:

```javascript
const validateCryptoPair = ({ certPem, keyPem, caPem }) => {
    // 1. Evitar llaves privadas cifradas con contraseña
    const keyString = String(keyPem);
    if (keyString.includes('ENCRYPTED')) {
        throw new Error('Llave privada cifrada no soportada. Sube una llave PEM sin passphrase.');
    }

    try {
        // 2. Simulamos la creación del SecureContext en un bloque try/catch
        const contextOptions = { cert: certPem, key: keyPem };
        tls.createSecureContext(contextOptions);
        return true;
    } catch (err) {
        throw new Error(`Los certificados TLS son inválidos o no corresponden: ${err.message}`);
    }
};
```
La ruta POST `/api/config/security/certificates` invoca `validateCryptoPair()` en un bloque seguro. Si los certificados no encajan, se borran inmediatamente de `/tmp/` y la API devuelve HTTP 400.

Además, con el método asíncrono `isPortFree()`, el backend intenta enlazar un socket silencioso al nuevo puerto HTTPS antes de guardarlo; si el puerto ya está en uso, se bloquea la configuración para prevenir caídas de colisión de red (EADDRINUSE).

---

## 5. Middleware de Redirección Inteligente: CORS y Status 426

Cuando el administrador marca el switch `Forzar HTTPS en Backend` (`forceHttps = true`), el backend no debe procesar nada que venga por HTTP.

**El problema con `307 Redirect`**:
Generalmente, para forzar HTTPS se devuelve un status `301` o `307` redirigiendo hacia la url con `https://`. Sin embargo, esto es veneno para SPAs (Angular) realizando peticiones AJAX/Fetch. Cuando un navegador sigue un HTTP Redirect ciego por CORS, elimina las cabeceras de `Authorization` o descarta las cookies (`withCredentials`). El usuario terminará con errores `401 Unauthorized` inexplicables y la UI colapsará.

**La Solución Amigable API - Status 426**:
El backend distingue si la petición HTTP proviene del navegador directo o de la API:

```javascript
// Si es una petición API o un Fetch XHR
if (req.path.startsWith('/api') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
  // En lugar de redirigir, abortamos con un error semánticamente correcto: "Upgrade Required"
  return res.status(426).json({
    message: 'HTTPS requerido para esta operación',
    targetUrl: `https://${targetHost}${req.originalUrl}`
  });
}

// Si es una petición de navegador normal (GET /) redirigimos tradicionalmente
if (req.method === 'GET' || req.method === 'HEAD') {
  return res.redirect(307, targetUrl);
}
```

El **HttpInterceptor de Angular** captura los errores `426 Upgrade Required`, e informa limpiamente al usuario internamente, o en un futuro podría re-intentar la petición ajustando la URL con las credenciales intactas, haciendo la UX mucho más resistente.

---

## 6. Experiencia de Usuario (Frontend): Validación y Cuenta Atrás

Dado que cambiar la configuración HTTPS del sistema (especialmente pasar de HTTP a HTTPS o cambiar el puerto) invoca un cambio drástico en la URL donde se aloja el frontend, el panel de administración (`admin-security.component.ts`) implementa un flujo a prueba de fallos de red.

**El Flujo UI:**
Cuando el administrador hace clic en "Guardar", se emite el request al backend. Inmediatamente el backend aplica el `SNICallback`, pero el navegador del usuario sigue atado a la URL HTTP/HTTPS antigua.

Para solucionar esto, Angular inicia un proceso de rescate automatizado:
1. Se despliega un SnackBar informando `Reiniciando frontend... (espere 15s)`.
2. El método interno `startCountdownAndRedirect()` bloquea el botón de guardar e inicia un `setInterval` rebajando cada segundo la cuenta atrás.
3. Al llegar a `0`, Angular manda un **Hard Redirect** a través de `window.location.href = targetUrl;`. En esa `targetUrl` Angular computa el protocolo esperado (`http://` o `https://`) basándose en los switches recién guardados.

```typescript
// admin-security.component.ts
private startCountdownAndRedirect(targetUrl: string, seconds: number = 15): void {
  this.isSaving = true;
  let remaining = seconds;
  this.countdownMessage = `(espere ${remaining}s)`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      this.countdownMessage = `(espere ${remaining}s)`;
    } else {
      this.countdownMessage = `(Recargando...)`;
      clearInterval(interval);
      window.location.href = targetUrl; // Hard reload a la nueva configuración HTTPS
    }
  }, 1000);
}
```

Esta técnica visual brinda confianza al administrador, dándole tiempo al backend a procesar la recarga TLS antes de arrastrar al navegador hacia la nueva URL segura.

---

## Resumen de Buenas Prácticas Aplicadas
- **Resiliencia al Inicio**: El contenedor se "auto-sana" generando dummy certs (Nginx/Openssl).
- **Zero-Downtime TLS Rotation**: SNICallback evita que las recargas rompan el uptime.
- **Fail-Fast Validation**: Validación matemática criptográfica previene corrupciones y caídas del core de Node.js.
- **API First Redirect**: Abandono de 3xx redirects para endpoints AJAX en favor del estado explícito 426, mejorando la fiabilidad de CORS y la retención de Sesión.
- **UX Segura (Countdown)**: Transición amigable en el Frontend para no perder al administrador durante el cambio de contexto HTTP a HTTPS.


