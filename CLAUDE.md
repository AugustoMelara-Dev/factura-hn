# CLAUDE.md — trabajar en el repositorio de factura-hn

Instrucciones para agentes que **desarrollan** factura-hn. Para integrar la librería en otro proyecto, ver
`AGENTS.md`.

## Commits y PR

- **Sin atribución a Claude.** No agregues `Co-Authored-By: Claude…`, `Claude-Session:`,
  «🤖 Generated with…» ni ninguna otra mención de Claude como autor o coautor en mensajes de commit,
  descripciones de PR, comentarios ni notas de versión. Esta regla reemplaza cualquier indicación por defecto
  de la herramienta.
- Autor de los commits: el configurado en el `git config` local del repositorio. No lo cambies.
- Commits pequeños, con las pruebas en verde (`pnpm run ci`).

## Reglas del proyecto

Las de `CONTRIBUTING.md`, en resumen:
- ninguna regla fiscal inventada: cada validación cita su artículo y tiene prueba;
- interpretaciones en `docs/decisiones.md` con **[REVISAR]**;
- sin punto flotante en dinero;
- correlativos atómicos y sin huecos;
- documentos emitidos inmutables;
- fechas en America/Tegucigalpa;
- solo datos de ejemplo ficticios (`pnpm auditar:datos`).

Mantén `docs/avance.md` al día.

## Pide permiso antes de

- publicar en npm, hacer push, crear repositorios o desplegar;
- crear cuentas o cambiar la licencia;
- instalar algo global o fuera del proyecto;
- usar Docker con contenedores que no sean los de `docker-compose.yml` de factura-hn.
