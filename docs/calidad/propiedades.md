# Propiedades, contrato OpenAPI y fuzzing

Medido el 2026-11-25 (Node 24, Windows y Postgres 16 local).

## Resultado

| Qué | En el CI (cada push) | De noche (`nocturno.yml`) |
|---|---|---|
| Propiedades del núcleo (fast-check) | 60 propiedades, 12 620 casos, 0 fallos (5 s) | 60 propiedades, 1 262 000 casos, 0 fallos (71 s) |
| Respuestas de la API validadas contra `openapi.json` | 1 868 (1 551 de las pruebas existentes y 317 del fuzz), 0 fuera del contrato | — |
| Fuzz de la API | 300 solicitudes con la semilla fija 20261125: ninguna 500 (77 2xx, 223 4xx; 9 emisiones 201 y 16 rechazos 422) | 20 000 solicitudes con una semilla distinta cada noche (ninguna 500 en la corrida de prueba) |
| Cobertura de la especificación | 28 de 28 operaciones; 132 de 201 combinaciones operación + estado | — |

Las 60 propiedades cubren: dinero (lectura exacta y redondeo de la Ley del ISV Art. 9), cálculo (el total es la
suma de sus partes, Reglamento del Régimen de Facturación, Acuerdo 481-2017, Art. 11 num. 1 g-i; no se pierde un
centavo; ISV incluido y no incluido; descuentos, Ley del ISV Art. 3; exento, alícuota cero del Art. 12 del
Reglamento (no de la Ley del ISV) y exonerado; el orden de las líneas no cambia nada),
numeración (formato y rango, Art. 10; emisión consecutiva sin huecos y `RANGO_AGOTADO`), validación (RTN, DNI, CAI,
fechas en America/Tegucigalpa, Arts. 14, 43 y 62) y montos en letras (un lector independiente las vuelve a número).
El fuzz del núcleo comprueba que los lectores solo lanzan errores propios, nunca un `TypeError`.

Las 69 combinaciones de la especificación que no aparecen son sobre todo los 500 y los 429 de cada operación, que
las pruebas no provocan a propósito. Con la semilla fija las cifras del CI se repiten de una corrida a otra (dos
corridas dieron lo mismo); con otra semilla cambian un poco (una revisión vio 135 combinaciones).

La corrida nocturna de prueba (antes de que el fuzz metiera caracteres de control en los textos) dio 4 383 2xx y
15 617 4xx, con 527 emisiones 201 y 1 080 rechazos 422, en 434 s.

## Lo que se encontró y se corrigió

| Hallazgo | Dónde | Antes | Ahora |
|---|---|---|---|
| Total de más de 15 cifras | núcleo, API | `RangeError` sin código; 500 | problema `MONTO_FUERA_DE_RANGO` (tope técnico, no fiscal); 422 sin consumir número |
| 10^12 en letras | núcleo | «UN MILLÓN MILLONES» | «UN BILLÓN» |
| Línea inválida en `leerExportacionJSONL` | núcleo | `SyntaxError` sin línea; `5` o `null` pasaban como documento | `ErrorExportacion` con el número de línea |
| Cuerpo sin `Content-Type: application/json` | API | 415 en texto plano, sin declarar | 415 `TIPO_DE_CONTENIDO` con la forma de error, declarado |
| Fecha de período inexistente (`2026-02-30`) | API | 500 | 400 `SOLICITUD_INVALIDA` |
| CAI con NUL en la ruta | API | 500 | 404 |
| NUL en el nombre de una llave o la URL de un webhook | API | 500 | 400 `SOLICITUD_INVALIDA`; y todo SQLSTATE 22021/22P05 es 400 |
| Tope que suponía 18 % en todas las líneas | núcleo | rechazaba documentos exentos o al 15 % que cabían | el tope se mide por grupo de tasa |
| Documento en dólares por encima del tope en lempiras | núcleo, API | se emitía y el equivalente en lempiras perdía centavos | `MONTO_FUERA_DE_RANGO` en `tipoCambio` |
| Respuestas sin declarar | `openapi.json` | `Idempotency-Replayed`, CSV y TXT de la exportación, 403 del libro de ventas, `FacturaHN-Modo` en los 429 | declaradas |

Cada uno tiene su caso fijo en `packages/core/test/casos-limite.test.ts` o
`packages/api/test/hallazgos-fuzz.test.ts`. Ninguno cambió una regla fiscal.

## Cómo se reproduce

```bash
# Todo (núcleo + API con el validador del contrato + fuzz) e imprime estos números
FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn_pruebas pnpm calidad:propiedades

# Como de noche
FHN_PROP_CORRIDAS=20000 FHN_FUZZ_CASOS=20000 FHN_PG_URL=… pnpm calidad:propiedades

# Solo las propiedades del núcleo, o el fuzz de la API con su resumen por estado y código
pnpm --filter factura-hn exec vitest run test/propiedades
FHN_FUZZ_RESUMEN=1 FHN_PG_URL=… pnpm --filter @factura-hn/api exec vitest run test/fuzz.test.ts
```

- Sin `FHN_PG_URL`, el script mide el núcleo y las pruebas de la API que no usan la base.
- Un fallo de fast-check imprime el contraejemplo y la semilla: `FHN_PROP_SEMILLA=<semilla>` repite la misma
  secuencia. El fuzz de la API usa 20261125 si no se indica otra; las propiedades del núcleo, una al azar.
- `FHN_CONTRATO=registrar` anota las violaciones del contrato sin hacer fallar la prueba (para revisar muchas a la
  vez).

## Cómo funciona

- **Propiedades:** `packages/core/test/propiedades/`. `FHN_PROP_CORRIDAS` casos por propiedad (200 por omisión).
- **Contrato:** `packages/api/test/setup-contrato.ts` envuelve cada app que crea `crearApp` en las pruebas, y
  `openapi-validador.ts` revisa estado, tipo de contenido, cuerpo JSON (Ajv, OpenAPI 3.1), cabeceras (las
  declaradas `required` deben llegar, y todo 429 con `Retry-After`) y que una respuesta sin contenido declarado
  llegue vacía. Una
  respuesta fuera de la especificación hace fallar la prueba que la provocó. Quedan fuera solo `/openapi.json`,
  `/docs`, `/` y las rutas `/prueba-*` que montan algunas pruebas.
- **Fuzz de la API:** `packages/api/test/fuzz.test.ts` genera solicitudes desde `openapi.json` en dos modos: sano
  (llega a la lógica y a la base) y hostil (llaves, cabeceras, rutas, cursores y cuerpos al azar); los dos meten a
  veces un carácter de control (casi siempre U+0000) dentro de un texto del cuerpo. Exige que se
  recorran las 28 operaciones y que haya emisiones aceptadas y rechazadas, para que el fuzz no se quede en los 400.
