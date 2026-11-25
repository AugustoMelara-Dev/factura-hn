# Cómo contribuir

Gracias por ayudar. factura-hn emite documentos fiscales: un error aquí le cuesta dinero o una sanción a un
negocio. Por eso las reglas de abajo no son opcionales.

## Reglas del proyecto

1. **No se inventan reglas fiscales.** Cada validación cita su artículo (Reglamento del Régimen de
   Facturación, Acuerdo 481-2017, u otra norma) en un comentario y tiene una prueba. Si el texto no lo dice de
   forma literal y la regla es una lectura, el comentario y la documentación lo dicen así, y el PR explica la
   interpretación. La matriz de cumplimiento (`docs/cumplimiento.md`) es la fuente de verdad.
2. **Sin punto flotante en dinero.** Montos como texto decimal o enteros escalados.
3. **Correlativos atómicos y sin huecos.** Un número nunca se borra ni se reutiliza. Si algo falla, se revierte
   la transacción o el documento se anula.
4. **Documentos inmutables.** Solo se anulan (Art. 41) o se corrigen con notas 06/07.
5. **Fechas en America/Tegucigalpa.**
6. **Cambios incompatibles** en una versión menor mientras sea 0.x, con su entrada en `CHANGELOG.md`.
7. **Datos de ejemplo ficticios** (abajo). `pnpm auditar:datos` lo comprueba en el CI.

## Preparar el entorno

```bash
pnpm install            # pnpm 12 (corepack enable), Node 22.13 o más reciente
pnpm build
pnpm test               # núcleo, SQLite, PDF y lo que no necesita base
pnpm test:ejemplos
pnpm test:pg            # PostgreSQL en Docker (docker-compose.dev.yml) o en FHN_PG_URL
pnpm typecheck
pnpm mutacion           # pruebas de mutación del núcleo (Stryker, ~15 min con 8 procesos; corre cada noche), ver docs/calidad/mutacion.md
pnpm verificar:dist     # lo que se publicaría en npm
pnpm sitio              # sitio de documentación (web/, Astro Starlight) en sitio/
pnpm sitio:ver          # el sitio construido en http://localhost:4321/factura-hn/
```

## Antes de abrir un PR

- Pruebas nuevas para lo que cambias. Una regla fiscal nueva va con su caso positivo y negativo, y la fila de
  la matriz (`docs/cumplimiento.md`) se actualiza. En la columna «Prueba», cita el archivo y el título de la
  prueba entre comillas latinas (`matriz.test.ts` «Art. 9 …»): `pnpm sitio` falla si una fila cubierta o parcial
  no tiene prueba o cita una que no existe.
- `pnpm changeset` si el cambio afecta a un paquete publicado. Describe el cambio en español, para quien lo
  usa.
- Documentación al día. Los bloques ```ts de README, AGENTS.md y `docs/guia-sdk.md` se compilan en las
  pruebas: si cambias una firma, cambia el ejemplo.
- Commits pequeños, con las pruebas en verde.

## Datos de ejemplo

Nunca uses datos de personas o negocios reales, ni de tu propia empresa:

| Dato | Usa |
|---|---|
| RTN | `99990000000001`, `99990000000002`… (no existe el departamento 99) |
| DNI | `9999000000001` |
| CAI | `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4` o `DEMO00-NO-VALIDO-…` |
| Correo | `algo@ejemplo.example` (dominio reservado, RFC 2606) |
| Teléfono | `0000-0001` |
| Dirección | `Barrio El Centro, Ciudad Ejemplo` |

## Reportar un problema

- **Regla fiscal:** usa la plantilla «Regla fiscal» y cita el artículo y la fuente.
- **Vulnerabilidad:** no abras un reporte público (issue). Sigue `SECURITY.md`.

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).
