# Guía para agentes que desarrollan factura-hn

Instrucciones para agentes que **desarrollan** factura-hn. Para integrar la librería en otro proyecto, ver
`AGENTS.md`.

## Reglas del proyecto

Las de `CONTRIBUTING.md`, en resumen:
- ninguna regla fiscal inventada: cada validación cita su artículo y tiene prueba;
- interpretaciones en `docs/decisiones.md` con **[REVISAR]**;
- sin punto flotante en dinero;
- correlativos atómicos y sin huecos;
- documentos emitidos inmutables;
- fechas en America/Tegucigalpa;
- solo datos de ejemplo ficticios (`pnpm auditar:datos`);
- commits pequeños, con las pruebas en verde (`pnpm run ci`).

Mantén `docs/avance.md` al día.

## Pide permiso antes de

- publicar en npm, hacer push, crear repositorios o desplegar;
- crear cuentas o cambiar la licencia;
- instalar algo global o fuera del proyecto;
- usar Docker con contenedores que no sean los de `docker-compose.yml` de factura-hn.
