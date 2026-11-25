## Qué cambia

<!-- Una o dos frases. Enlaza el issue si existe. -->

## Lista

- [ ] Pruebas nuevas o actualizadas, todas en verde (`pnpm run ci`).
- [ ] Toda validación nueva cita su artículo en un comentario y tiene prueba, y su fila de `docs/cumplimiento.md` se actualiza.
      Si cambia una interpretación fiscal, el PR explica cuál y por qué.
- [ ] Nada de punto flotante en dinero; fechas en America/Tegucigalpa.
- [ ] No cambia ni reutiliza correlativos; no edita documentos emitidos.
- [ ] `pnpm changeset` si afecta a un paquete publicado (cambio incompatible: entrada en `CHANGELOG.md`).
- [ ] Documentación al día (README, AGENTS.md, guías).
- [ ] Solo datos de ejemplo ficticios (`pnpm auditar:datos`).
