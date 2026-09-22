---
status: accepted
---

# Rate limiting de login respaldado en Postgres, sin Redis

El barrido de gaps encontró que el núcleo nuevo no tenía protección anti-fuerza-bruta por IP (el legacy sí, `middleware/rate-limiter.js`). Para el login (defensa dura, no de mejor esfuerzo) se decidió **`login_rate_limits` respaldado en PostgreSQL** en vez de sumar Redis como pieza nueva de infraestructura — necesario para que el límite sea correcto entre los 2 nodos del clúster HA opcional, no solo dentro de un proceso. Para la API general (control de mejor esfuerzo, no de seguridad dura) se mantiene **en memoria por nodo**, aceptando el mismo trade-off que el legacy ya documentaba (el cupo efectivo casi se duplica con HA activo). Se prefirió esto sobre agregar Redis para evitar una pieza de infraestructura nueva que un equipo de 1-2 personas tendría que operar y mantener solo para este propósito. Ver `07-backend-arquitectura-go.md` sección 6.3.
