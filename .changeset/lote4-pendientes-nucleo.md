---
"factura-hn": minor
---

Pendientes menores del núcleo:

- `emitir` y `validarEntrada` rechazan con `TEXTO_CARACTER_NO_PERMITIDO` (sin consumir número) un texto de la
  entrada, o el nombre de uno de sus campos, a cualquier profundidad, con un carácter de control (categoría Cc: C0,
  DEL y C1), salvo el tabulador y los saltos de línea, o con la mitad suelta de un par sustituto UTF-16. `campo`
  dice cuál (p. ej. `lineas[0].descripcion`). `anular` y `corregirFechaAdelantada` rechazan igual el motivo. Antes,
  un NUL se guardaba y en PostgreSQL el listado sin líneas y la anulación fallaban (`jsonb`). Nueva:
  `problemasDeTexto`.
- Nueva `registrarAutorizacionConAvisos(almacen, autorizacion, opciones?)`: igual que `registrarAutorizacion`, y
  devuelve `{ autorizacion, advertencias }`, p. ej. con `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62).
  `registrarAutorizacion` no cambia de firma.

## Cambios incompatibles

- **La configuración del emisor también se revisa.** Un emisor configurado con un carácter de control (en
  `crearFacturador({ emisor })`, en `emitir({ emisor })` o guardado en la API) hace fallar toda emisión con
  `TEXTO_CARACTER_NO_PERMITIDO` y `campo: 'emisor.…'`, aunque la venta no lo traiga. Antes se emitía. La
  `solucion` de esos problemas dice que se corrige la configuración (en la API, `PATCH /v1/emisores/{id}`).
