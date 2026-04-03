# 💾 Backup y Recuperacion - Bitacora SOC

Procedimientos de respaldo, restauracion e importacion/exportacion.

Para recuperacion completa ante desastre (host perdido, volumen dañado, reconstruccion total), usar `DISASTER-RECOVERY.md`.

---

## ✅ Respaldo Multicolección (ZIP)

### Crear backup

**Endpoint:** `POST /api/backup/create` (admin)

**Respuesta:**
```json
{
  "message": "Backup completo creado exitosamente",
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "collections": 24,
  "documents": 10,
  "sizeBytes": 3489
}
```

### Historial

**Endpoint:** `GET /api/backup/history` (admin)

**Respuesta:**
```json
{
  "backups": [
    {
      "_id": "backup-2026-02-08T18-22-10-123Z.json",
      "filename": "backup-2026-02-08T18-22-10-123Z.json",
      "createdAt": "2026-02-08T18:22:10.123Z",
      "size": 2489012
    }
  ]
}
```

### Restaurar backup

**Endpoint:** `POST /api/backup/restore` (admin)

**Body:**
```json
{
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "clearBeforeRestore": true
}
```

**Notas:**
- `clearBeforeRestore=true` borra todas las colecciones antes de restaurar.
- El restore descomprime el archivo `.zip` en memoria y valida la estructura de cada `.json` internamente antes de aplicar.

### Eliminar backup

**Endpoint:** `DELETE /api/backup/:id` (admin)

Ejemplo: `DELETE /api/backup/backup-2026-02-08T18-22-10-123Z.json`

---

## 📤 Exportacion CSV

**Endpoint:** `GET /api/backup/export/:type` (admin)

Tipos soportados:
- `entries`
- `checks`
- `all` (exporta multiples archivos)

Ejemplo:
```bash
curl -X GET http://localhost:3000/api/backup/export/entries \
  -H "Authorization: Bearer <token-api>" \
  -o entradas.csv
```

Nota: en uso web normal, la autenticacion principal es por cookie `auth_token` HttpOnly.

---

## 📥 Importacion CSV/JSON

**Endpoint:** `POST /api/backup/import` (admin)

**Contenido:** `multipart/form-data`
- `file`: archivo `.json` o `.csv`
- `type`: `entries` | `checks` | `users` | `catalogs` (segun el formato)

---

## 🗂️ Ubicacion de archivos

Los backups comprimidos `.zip` se guardan en:
- **Local:** `backend/backups/`
- **Docker:** Volumen mapeado a `./.data/backups/` en el host, montado en `/app/backups/` dentro del contenedor.

---

## 🔒 Seguridad

- Solo admin puede crear/restaurar/importar/eliminar.
- Auditoria de operaciones: `admin.backup.*`.
- Sanitizacion de rutas y validacion de nombres de archivo.

## 🧩 Complementos

- El backup general del Core no incluye automáticamente las DB privadas `bitacora_ext_*`.
- Cada complemento debe respaldar su propia base privada.
- El wipe-out de un complemento elimina su DB privada y purga artefactos generales vinculados por `ownerComplementId`.
- El almacenamiento compartido del complemento (`ComplementSharedRecord`) sí queda dentro del backup general del Core.
- El estado guardado vía `/api/complements/:slug/browser-state` también queda dentro del backup general porque usa esa misma colección compartida.
- Los artefactos publicados `uploads/complements/published/<slug>/` deben considerarse parte del respaldo del volumen de uploads.
- Los previews `uploads/complements/preview/<previewId>/` son temporales y hoy no tienen limpieza automática; no conviene tratarlos como artefacto permanente de respaldo.
