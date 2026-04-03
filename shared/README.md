# Shared Schemas

Contratos JSON compartidos entre Core, frontend y complementos.

- `complement.schema.json`: registro administrativo y permisos del complemento.
- `complement-context.schema.json`: payload de `/api/internal/v1/context`.
- `complement-event.schema.json`: protocolo de eventos `postMessage` Core ↔ iframe.

Estos archivos son la fuente de verdad para validación en backend y tipado en frontend.