---
title: Contribuir
description: Cómo contribuir a factura-hn, reportar una regla fiscal con su fuente y usar solo datos ficticios.
sidebar:
  order: 3
---

factura-hn emite documentos fiscales: un error le cuesta dinero o una sanción a un negocio. Por eso las reglas
de abajo no son opcionales. Las contribuciones son bienvenidas, sobre todo de contadores y de desarrolladores con
sistemas ya autorizados.

La guía completa está en
[CONTRIBUTING.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CONTRIBUTING.md). Al participar
aceptas el
[código de conducta](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CODE_OF_CONDUCT.md).

## Si eres contador o conoces la norma

La forma más útil de ayudar es aportar la fuente de una regla. Abre un issue con la plantilla **«Regla fiscal»**
y cita el artículo y la fuente exacta. Sirve para:

- una regla que falta, sobra o se interpreta mal;
- un aviso «Por confirmar con fuente» de este sitio;
- una de las preguntas abiertas de la [consulta al SAR](/produccion/consulta-sar/);
- una decisión marcada «en revisión» en [Decisiones](/referencia/decisiones/).

No hace falta escribir código.

## Reglas del proyecto

1. **No se inventan reglas fiscales.** Cada validación cita su artículo en un comentario y tiene una prueba. Una
   interpretación se registra como decisión, marcada en revisión hasta que el responsable la apruebe.
2. **Sin punto flotante en dinero.** Montos como texto decimal o enteros escalados.
3. **Correlativos atómicos y sin huecos.** Un número nunca se borra ni se reutiliza.
4. **Documentos inmutables.** Solo se anulan (Art. 41) o se corrigen con notas 06 y 07.
5. **Fechas en America/Tegucigalpa.**
6. **Cambios incompatibles** en una versión menor mientras sea 0.x, con su entrada en el
   [registro de cambios](/ayuda/cambios/).
7. **Datos de ejemplo ficticios.** `pnpm auditar:datos` lo comprueba en el CI.

## Preparar el entorno

Con Node 22.13 o más reciente y pnpm (`corepack enable`):

```bash
pnpm install
pnpm build
pnpm test               # núcleo, SQLite, PDF y lo que no necesita base
pnpm test:ejemplos
pnpm test:pg            # PostgreSQL en Docker (docker-compose.dev.yml) o en FHN_PG_URL
pnpm typecheck
pnpm verificar:dist     # lo que se publicaría en npm
```

## Antes de abrir un PR

- **Pruebas** para lo que cambias. Una regla fiscal nueva va con su caso positivo y su caso negativo, y se
  actualiza la [matriz de cumplimiento](/referencia/cumplimiento/).
- **Changeset** (`pnpm changeset`) si el cambio afecta a un paquete publicado, en español y para quien lo usa.
- **Documentación al día.** Los bloques de código TypeScript del README, `AGENTS.md` y la guía del SDK se compilan
  en las pruebas: si cambias una firma, cambia el ejemplo.
- **Commits pequeños**, con las pruebas en verde.

## Datos de ejemplo

Nunca uses datos de personas o negocios reales, ni de tu propia empresa.

| Dato | Usa |
|---|---|
| RTN | `99990000000001`, `99990000000002`… (no existe el departamento 99) |
| DNI | `9999000000001` |
| CAI | `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4` o `DEMO00-NO-VALIDO-…` |
| Correo | `algo@ejemplo.example` (dominio reservado, RFC 2606) |
| Teléfono | `0000-0001` |
| Dirección | `Barrio El Centro, Ciudad Ejemplo` |

## Reportar un problema

- **Algo no funciona como dice la documentación:** plantilla «Error», con la versión y un caso mínimo con datos
  ficticios.
- **Regla fiscal:** plantilla «Regla fiscal», con el artículo y la fuente.
- **Vulnerabilidad:** no abras un issue público. Ver [Seguridad](/ayuda/seguridad/).
