# Pruebas de mutación del núcleo

Medido el 2026-11-25 con Stryker 10.1.1 (`@stryker-mutator/vitest-runner`, vitest 2.1.9, Node 24) sobre los módulos
del núcleo que calculan, cuentan dinero, numeran y validan.

```bash
pnpm install
pnpm mutacion          # = pnpm --filter factura-hn mutacion: stryker run && node scripts/umbral-mutacion.mjs
```

El informe queda en `packages/core/reports/mutacion/` (`index.html` y `mutacion.json`, fuera de git). Para volver a
imprimir la tabla por módulo sin correr Stryker: `node scripts/umbral-mutacion.mjs`.

## Resultado

Puntaje = (muertos + tiempo agotado) / (muertos + tiempo agotado + sobrevivientes + sin cobertura). Los mutantes
excluidos con comentario no cuentan.

| Módulo | Antes | Después | Muertos | Sobreviven | Sin cobertura | Excluidos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `autorizacion.ts` | 70.55 % | 99.32 % | 290 | 2 | 0 | 0 |
| `calculo.ts` | 59.18 % | 97.13 % | 237 | 7 | 0 | 1 |
| `dinero.ts` | 61.30 % | 97.30 % | 216 | 6 | 0 | 0 |
| `documento.ts` | 69.96 % | 99.74 % | 781 | 2 | 0 | 2 |
| `identificacion.ts` | 72.73 % | 100.00 % | 55 | 0 | 0 | 0 |
| `letras.ts` | 70.52 % | 100.00 % | 169 | 0 | 0 | 7 |
| `modo.ts` | 80.77 % | 100.00 % | 26 | 0 | 0 | 0 |
| `numeracion.ts` | 69.91 % | 100.00 % | 113 | 0 | 0 | 0 |
| **Total** | **67.94 %** | **99.11 %** | 1887 | 17 | 0 | 10 |

«Antes» es `main` con el Lote 4 (1943 mutantes: 1320 muertos, 438 sobrevivientes, 185 sin cobertura). La mayoría
eran mensajes y campos de error que ninguna prueba comparaba, ramas de validación que solo se probaban desde la API
(cantidad 0, precio negativo, CAI vacío, rango invertido…) y bordes exactos (correlativo 99999999, 90 % del rango,
un año justo de vigencia, el día de la fecha límite).

## Tiempo

| Corrida | Procesos | Tiempo |
| --- | ---: | ---: |
| Línea base (Windows, 20 núcleos) | 8 | 66 min |
| Final (Windows, 20 núcleos) | 8 | 15 min |
| Final (Windows, 20 núcleos) | 12 | 10 min |

Casi todo el tiempo se va en `art9-redondeo.test.ts`, que barre de L 0.01 a L 1,000.00 en las dos tasas (unos
13 s) y cubre casi todo `dinero.ts` y `calculo.ts`. El runner de GitHub tiene 4 vCPU (3 procesos): se esperan de 30
a 50 min.

## Dónde corre

- **Cada noche**, en `.github/workflows/nocturno.yml` (trabajo `mutacion`, y a mano con `workflow_dispatch`).
  Falla si el puntaje global baja de 85 % (`thresholds.break`) o si cualquier módulo baja de 85 %
  (`scripts/umbral-mutacion.mjs`). Sube el informe como artefacto.
- **No en el CI**: no cabe en 5 minutos. Las pruebas nuevas (`packages/core/test/mutacion-*.test.ts`) sí corren en
  el CI con `pnpm test`, en menos de un segundo.

## Qué corre

- Módulos mutados (`packages/core/stryker.config.mjs`): `calculo.ts`, `dinero.ts`, `letras.ts`, `numeracion.ts`,
  `documento.ts`, `autorizacion.ts`, `identificacion.ts` y `modo.ts`.
- Pruebas (`packages/core/vitest.mutacion.config.ts`): todas las del núcleo salvo `readme.test.ts`,
  `lote2-cli.test.ts`, `sin-flotante.test.ts` y `lote2-errores.test.ts`, que compilan la documentación, lanzan el
  CLI o leen el texto de `src/` y `docs/`, y no funcionan sobre la copia instrumentada de Stryker.
- `TZ=UTC`, como en el CI.

## Pruebas nuevas

Siete archivos en `packages/core/test/`, 138 casos:

- `mutacion-dinero.test.ts`: lectura exacta (anclas, `.5`, `5.`, vacío), separador de miles con signo y exponente,
  tope de 40 dígitos y de exponente ±30, tipos que no son número ni texto (y objetos que no se pueden convertir a texto), redondeo del Art. 9 con cada combinación
  de signos, `aCentavos`, `redondear2`, `formatearMonto`, `formatearMoneda`, `escaladoATexto`, `textoSeguroCSV`.
- `mutacion-calculo.test.ts`: cada problema de línea con su mensaje y su campo, `ErrorCalculo`, exonerado con las dos
  tasas, la línea calculada, el aviso de ajuste, `baseDesdePrecioConISV` y `sugerirPrecioSinAjuste` en sus bordes.
- `mutacion-letras.test.ts`: cada palabra de las tablas, CIEN, apócope, millones y billones, «DE», límites.
- `mutacion-numeracion.test.ts`: tabla de tipos, correlativo máximo, anclas, mensajes, pertenencia en los extremos.
- `mutacion-identificacion.test.ts`: RTN, DNI y CAI con anclas y formato; modo de prueba.
- `mutacion-autorizacion.test.ts`: cada problema de una autorización, Art. 62, `estadoAutorizacion` (Art. 59,
  porcentaje de aviso, agotada, vencida, retirada), fecha y hora en Honduras.
- `mutacion-documento.test.ts`: cada validación de `validarEntrada`, umbral de consumidor final, venta mixta, notas y
  su conversión a lempiras, `ErrorValidacion`, operador, `problemasDeTexto`, `construirDocumento`.

## Error encontrado

`enteroALetras` desde 10^12 decía «UN MILLÓN MILLONES» en lugar de «UN BILLÓN». Corregido con su prueba (escala
larga del español: «UN BILLÓN DE LEMPIRAS»); por debajo de 10^12 no cambia nada. No es una regla fiscal.

## Mutantes equivalentes

Un mutante equivalente no cambia el comportamiento: ninguna prueba lo puede matar. Stryker solo excluye por línea y
por tipo de mutación, así que:

- **Excluidos (10)**, con `// Stryker disable next-line` y el motivo, solo donde son los únicos de su tipo en la
  línea: las entradas sin usar de las tablas de `letras.ts` (5), las anclas de `apocopar` (2), la lista inicial de
  `problemasDeTexto` y la de `leerLinea` en `calcularCentavos`, y `exento + exonerado` en la venta mixta (con
  exoneración no hay base gravada).
- **Vivos (17)**, cada uno con un comentario en el código que dice por qué es equivalente:
  - `dinero.ts` (6): `< 0n` → `<= 0n` en `dividirRedondeando` (con 0 el cociente es 0n; el denominador 0 ya se
    rechazó), y `>= 0` → `> 0` en `parsearDecimal` y `redondearDecimal` (dividir entre 10^0 no cambia nada).
  - `calculo.ts` (7): el `catch` de `ErrorMonto` en `leer` (parsearDecimal solo lanza ErrorMonto, también con un objeto que no se puede convertir a texto), `ok = false` del descuento en
    `leerLinea`, y las cotas de `baseDesdePrecioConISV` (`<= 0n`, el `+ 1n` interior, `base > 0n` dos veces) y
    `sugerirPrecioSinAjuste` (`abajo > 0n`).
  - `autorizacion.ts` (2): las anclas del patrón de `esFechaValida`: con algo de más, el texto ya no es igual a
    `toISOString().slice(0, 10)`. El patrón en sí no es equivalente: sin él pasan «+010000-01» y «-000001-01».
  - `documento.ts` (2): el `catch` de `ErrorMonto` en `leerTipoCambio` y en `notaEnLempiras`.

Además se quitó código muerto que solo producía mutantes equivalentes, sin cambiar el comportamiento:

- `leerTipoCambio` ya no compara con `undefined`, `null` y `''`: `parsearDecimal` lanza ErrorMonto y da `null` igual.
- `notaEnLempiras` ya no usa `tipoDocumento ?? '01'`: sin tipo tampoco es una nota.
- `hoyHonduras` delega en el valor por omisión de `fechaHonduras` en lugar de crear su propio reloj.
- `calcularEquivalenteLempiras` mira solo `tipoCambio`, que solo existe en moneda extranjera.
- `formatearMonto` no separa el signo: la expresión de miles no pone coma tras «-».
- `centavosEnLetras` no trata el 0 aparte (`enteroALetras(0)` ya es «CERO»), y `menorQueMil` no revisa el 0, que
  nunca recibe.
- `descomponer` no usa `m[4] ?? '0'` ni `|| '0'` donde no pueden aplicar.
- `leerTipoCambio`, `notaEnLempiras` y `calcularEquivalenteLempiras` ya no pasan a `parsearDecimal` nombres de campo
  que solo iban en mensajes que nadie leía.
