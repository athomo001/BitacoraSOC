---
status: accepted
---

# Backend Go: `net/http.ServeMux` + `sqlc`/`pgx`, sin `chi` ni `ent`

Hubo idas y vueltas reales dentro de la propia spec sobre estas dos elecciones, así que se registran explícitamente para que no se reabran sin razón nueva. **Router**: se descartó `chi` a favor del `net/http.ServeMux` estándar de Go 1.22+ — la razón original para `chi` (routing con parámetros de ruta) ya no aplica porque Go 1.22+ lo soporta nativo, y TLS/reverse-proxy lo resuelve Caddy delante del binario, no una librería de routing. **Acceso a datos**: se descartó `ent` (ORM con generación de grafo de entidades) a favor de `sqlc` (SQL puro anotado + codegen tipado) — evita la curva de aprendizaje y las abstracciones de un ORM completo para un equipo de 1-2 personas, a costa de mantener archivos `.sql` explícitos por dominio (mitigado con convención de organización por archivo, ver `02-alcance-y-roadmap.md` sección 3 punto 6). Ambos son elecciones caras de revertir (tocan cada handler y cada query del backend).

## Opciones consideradas
- `chi` — descartado: valor original (routing enriquecido) ya cubierto por stdlib desde Go 1.22.
- `ent` — descartado: generación de grafo de entidades y su propio DSL agregan complejidad que un equipo chico no necesita; `sqlc` da tipado sin ese costo.
