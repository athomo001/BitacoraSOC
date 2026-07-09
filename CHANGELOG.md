# Changelog - Bitácora SOC

Todos los cambios notables en este proyecto serán documentados en este archivo.

---

## [1.1.0] - 2026-07-09

### Added (Añadido)
* **Sistema de API Keys Robustas (Seguridad y Auditoría):**
  * CRUD administrativo completo para gestionar credenciales de API Key con hash SHA-256 en base de datos.
  * Control de acceso basado en permisos granulares (scopes): `users:read`, `events:read`, `events:write`, `escalations:read`, `templates:render`.
  * Middleware de autenticación y simulación de usuario analista virtual para mantener la trazabilidad de auditorías originales.
* **Registro de Auditoría de API (Logs en Tiempo Real):**
  * Interceptación asíncrona del ciclo de respuesta para guardar IP, endpoint, método, estado HTTP y detalles en base de datos sin afectar la latencia del cliente.
  * Vista de logs en tiempo real integrada en el panel administrativo del SOC con paginación interactiva.
* **Endpoint de Renderizado y Despacho SMTP Integrado:**
  * Exposición de ruta `POST /api/v1/templates/render` para procesamiento MJML.
  * Soporte opcional para envío automático de correos electrónicos vía SMTP del SOC mediante el parámetro `"sendEmail": true` en el JSON Payload.
  * Reutilización de la lógica nativa del logo de Netics (incluyendo delineado blanco por Sharp) para asegurar consistencia con los reportes manuales.
* **Documentación Técnica de Integración:**
  * Creación del manual detallado en [api-v1-manual.md](docs/api-v1-manual.md) con ejemplos funcionales para Postman, cURL, Python y JavaScript.
  * Sección interactiva de ayuda y guía paso a paso para pruebas de Postman integrada en el panel de integraciones del frontend del SOC.

### Changed (Modificado)
* Migración del frontend para integrar la pestaña "Credenciales / API Keys" bajo la ruta `/main/admin/integrations?type=api-keys` de Angular.
* Corrección en el compilador estricto de Angular de producción para escapar llaves ICU de ejemplos en plantillas HTML.
