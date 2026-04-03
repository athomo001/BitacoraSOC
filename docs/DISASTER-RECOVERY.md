# Recuperacion Ante Desastres (DR)

Procedimiento oficial para recuperar Bitacora SOC ante perdida parcial o total del servicio.

---

## 1. Alcance

Este runbook cubre:

- perdida de contenedores
- perdida de volumen de MongoDB
- perdida de archivos de uploads y backups
- recuperacion completa desde cero con respaldos

No cubre la recuperacion interna de bases privadas de un complemento externo. Esa responsabilidad recae en cada complemento.

---

## 2. Objetivos de continuidad

- RTO objetivo: restaurar servicio base en menos de 2 horas
- RPO objetivo: perder como maximo la ventana entre ultimo backup valido y la falla

Los valores reales dependen de la frecuencia de backups y del almacenamiento externo disponible.

---

## 3. Inventario minimo a respaldar

Respaldo obligatorio:

- backup de aplicacion (`backup-*.zip`) en `./.data/backups`
- archivo `.env` seguro y versionado fuera del host
- carpeta `./.data/uploads` (logos y artefactos publicados)
- carpeta `./.data/tls` (si se usan certificados propios)

Complementos:

- DB privada `bitacora_ext_*` se respalda fuera del core
- `ComplementSharedRecord` y `browser-state` si quedan en backup core

---

## 4. Escenarios de desastre

## 4.1 Falla de contenedor sin perdida de datos

1. Validar estado:

```bash
docker compose ps
docker compose logs backend --tail=200
```

2. Reconstruir servicio afectado:

```bash
docker compose up -d --build backend
```

3. Validar `health` y login.

## 4.2 Corrupcion o perdida de MongoDB

1. Detener stack:

```bash
docker compose down
```

2. Aislar volumen dañado (renombrar, no borrar de inmediato):

- `./.data/mongodb_data` -> `./.data/mongodb_data_corrupt_YYYYMMDD`

3. Levantar stack limpio:

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

4. Restaurar backup valido por API o proceso manual.

5. Validar consistencia funcional.

## 4.3 Perdida total del host

1. Provisionar nuevo host.
2. Clonar repositorio y restaurar `.env`.
3. Restaurar carpetas persistentes desde almacenamiento externo:

- `.data/backups`
- `.data/uploads`
- `.data/tls`

4. Levantar stack.
5. Ejecutar restore del ultimo backup valido.
6. Verificar usuarios, bitacora, checklist y complementos.

---

## 5. Procedimiento de recuperacion completa

## 5.1 Preparacion

1. confirmar ultimo backup integro (`.zip`)
2. tener hash o checksum si existe
3. notificar ventana de mantenimiento

## 5.2 Restaurar plataforma base

1. copiar `.env` correcto
2. levantar stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

3. comprobar `http://localhost:3000/health`

## 5.3 Restaurar datos

Via API (recomendada):

1. login admin
2. `POST /api/backup/restore` con `clearBeforeRestore=true`
3. esperar finalizacion y revisar auditoria `admin.backup.*`

Nota: si no existe admin tras desastre extremo, ejecutar primero:

```bash
docker compose exec backend node src/scripts/seed-admin.js
```

## 5.4 Restaurar complementos

1. validar registros en `Admin > Complementos`
2. validar artefactos publicados en `uploads/complements/published`
3. restaurar por separado DB privada de cada complemento externo
4. ejecutar prueba de conectividad por complemento

---

## 6. Validacion post-recuperacion

Checklist minimo:

- login admin y user
- consulta de entradas historicas
- registro de nueva entrada
- registro de checklist
- `GET /api/backup/history`
- auditoria operativa visible
- complementos activos cargan sin estado `OPEN`

Si algun control falla, mantener sistema en modo mantenimiento y abrir incidente de recuperacion.

---

## 7. Fallas y rollback de recuperacion

## 7.1 Restore incompleto

Sintoma: colecciones faltantes o errores al restaurar.

Accion:

1. revisar logs backend
2. repetir restore con backup anterior
3. documentar backup defectuoso y retirarlo de rotacion

## 7.2 Servicio restaura pero no autentica

Sintoma: login falla tras restaurar.

Accion:

1. validar `JWT_SECRET` y `ENCRYPTION_KEY`
2. confirmar existencia de usuario admin
3. recrear admin con `seed-admin.js` si corresponde

## 7.3 Complementos visibles pero sin contenido

Sintoma: iframe en blanco o mantenimiento permanente.

Accion:

1. validar archivos en `uploads/complements/published/<slug>/`
2. validar healthPath/baseUrl
3. regenerar token y actualizar secreto en servicio externo

---

## 8. Pruebas periodicas de DR

Frecuencia recomendada: mensual en entorno de ensayo.

Ejercicio minimo:

1. restaurar ultimo backup en entorno limpio
2. ejecutar checklist de validacion post-recuperacion
3. medir tiempos reales RTO/RPO
4. ajustar procedimiento si hay desvio

---

## 9. Gobierno de respaldo

- mantener al menos 3 puntos de restauracion
- guardar una copia fuera del host principal
- etiquetar backups por criticidad y fecha
- prohibir uso de backups no verificados en restauraciones de emergencia
