---
status: accepted
---

# Hashing de contraseñas: bcrypt costo 12, no Argon2id

El legacy hashea con `bcryptjs` costo 8 (`backend/src/models/User.js`). Al decidir el algoritmo para el backend Go se consideró Argon2id (recomendación actual de OWASP para hashing nuevo) contra mantener bcrypt, y se eligió **bcrypt** (`golang.org/x/crypto/bcrypt`, costo 12 para hashes nuevos) explícitamente por continuidad: un hash bcrypt es autodescriptivo (`$2a$<costo>$...`) y verifica sin cambios sin importar el costo embebido, así que los `password_hash` migrados tal cual desde Mongo (costo 8) siguen siendo válidos el día del corte sin resetear contraseñas de nadie. Cambiar a Argon2id habría exigido una migración de doble-hash o un reseteo masivo forzado, costo que no se justificaba sin una razón de seguridad concreta. Los hashes heredados se suben a costo 12 de forma transparente vía re-hash oportunista en el primer login exitoso post-corte. Ver `07-backend-arquitectura-go.md` sección 6.5.

## Opciones consideradas
- Argon2id — descartado ahora: exige romper la compatibilidad directa con los hashes bcrypt migrados del legacy (doble-hash o reseteo forzado) sin una necesidad de seguridad concreta que lo justifique hoy.
