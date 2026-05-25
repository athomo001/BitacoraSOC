<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->

# Plan de Trabajo: Bitacora SOC

## Tablas de Control

**Alcance de seguimiento:** Las filas `AI-SUMMARY-001` ... `AI-SUMMARY-001G` se mantienen como **referencia** (especificacion/archivo), pero **no forman parte** del backlog operativo que el equipo prioriza para iteraciones UI/QA ni de las metricas por oleada historicas (`UI-MIG-060` cerrado como proceso). Para trabajo vivo: obligaciones **Recurrente**, metricas del documento `docs/UI-GOVERNANCE.md`, y nuevos `UI-*` si se abren.

### Leyenda de estados (tablas de control)

| Estado | Uso |
| :--- | :--- |
| **Pendiente** | Issue abierto aun no iniciado. |
| **En progreso** | Issue abierto con trabajo en curso. |
| **Recurrente** | Politica viva (cada PR), no se cierra como ticket unico. |
| **Archivo** | Epic/documentacion de referencia sin seguimiento operativo activo. |
| **Listo** | Issue cerrado con resultado aplicado o documentado. |

### En progreso (backlog activo)

| ID | Estado | Seccion | Tarea | Notas |
| :--- | :--- | :--- | :--- | :--- |
| SHIFT-DASH-146 | Pendiente | Admin / Turnos + UX/UI CRITICA | Diseno de Dashboard de Turnos Integrado (Operacion + Administracion) | **OBJETIVO:** Definir el rediseno integral de la vista de turnos en formato "Command Center" con alta densidad de informacion y enfoque operativo + administrativo en una sola pantalla. **IMPORTANTE:** este issue es solo de diseno/especificacion; no contempla implementacion en esta etapa. **SECCION SUPERIOR (OPERACION):** mantener encabezado "Turnos de esta Semana" + subtitulo "Personal de turno en nuestra empresa"; selector de fecha con navegacion anterior/siguiente y rango visible (`25/5 al 31-05-2026`) en cajas limpias; reemplazar cajones por grilla/tabla unificada compacta con filas por area y micro-barra lateral de color. Colores minimos requeridos: `N2 - Soporte Tecnico` magenta, `TI - Infraestructura` granate, `N1 - No Habil` azul. Por fila: columnas ordenadas para nombre, email y telefono con iconografia compacta (correo/telefono). Debe soportar multiples personas por area (ej. 2 filas en N2) y escalar verticalmente a 10+ areas sin romper layout. **SECCION INFERIOR (ADMIN):** titulo "Administracion de Turnos y Personal" con icono engranaje/usuario; formulario para nueva area (nombre, color desde paleta predefinida, icono); accion de "Anadir Personal" por area; formulario de alta/edicion de persona (Nombre Completo, Rol, Email Corporativo, Telefono); acciones de editar/eliminar (lapiz/papelera) por area y persona; zona visual drag-and-drop con bloque "Personal Disponible" para asignacion por arrastre; pie con metricas "Total de Personal Asignado: 6 | Areas Activas: 3" y CTA principal "Guardar Cambios Operativos". **LINEAMIENTOS VISUALES:** estetica moderna de command center TI, base blanca limpia, acentos vibrantes, composicion tipo Bento Grid, tipografia monospace para datos y sans-serif para interfaz, diseno compacto y legible con enfasis en operacion. **CRITERIOS DE ACEPTACION (DISENO):** (1) mockup/wireframe contempla ambas secciones completas en una sola vista; (2) jerarquia visual permite lectura rapida de areas criticas y contactos; (3) la grilla operativa soporta multi-persona por area y crecimiento vertical; (4) el panel admin muestra claramente CRUD minimo de areas/personas; (5) queda definida interaccion drag-and-drop (origen, destino, estado visual); (6) responsive definido para desktop y mobile sin perdida funcional del flujo principal; (7) especificacion documenta estados vacios, carga y error a nivel de diseno; (8) se deja trazabilidad explicita de que la implementacion tecnica se abordara en issue(s) posterior(es). |
| BACKUP-ENC-081 | En progreso | Backup / Seguridad ALTA | Cifrado opcional de backups con passphrase | Al crear un backup, el usuario podra elegir si desea cifrarlo mediante un popup para ingresar frase secreta; no sera obligatorio. Al restaurar, si el respaldo esta cifrado, el sistema debe pedir la llave. |

#### Recomendacion de soluciones - SHIFT-DASH-146

1. Dividir la implementacion en 2 entregables: `vista operativa` y `panel administrativo`, con feature flag para habilitacion progresiva.
2. Definir un esquema de datos unico para area/persona/asignacion antes del UI final, evitando doble fuente entre tabla de turnos y drag-and-drop.
3. Implementar la grilla operativa con layout de filas densas y altura fija por celda, permitiendo expansion vertical controlada para 10+ areas.
4. Estandarizar paleta de barras laterales por area (tokens por categoria) para mantener consistencia en todos los temas.
5. Reutilizar formularios de alta/edicion con validaciones compartidas (nombre, rol, email corporativo, telefono) y mensajes de error uniformes.
6. Para drag-and-drop, definir estados visuales minimos: disponible, arrastrando, destino valido, destino invalido y asignado.
7. Incorporar resumen operativo en footer con conteos en tiempo real (`total asignado`, `areas activas`) y boton principal de guardado con estado loading/success/error.
8. Validar responsive por breakpoints (desktop/tablet/mobile) con criterio explicito: sin scroll horizontal en tabla principal y acciones admin accesibles en movil.

**Plan de ataque visual ejecutado:** `docs/ui-visual-remediation-plan.md` (oleadas, criterios de aceptacion, rutas objetivo y Definition of Done visual).

### Guardrails para IA (evitar fallas por malas practicas)

Estas reglas aplican a cualquier agente IA que tome items de este backlog:

1. No inventar arquitectura ni stack: antes de codificar, leer documentacion vigente del modulo impactado (`docs/COMPLEMENTS.md`, `docs/UI-GOVERNANCE.md`, `docs/API.md`, etc.).
2. No usar Docker cuando el issue no lo requiere: para complementos simples, priorizar `zip-static` con HTML/CSS/JS y publicacion por Admin > Complementos.
3. No introducir complejidad innecesaria: si el requerimiento es de consulta visual, evitar backend nuevo, base de datos o servicios externos.
4. No romper contratos existentes: respetar rutas, nombres de campos, scopes y estructuras ya definidas por la plataforma.
5. No hardcodear secretos ni credenciales: prohibido tokens, passwords o endpoints sensibles en frontend/documentacion.
6. No usar datos ficticios ambiguos sin etiquetarlos: los ejemplos deben ser claramente de referencia y no simular produccion real.
7. No omitir validacion funcional: todo cambio debe incluir criterio verificable (que probar, donde, y cuando pasa a `Listo`).
8. No cerrar issues sin evidencia minima: registrar archivos tocados, resultado esperado y estado (`Pendiente`, `En progreso`, `Listo`).
9. No degradar UX/Accesibilidad: mantener contraste legible, responsive basico y navegacion clara; evitar UI recargada o inconsistente con el sistema.
10. No editar de forma destructiva: no revertir cambios ajenos ni sobrescribir secciones historicas de este documento sin justificacion explicita.
11. No dejar decisiones implicitas: documentar supuestos clave en la nota del issue (alcance, limites y exclusiones).
12. No saltarse seguridad basica de frontend: escapar contenido dinamico renderizado y evitar inserciones HTML inseguras.

Checklist minimo recomendado para agentes IA antes de marcar un item como `Listo`:

- Implementacion alineada a documentacion del repo.
- Sin sobreingenieria para el alcance solicitado.
- Evidencia en `Notas` del issue (que se hizo y como validarlo).
- Riesgos y pendientes explicitos si aplica.

### Recurrente (QA - cada cambio UI)

| ID | Estado | Seccion | Tarea | Notas |
| :--- | :--- | :--- | :--- | :--- |
| QA-UI-061 | Recurrente | QA + Frontend CRITICA | Rol QA en cada cambio UI | Obligacion en cada PR que toque estilos. Referencia: `docs/UI-GOVERNANCE.md`. |
| QA-UI-062 | Recurrente | QA Visual CRITICA | Probar en los 5 temas lo tocado | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`. |
| QA-UI-063 | Recurrente | QA Funcional + UI ALTA | Regresion de formularios tras cambios de estilo | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`. |
| QA-UI-064 | Recurrente | QA Contraste / Theming ALTA | Casos explicitos de contraste/inputs | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`. |
| QA-UI-065 | Recurrente | Gobernanza CRITICA | No omitir estandares al codificar | Politica viva de desarrollo. |

### Archivo (referencia, sin seguimiento operativo)

| ID | Estado | Seccion | Tarea | Notas |
| :--- | :--- | :--- | :--- | :--- |
| AI-SUMMARY-001 | Archivo | IA/Operacion ALTA | Modulo de Resumen Ejecutivo Efimero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efimero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`. Alcance: IA sin interaccion conversacional con usuarios; solo consume eventos del turno y genera resumen sugerido. |
| AI-SUMMARY-001A | Archivo | IA/Backend CRITICA | Endpoint seguro de generacion IA on-demand (solo admin) | Crear `POST /api/reports/newsletter/ai-summary` con `authenticate + authorize('admin')`, validacion fuerte de payload, timeout y respuesta estructurada. |
| AI-SUMMARY-001B | Archivo | IA/Infra CRITICA | Orquestador efimero de Ollama con kill garantizado | Implementar flujo `start -> healthcheck -> generate -> stop` en `try/finally`, con lock de concurrencia para evitar multiples arranques simultaneos. |
| AI-SUMMARY-001C | Archivo | IA/Seguridad ALTA | Hardening anti prompt-injection y sanitizacion de contexto | Sanitizar entradas, truncar tamano, remover instrucciones maliciosas y usar prompt de sistema inmutable con formato JSON estricto. |
| AI-SUMMARY-001D | Archivo | IA/Observabilidad ALTA | Auditoria tecnica sin fuga de datos sensibles | Auditar duracion, modelo, tokens estimados, resultado y errores; nunca persistir prompt completo ni respuesta integra sensible. |
| AI-SUMMARY-001E | Archivo | IA/Frontend ALTA | UX integrada en Boletin: `Resumen Sugerido por IA` + boton `Generar con IA` | Campo editable no bloqueante, estados loading/error/reintento, cancelacion y preservacion de edicion manual al regenerar. |
| AI-SUMMARY-001F | Archivo | IA/Operacion ALTA | Limite de recursos y politicas de degradacion | Timeout duro, memoria/CPU limites, rate-limit por usuario, fallback manual si IA falla, sin bloquear generacion de boletin. |
| AI-SUMMARY-001G | Archivo | QA/Testing ALTA | Suite de pruebas de seguridad, carga y regresion | Tests de exito, timeout, lock concurrente, sanitizacion, RBAC, fallback UX y no-regresion en report-generator/newsletter. |

### Listas (cerrados)

| ID | Estado | Seccion | Tarea | Notas |
| :--- | :--- | :--- | :--- | :--- |
| - | - | - | Sin items cargados en esta version del archivo | Pendiente de restaurar o reimportar historial cerrado. |

## Anexo temporal: Recomendacion de soluciones

### SHIFT-DASH-146
Este bloque queda asociado al diseno de referencia de SHIFT-DASH-146.

#### Propuesta visual basada en referencia (imagen ejemplo)

1. Mantener un encabezado operativo compacto con titulo y subtitulo en 2 lineas maximo para priorizar la tabla.
2. Ubicar el selector de semana en la esquina superior derecha con botones anterior/siguiente y rango visible en formato corto.
3. Reemplazar tarjetas separadas por una sola grilla/taba unificada de alta densidad.
4. Mostrar cada area como fila con micro-barra lateral de color para lectura rapida de criticidad y tipo de equipo.
5. Mantener 3 columnas operativas fijas: `Categoria y turno`, `Personal de turno`, `Contacto`.
6. En `Personal de turno`, permitir 1..N personas por area usando filas internas compactas sin romper la altura general.
7. En `Contacto`, mostrar email y telefono alineados con iconos pequenos para escaneo rapido (correo/telefono).
8. Asegurar separadores suaves, bordes sutiles y fondos limpios para evitar ruido visual (estilo command center sobre base clara).
9. Permitir crecimiento vertical a 10+ areas con scroll del contenedor, manteniendo header de columnas sticky.
10. Mantener coherencia cromatica por area en toda la vista (misma barra en tabla, admin y drag-and-drop).

#### Recomendacion de implementacion UX para la seccion Admin

1. Distribuir la parte administrativa en panel inferior con 3 bloques: `Areas`, `Personal`, `Asignacion visual`.
2. Bloque `Areas`: alta rapida con nombre, color predefinido e icono, mas acciones editar/eliminar por fila.
3. Bloque `Personal`: formulario reutilizable (alta/edicion) con validacion de email corporativo y telefono.
4. Bloque `Asignacion visual`: lista `Personal disponible` a la izquierda y destinos por area a la derecha para drag-and-drop.
5. Definir estados visuales de arrastre: disponible, arrastrando, destino valido, destino invalido, asignado.
6. Agregar pie operativo con metricas en vivo: `Total de Personal Asignado` y `Areas Activas`.
7. El boton principal `Guardar Cambios Operativos` debe mostrar estado loading/success/error y confirmacion clara.
8. En mobile, convertir drag-and-drop a flujo alternativo por selector y boton `Asignar` para no perder usabilidad tactil.

## Criterios de aceptacion

1. En viewport desktop, la tabla de turnos muestra areas, personal y contacto sin desbordes ni cortes de texto critico.
2. En viewport de 1024px (tablet), la grilla principal no crea scroll horizontal y conserva legibilidad.
3. En mobile, se mantiene acceso completo a acciones administrativas mediante layout apilado o drawer.
4. La vista soporta multiples personas por area sin romper alineaciones de filas ni columnas.
5. Los colores de barras laterales por area permanecen consistentes en tabla operativa y panel admin.
6. Drag-and-drop (o flujo alternativo mobile) permite asignar y desasignar personal con feedback inmediato.
7. Las metricas de pie (`total asignado`, `areas activas`) se actualizan en tiempo real tras cada cambio.
8. QA visual valida contraste y legibilidad en los temas activos definidos por la plataforma.
