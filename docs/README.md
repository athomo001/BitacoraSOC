# Documentación de Bitácora Ops

## ¿Qué necesitas?

| Quiero… | Lee |
| --- | --- |
| Saber qué hace cada pantalla | [Guía de uso](guia-de-uso.md) |
| Instalarlo (desarrollo o producción) | [Instalación](instalacion.md) |
| Saber qué significa cada variable o ajuste | [Configuración](configuracion.md) |
| Respaldar, restaurar, actualizar o resolver un problema | [Operación](operacion.md) |
| Entender cómo está construido | [Arquitectura](arquitectura.md) |
| Integrarme por API | [API](api.md) |
| Programar en el proyecto | [Desarrollo](desarrollo.md) |
| Migrar los datos del sistema anterior | [Migración desde el legacy](migracion-legacy.md) |
| Saber por qué se decidió algo | [Decisiones (ADR)](#decisiones-de-arquitectura) |
| Ver qué cambió y cuándo | [Changelog](history/CHANGELOG.md) |

## Decisiones de arquitectura

| # | Decisión |
| --- | --- |
| [0001](adr/0001-postgresql-reemplaza-mongodb.md) | PostgreSQL reemplaza a MongoDB |
| [0002](adr/0002-backend-stdlib-sqlc-sin-chi-ni-ent.md) | Backend con la biblioteca estándar y sqlc, sin frameworks ni ORM |
| [0003](adr/0003-corte-unico-ventana-rollback-14-dias.md) | Corte único con ventana de vuelta atrás de 14 días |
| [0004](adr/0004-motor-escalacion-unificado.md) | Un solo motor de escalamiento para SOC y NOC |
| [0005](adr/0005-docker-compose-2-contenedores-sin-kubernetes.md) | Docker Compose, sin Kubernetes |
| [0006](adr/0006-ticketing-nativo-nucleo-glpi-opcional.md) | Ticketera nativa; GLPI opcional |
| [0007](adr/0007-hashing-contrasenas-bcrypt-costo-12.md) | bcrypt con costo 12 |
| [0008](adr/0008-rate-limiting-login-postgres-sin-redis.md) | Límite de login en PostgreSQL, sin Redis |
| [0009](adr/0009-system-features-y-module-flags-conviven.md) | Funcionalidades y módulos conviven |
| [0010](adr/0010-client-legacy-no-se-migra.md) | El modelo `Client` del legacy no se migra (lo reemplaza el catálogo de fuentes) |
| [0011](adr/0011-design-system-geist-sans-paleta-grafito.md) | Sistema de diseño: Geist Sans y JetBrains Mono sobre paleta grafito |
| [0012](adr/0012-repo-monolito-carpetas-nuevas.md) | Un repositorio con carpetas nuevas para la 2.0 |
| [0013](adr/0013-nombre-producto-bitacora-ops.md) | El producto se llama "Bitácora Ops" |

## Historial

- [CHANGELOG](history/CHANGELOG.md): qué se construyó en cada etapa.
- [ISSUES](history/ISSUES.md): plan de trabajo y control de tareas del legacy (histórico).
- [Pendientes cerrados](history/pendientes-cerrados.md): lo que salió de `spec/12-pendientes.md` al quedar hecho o decidido.
