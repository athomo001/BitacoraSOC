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
  "collections": 32,
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
      "_id": "backup-2026-03-06T18-54-19-392Z.zip",
      "filename": "backup-2026-03-06T18-54-19-392Z.zip",
      "createdAt": "2026-02-08T18:22:10.123Z",
      "size": 2489012
    }
  ]
}
```

Nota: el historial puede mostrar `.json` legacy, pero los respaldos actuales manuales y automáticos se generan como `.zip`.

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
- El restore descomprime el archivo `.zip` y restaura tanto la base de datos como `uploads/`, `secrets/` y el directorio opcional `global/` cuando existe en el respaldo.
- La restauración recorre subdirectorios, por lo que también repone logos, favicons y artefactos publicados bajo `uploads/complements/`.
- Los certificados TLS guardados por la plataforma via `secrets/` quedan cubiertos dentro del mismo restore.

### Eliminar backup

**Endpoint:** `DELETE /api/backup/:id` (admin)

Ejemplo: `DELETE /api/backup/backup-2026-03-06T18-54-19-392Z.zip`

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

## 📥 Importacion ZIP Completo o JSON

**Endpoint:** `POST /api/backup/import` (admin)

**Contenido:** `multipart/form-data`
- `file`: archivo `.zip` (completo: BD + uploads + secrets) o `.json` (legacy)
- `clearBeforeRestore`: opcional; si llega en `true`, limpia primero las colecciones antes de importar.

**ZIP:** Contiene `data.json` + directorio `/uploads` + directorio `/secrets` (certificates) + directorio opcional `/global`. Se restauran todos los archivos fisicos de forma recursiva.

**JSON Legacy:** Solo BD, útil para importación puntual de datos antigios.

Independientemente del formato, se importan todas las 32 colecciones de base de datos de forma dinámica.

Nota operativa: el proxy web del frontend acepta importaciones de backup de hasta `100M` y extiende timeouts a `300s` para evitar rechazos `413` en respaldos grandes.

---

## 🧹 Purga controlada

**Endpoint:** `POST /api/backup/purge` (admin)

**Notas:**
- La purga elimina el contenido operativo de base de datos y limpia los directorios fisicos restaurables del Core (`uploads/`, `secrets/` y `global/` si existe).
- Tras la purga, el sistema recrea automaticamente la cuenta administrativa por defecto tomando `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ADMIN_EMAIL` desde `.env`.
- Este flujo sirve para rearmar una instancia desde cero sin perder el acceso inicial de administracion.

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
- La configuración GLPI, RACI, turnos de trabajo, cierres, notificaciones de checklist y metadatos de complementos quedan dentro del backup general del Core.
- Los artefactos publicados `uploads/complements/published/<slug>/` deben considerarse parte del respaldo del volumen de uploads.
- Los previews `uploads/complements/preview/<previewId>/` son temporales y hoy no tienen limpieza automática; no conviene tratarlos como artefacto permanente de respaldo.
