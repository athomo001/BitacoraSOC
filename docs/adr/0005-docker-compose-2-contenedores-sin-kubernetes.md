---
status: accepted
---

# Despliegue en Docker Compose de 2 contenedores, sin Kubernetes

Un borrador temprano de la sección de alta disponibilidad (`09-alta-disponibilidad-2-nodos.md`) traía Kubernetes como plataforma de despliegue. Se descartó explícitamente: el equipo es de 1-2 personas sin operación de clúster K8s, y el objetivo real (HA opcional de 2 nodos con failover) se resuelve completo con **Docker Compose de 2 contenedores** (`bitacora-app`: binario Go que embebe el build de Angular vía `//go:embed`; `bitacora-db`: PostgreSQL 18 con `ltree`) más `pg_auto_failover` y WireGuard site-to-site para el caso HA — sin el costo operativo de mantener un control-plane de Kubernetes para dos nodos. Caddy/nginx como reverse proxy delante resuelve TLS con renovación automática, eliminando también la necesidad de un `SNICallback` custom que el legacy mantenía a mano. Difícil de revertir una vez construida la topología de despliegue y los scripts de failover alrededor de Compose.
