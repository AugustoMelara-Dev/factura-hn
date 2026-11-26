# Catálogo de errores

Cada error de `factura-hn` trae un `codigo` estable, un `mensaje` en español y, si aplica, el `campo` que
falló. Los del SDK traen además `solucion` (qué hacer) y `documentacion` (un enlace a su sección de esta
página). Compara siempre el `codigo`, nunca el texto: el texto puede mejorar entre versiones.

<!-- declaraciones:
import type { AlmacenFiscal, DocumentoEntrada } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const entrada: DocumentoEntrada;
-->
```ts
import { emitir, esErrorValidacion } from 'factura-hn';

try {
  await emitir(entrada, { almacen, establecimiento: '000', puntoEmision: '001' });
} catch (e) {
  if (!esErrorValidacion(e)) throw e;
  for (const p of e.errores) console.error(`[${p.codigo}] ${p.mensaje} ${p.solucion ?? ''}`);
}
```

Un intento fallido no consume número: la emisión ocurre en una transacción que se revierte entera.

Los códigos que empiezan por `AVISO_` no bloquean: el documento se emite y el aviso queda en
`documento.advertencias`. Muéstralos a quien opera.

La **base** de cada código cita el Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas)
cuando el código viene de una regla fiscal. Sin base, el código protege la integridad de los datos o la
operación del sistema; no es una regla del SAR. Ver también [normativa](normativa.md).

- [SDK: configuración y autorizaciones](#sdk-configuración-y-autorizaciones)
- [SDK: fecha y reloj](#sdk-fecha-y-reloj)
- [SDK: emisor](#sdk-emisor)
- [SDK: cliente](#sdk-cliente)
- [SDK: líneas, montos y moneda](#sdk-líneas-montos-y-moneda)
- [SDK: notas de crédito y débito](#sdk-notas-de-crédito-y-débito)
- [SDK: anulación y consulta](#sdk-anulación-y-consulta)
- [SDK: avisos](#sdk-avisos)
- [API REST](#api-rest)
- [Servidor MCP](#servidor-mcp)

## SDK: configuración y autorizaciones

### ALMACEN_REQUERIDO

- **Qué significa:** se llamó a `emitir`, `anular`, `registrarAutorizacion`, `registrarAutorizacionConAvisos`,
  `buscarDocumento`, `eventosAuditoria`, `corregirFechaAdelantada` o `crearFacturador` sin almacén fiscal.
- **Causa:** falta `almacen` en la configuración, o no es un `AlmacenFiscal` (no tiene `transaccion`).
- **Solución:** pasa un almacén: `new AlmacenFiscalMemoria()` para probar; `AlmacenSQLite` o `AlmacenPostgres`
  para guardar de verdad. Créalo una vez al arrancar, no en cada venta.

### SIN_AUTORIZACION

- **Qué significa:** no hay ninguna autorización (CAI) registrada para la serie del documento: establecimiento,
  punto de emisión y tipo (por ejemplo `000-001-06` para notas de crédito).
- **Causa:** no se registró el CAI de esa serie, o se registró con otro establecimiento, punto de emisión o tipo.
  Cada tipo de documento tiene su propio CAI: la primera nota de crédito necesita uno de tipo `06`.
- **Solución:** registra el CAI una vez por resolución con `registrarAutorizacion` (o
  `facturador.registrarAutorizacion`). Para probar sin un CAI real, usa `crearFacturadorDemo()` de
  `factura-hn/demo`.
- **Base:** Reglamento, Arts. 59-61 (autorización de impresión por punto de emisión y tipo).

### AUTORIZACION_VENCIDA

- **Qué significa:** todas las autorizaciones de la serie pasaron su fecha límite de emisión. También aparece
  como alerta de `estadoAutorizacion` y al validar un documento con una autorización vencida.
- **Causa:** la fecha de hoy en Honduras es posterior a la fecha límite del último CAI.
- **Solución:** solicita al SAR una nueva autorización y regístrala. La solicitud se hace en los dos meses previos
  a la fecha límite: `estadoAutorizacion` avisa desde entonces (`AVISO_VENCIMIENTO`).
- **Base:** Reglamento, Art. 62 (vigencia de la autorización) y Art. 59 (solicitud de una nueva).

### RANGO_AGOTADO

- **Qué significa:** se usaron todos los números de los rangos vigentes de la serie. También aparece como alerta
  de `estadoAutorizacion`.
- **Causa:** el último correlativo emitido es el último autorizado.
- **Solución:** solicita al SAR un nuevo rango y regístralo. `estadoAutorizacion` avisa al llegar al 90 % del
  rango (`AVISO_RANGO`).
- **Base:** Reglamento, Art. 59 (solicitud de una nueva autorización).

### RANGO_SOLAPADO

- **Qué significa:** el rango de la autorización que registras comparte números con otro CAI de la misma serie.
- **Causa:** un error al copiar el rango, o una resolución registrada en la serie equivocada.
- **Solución:** revisa rango inicial y final contra la resolución del SAR; si es otra serie, revisa
  establecimiento, punto de emisión y tipo.
- **Base:** Reglamento, Arts. 10 num. 3-5 y 59: cada número pertenece a un solo CAI.

### AUTORIZACION_DUPLICADA

- **Qué significa:** ese CAI ya está registrado en la serie.
- **Causa:** se registró dos veces (por ejemplo, el código de registro corre en cada arranque).
- **Solución:** no hace falta registrarlo otra vez. Si es una resolución nueva, revisa que copiaste el CAI nuevo.
- **Base:** Reglamento, Arts. 10 num. 3-5 y 59.

### AUTORIZACION_MODO_MEZCLADO

- **Qué significa:** se intentó registrar una autorización de prueba en un punto de emisión que tiene o tuvo una
  autorización real. Un punto pasa de prueba a real, nunca al revés: registrar el CAI real en un punto con demo
  sí se permite, y desde entonces la demo de ese punto queda retirada en todos los tipos (no se vuelve a usar; los
  documentos de prueba ya emitidos no cambian).
- **Causa:** se quiso volver a probar en una caja que ya factura de verdad.
- **Solución:** prueba en otro almacén: otra base de datos, o `AlmacenFiscalMemoria`. No pruebes en otro punto
  de emisión del almacén real: sus documentos de prueba se mezclarían con los reales en las consultas.
- **Base:** ninguna fiscal: protege la numeración real de los documentos de prueba.

### RANGO_USADO_EN_PRUEBA

- **Qué significa:** el rango del CAI real empieza en un número que ya usaron documentos de prueba de esa serie.
  Un número de documento no se repite en una serie.
- **Causa:** se probó con la demo en el mismo almacén y la misma caja, se emitieron documentos de prueba y luego
  se registró el CAI real, que empieza en 1.
- **Solución:** registra el CAI real en un almacén nuevo (otra base), donde la serie empieza en el primer número
  de tu resolución. Si el rango de tu resolución empieza después del último número de prueba, sí se acepta aquí.
- **Base:** Arts. 10 num. 3-5 y 59: cada número pertenece a un solo documento y a un solo CAI.

### AUTORIZACION_PRUEBA_FORMATO

- **Qué significa:** el campo `prueba` de la autorización no es booleano (por ejemplo, el texto `'true'`).
- **Solución:** pon `prueba: true`, sin comillas, en una autorización de prueba; omítelo en una real.
- **Base:** ninguna fiscal: el modo de prueba es del producto.

### AUTORIZACION_PRUEBA_CAI_REAL

- **Qué significa:** una autorización con `prueba: true` trae un CAI que no es ficticio.
- **Causa:** se marcó como prueba un CAI real, o uno inventado sin el prefijo `DEMO00-NO-VALIDO-`.
- **Solución:** si el CAI es real, quita `prueba: true`. Para probar, usa `autorizacionDemo()` de
  `factura-hn/demo` en otro almacén. Así un CAI real nunca gasta números en documentos sin valor fiscal.
- **Base:** ninguna fiscal: el modo de prueba es del producto.

### AUTORIZACION_DEMO_SIN_PRUEBA

- **Ya no lo devuelve la API.** Se deja esta nota para los enlaces viejos.
- **Qué hacer:** ver [`CAI_DE_PRUEBA`](#cai_de_prueba).

### AUTORIZACION_REAL_EN_DEMO

- **Qué significa (API, 422):** se intentó registrar un CAI que no es ficticio en un tenant de prueba: el `demo`
  de la demostración o uno creado con `tenant crear --modo prueba` (sus llaves empiezan con `fhn_test_`).
- **Causa:** se usó la llave admin del tenant de prueba para registrar el CAI del negocio.
- **Solución:** registra tu CAI en el tenant de producción de tu negocio, con su llave admin (`fhn_live_…`). Un
  tenant de prueba solo emite documentos de prueba con la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
- **Base:** ninguna fiscal: separa la prueba de la facturación real (un CAI real en el tenant de prueba emitiría documentos
  con apariencia válida fuera de la serie real).

### CAI_DE_PRUEBA

- **Qué significa (API, 422):** `POST /v1/autorizaciones` recibió un CAI ficticio (`DEMO00-NO-VALIDO-…`) en un
  tenant de producción (llaves `fhn_live_…`), con o sin `"prueba": true`.
- **Causa:** se pegó el CAI de la demostración en lugar del CAI real, o se quiso probar en el tenant real.
- **Solución:** si es tu CAI real, cópialo de la resolución del SAR: un CAI real no empieza con
  `DEMO00-NO-VALIDO-`. Para probar, usa un tenant de prueba: el `demo` (`demo llave` en la consola) o uno creado
  con `tenant crear --modo prueba`.
- **Base:** ninguna fiscal: un CAI ficticio en un tenant real convertiría en «de prueba» un punto de emisión real.
- **Fuera de la API:** con el SDK sobre la base de la API, la base rechaza el registro con un error cuyo mensaje
  empieza con `CAI_DE_PRUEBA` (y `AUTORIZACION_REAL_EN_DEMO` en el caso contrario).

### AUTORIZACION_TIPO

- **Qué significa:** la autorización es de un tipo de documento distinto al que se emite.
- **Causa:** se pasó a `validarEntrada` o `construirDocumento` una autorización de otro tipo.
- **Solución:** usa la autorización del mismo tipo (01 factura, 06 nota de crédito, 07 nota de débito). Con
  `emitir`, la elige el almacén.

### CAI_REQUERIDO

- **Qué significa:** la autorización no tiene CAI.
- **Solución:** cópialo tal como viene en la resolución del SAR.

### CAI_FORMATO

- **Qué significa:** el CAI tiene caracteres que no son letras, dígitos ni guiones (o, con `caiEstricto`, no
  tiene la forma 6-6-6-6-6-2 hexadecimal).
- **Causa:** espacios internos o signos al copiarlo.
- **Solución:** cópialo tal como viene en la resolución del SAR. El Reglamento no fija un formato, por eso solo
  se rechaza lo que es claramente un error de digitación.

### TIPO_DOCUMENTO

- **Qué significa:** el tipo de documento de la autorización no existe en la tabla vigente.
- **Solución:** usa `'01'` factura, `'06'` nota de crédito o `'07'` nota de débito.
- **Base:** tabla de tipos del Acuerdo 481-2017 reformado por el Acuerdo 609-2017.

### TIPO_NO_EMITIBLE

- **Qué significa:** ese tipo de documento no se emite por un sistema computarizado (autoimpresor).
- **Causa:** se pidió un Ticket (09), un Recibo por Honorarios (04), una Factura Prevalorada (10) o una
  Constancia de Donación (12).
- **Solución:** emítelo por la vía que fija el Reglamento: máquina registradora para el ticket, imprenta para los
  demás.
- **Base:** Reglamento, Art. 4 num. 43 y Art. 17 (ticket), Art. 46 (honorarios y prevalorada), Art. 47
  (donación).

### TIPO_NO_SOPORTADO

- **Qué significa:** el tipo existe, pero factura-hn no lo emite.
- **Solución:** emite con `tipoDocumento` `'01'` (factura), `'06'` (nota de crédito) o `'07'` (nota de débito): son los que
  emite factura-hn.

### ESTABLECIMIENTO

- **Qué significa:** el código de establecimiento no tiene 1 a 3 dígitos. Lo dicen `registrarAutorizacion`,
  `emitir` y `crearFacturador`.
- **Solución:** usa el código de la resolución (casa matriz = `'000'`).
- **Base:** Reglamento, Art. 10 num. 7 (estructura del número del documento).

### PUNTO_EMISION

- **Qué significa:** el código de punto de emisión no tiene 1 a 3 dígitos. Lo dicen `registrarAutorizacion`,
  `emitir` y `crearFacturador` (un `'0001'` no es la serie `001`).
- **Solución:** usa el código de la resolución (por ejemplo `'001'`).
- **Base:** Reglamento, Art. 10 num. 7.

### RANGO

- **Qué significa:** el rango de la autorización no es válido: el mensaje dice si un extremo no es un entero entre
  1 y 99999999 o si el inicial es mayor que el final.
- **Solución:** cópialo tal como viene en la resolución del SAR.

### FECHA_LIMITE

- **Qué significa:** la fecha límite de emisión no tiene la forma `AAAA-MM-DD` o no existe.
- **Solución:** escríbela como `2027-06-30`.

### FECHA_AUTORIZACION

- **Qué significa:** la fecha de la resolución no tiene la forma `AAAA-MM-DD`.
- **Solución:** corrígela u omite el campo (es opcional).

### ULTIMO_EMITIDO_ANTES

- **Qué significa:** al migrar, `ultimoEmitidoAntes` no está entre el inicio del rango menos uno y el final.
- **Solución:** indica el último correlativo de esa autorización que emitiste fuera de este sistema; si no
  emitiste ninguno, omite el campo.

### DEMO_SIN_NUMEROS

- **Qué significa:** `crearFacturadorDemo` no puede renovar la autorización de prueba de una caja: sus rangos ya
  llegan al correlativo 99 999 999, el máximo del número de 8 dígitos.
- **Causa:** un almacén persistente que lleva muchas renovaciones de la demo en la misma caja.
- **Solución:** usa otro almacén para la demo (p. ej. un `AlmacenFiscalMemoria` nuevo) u otro punto de emisión.
- **Base:** ninguna fiscal: solo afecta a la demo.

### FECHA_DEMO

- **Qué significa:** `autorizacionDemo({ hoy })` recibió una fecha que no se puede leer, por ejemplo
  `'24/11/2026'`.
- **Solución:** pasa un `Date` válido o un texto `YYYY-MM-DD` (`'2026-11-24'`), u omítelo para usar la fecha
  actual.
- **Base:** ninguna fiscal: solo afecta a la demo.

### CORRELATIVO_FUERA_DE_RANGO

- **Qué significa:** se pidió construir un documento con un correlativo fuera del rango de la autorización.
- **Causa:** se usó `construirDocumento` con un número calculado a mano.
- **Solución:** usa `emitir`, que toma el siguiente número del rango vigente por ti, en la misma transacción que
  guarda el documento.

## SDK: fecha y reloj

### FECHA_EMISION

- **Qué significa:** `fechaEmision` no tiene la forma `AAAA-MM-DD`.
- **Solución:** omite el campo: la pone el reloj.

### FECHA_EMISION_NO_ES_HOY

- **Qué significa:** se envió una fecha de emisión distinta de la de hoy en Honduras.
- **Causa:** se intentó retrofechar o adelantar, o el reloj del dispositivo está mal.
- **Solución:** omite `fechaEmision`. Si la fecha de hoy está mal, corrige el reloj del dispositivo.
- **Base:** Reglamento, Arts. 14 (momento de emisión) y 43 (archivo en orden cronológico).

### FECHA_ANTERIOR_AL_ULTIMO

- **Qué significa:** el último documento válido de la serie tiene una fecha posterior a hoy.
- **Causa:** el reloj de este dispositivo está atrasado, o un documento anterior se emitió con el reloj adelantado.
- **Solución:** si el reloj está atrasado, corrígelo. Si el documento anterior tiene una fecha futura, anúlalo con
  `corregirFechaAdelantada`, que deja constancia en la bitácora.
- **Base:** Reglamento, Arts. 41 y 43.

### RELOJ_ADELANTADO_SOSPECHOSO

- **Qué significa:** la fecha de hoy está más de 7 días (o `saltoMaximoDias`) después de la última emisión de la
  serie.
- **Causa:** el reloj del dispositivo está adelantado, o el negocio estuvo cerrado.
- **Solución:** revisa el reloj. Si la fecha es correcta, vuelve a emitir con `confirmarSaltoDeFecha: true`; queda
  en la bitácora.
- **Base:** prevención: un documento con fecha futura trabaría la serie por el orden cronológico del Art. 43.

### SIN_DOCUMENTOS_ADELANTADOS

- **Qué significa:** `corregirFechaAdelantada` no encontró documentos con fecha posterior a hoy en esa serie.
- **Solución:** no hay nada que corregir.

### ENTRADA

- **Qué significa:** la entrada del documento no es un objeto (por ejemplo `null`).
- **Solución:** pasa la venta como `{ emisor, lineas: [...] }` (con `crearFacturador`, `{ lineas: [...] }`).

## SDK: emisor

### EMISOR

- **Qué significa:** faltan todos los datos del emisor.
- **Solución:** pasa `rtn`, `razonSocial`, `nombreComercial`, `direccionCasaMatriz`, `direccionEstablecimiento`,
  `telefono` y `correo`. Con `crearFacturador`, se dan una sola vez.
- **Base:** Reglamento, Art. 10 num. 1 (Arts. 25 y 27 num. 1 para las notas).

### EMISOR_RTN

- **Qué significa:** el RTN del emisor no tiene 14 dígitos.
- **Solución:** usa el RTN de 14 dígitos, con o sin guiones.
- **Base:** Reglamento, Art. 10 num. 1 a.

### EMISOR_NOMBRE

- **Qué significa:** falta la razón social o el nombre del emisor.
- **Solución:** indica la razón social o el nombre del emisor tal como está en el RTN.
- **Base:** Reglamento, Art. 10 num. 1 b.

### EMISOR_NOMBRE_COMERCIAL

- **Qué significa:** falta el nombre comercial.
- **Solución:** si no tiene uno distinto, repite la razón social.
- **Base:** Reglamento, Art. 10 num. 1 c.

### EMISOR_DIRECCION

- **Qué significa:** falta la dirección de la casa matriz.
- **Solución:** indica la dirección de la casa matriz.
- **Base:** Reglamento, Art. 10 num. 1 d.

### EMISOR_DIRECCION_ESTABLECIMIENTO

- **Qué significa:** falta la dirección del establecimiento del punto de emisión (puede ser la de casa matriz).
- **Solución:** indica la dirección del establecimiento del punto de emisión (puede ser la de casa matriz).
- **Base:** Reglamento, Art. 10 num. 1 d.

### EMISOR_TELEFONO

- **Qué significa:** falta el teléfono del emisor.
- **Solución:** indica el teléfono del emisor.
- **Base:** Reglamento, Art. 10 num. 1 e.

### EMISOR_CORREO

- **Qué significa:** falta el correo del emisor o no tiene la forma `nombre@dominio`.
- **Solución:** usa el correo registrado en el contrato de adhesión.
- **Base:** Reglamento, Art. 10 num. 1 f.

## SDK: cliente

### CLIENTE

- **Qué significa:** `cliente` no es un objeto (por ejemplo, el texto `'Juan'`), o su `direccion` no es texto.
  No se guarda deformado en el documento: se rechaza.
- **Solución:** pasa `cliente: { nombre, rtn }` con textos, u omítelo para CONSUMIDOR FINAL.

### CLIENTE_RTN

- **Qué significa:** el RTN del cliente no tiene 14 dígitos.
- **Solución:** corrígelo, o quita el campo si el cliente no pidió la factura con RTN.

### CLIENTE_DNI

- **Qué significa:** el DNI del cliente no tiene 13 dígitos.
- **Solución:** corrígelo; se acepta con o sin guiones.

### CLIENTE_IDENTIFICACION

- **Qué significa:** `cliente.identificacion` no trae número, su `tipo` no es uno de `'DNI'`, `'RTN'`,
  `'PASAPORTE'`, `'CARNET_RESIDENTE'` u `'OTRO'`, o no es un objeto `{ tipo, numero }`. Una identificación así no
  cuenta para el umbral de consumidor final.
- **Solución:** indica el tipo y el número, o quita `identificacion`.

### CLIENTE_NOMBRE

- **Qué significa:** falta el nombre del cliente cuando trae RTN, o en una nota de crédito o débito, o no es
  texto.
- **Solución:** indica el nombre o la razón social.
- **Base:** Reglamento, Arts. 26 y 28 num. 1 (notas).

### CONSUMIDOR_FINAL_IDENTIFICACION

- **Qué significa:** una venta a consumidor final supera L 10,000 (o el umbral configurado) sin nombre e
  identificación del cliente.
- **Solución:** pide al cliente su nombre y su identificación
  (`cliente: { nombre, identificacion: { tipo: 'DNI', numero } }`), o su RTN.
- **Base:** Reglamento, Art. 11 (párrafo final).

## SDK: líneas, montos y moneda

### LINEA

- **Qué significa:** una línea no es un objeto (por ejemplo `null`), o su `codigo` o `unidad` no son texto.
- **Solución:** pasa cada línea como `{ descripcion, cantidad, precioUnitario }`, con `codigo` y `unidad` como
  texto si los usas.

### SIN_LINEAS

- **Qué significa:** el documento no tiene líneas.
- **Solución:** agrega al menos una con descripción, cantidad y precio unitario.

### LINEA_DESCRIPCION

- **Qué significa:** una línea no tiene descripción, o no es texto.
- **Solución:** escribe la descripción del producto o servicio de esa línea.
- **Base:** Reglamento, Art. 11 num. 1 d (descripción de los bienes o servicios).

### LINEA_CANTIDAD

- **Qué significa:** la cantidad no es un número mayor que 0 con hasta 4 decimales.
- **Solución:** pásala como texto con punto decimal, por ejemplo `'1.5'`.

### LINEA_PRECIO

- **Qué significa:** el precio unitario no se puede leer, es negativo o tiene más de 4 decimales.
- **Causa:** un `number` con error de punto flotante (`0.1 + 0.2`), un símbolo de moneda o una coma decimal.
- **Solución:** pásalo como texto con punto decimal y sin símbolo: `'89.50'`.

### LINEA_DESCUENTO

- **Qué significa:** el descuento no se puede leer, es negativo o supera el importe de la línea.
- **Solución:** pásalo como monto (no porcentaje) con punto decimal: `'5.00'`.

### LINEA_ISV

- **Qué significa:** el tratamiento de ISV de una línea no existe.
- **Solución:** usa `'ISV15'`, `'ISV18'`, `'GRAVADO0'` o `'EXENTO'`, u omite el campo (ISV15). Qué producto va
  al 18 % lo decide el negocio: el SDK no lo infiere.

### MONTO_FUERA_DE_RANGO

- **Qué significa:** el total del documento pasaría de L 9,999,999,999,999.99 (`MONTO_MAXIMO_CENTAVOS`). No es
  una regla fiscal: es el mayor total que el SDK representa con exactitud (los importes salen como `number` con 15
  cifras y el total en letras). En la API es un 422 y no consume número. Se revisa en dos sitios:
  - `validarLineas` (campo `lineas`): suma el importe neto de las líneas por tasa y le agrega a cada grupo su ISV
    (15 % o 18 %; exento y alícuota cero, sin ISV), como si los precios no incluyeran el ISV y sin exoneración. Es
    el total exacto en ese caso; con el ISV incluido en el precio o con exoneración el total real es menor o igual,
    así que en esos dos casos el tope puede rechazar un documento cuyo total real cabría.
  - `validarEntrada` (campo `tipoCambio`): en moneda extranjera, el total en lempiras al tipo de cambio del
    documento (el que se guarda en `equivalenteLempiras`) tampoco puede pasar del tope.
- **Solución:** revisa la cantidad y el precio de las líneas. Suele ser un error de digitación: un precio en
  centavos, o la cantidad y el precio intercambiados.

### MONEDA

- **Qué significa:** la moneda del documento no es `'HNL'` ni `'USD'` (por ejemplo `'EUR'` o `'usd'` en
  minúsculas). Lo dicen `emitir`, `validarEntrada`, `cotizar` y `calcularDocumento`.
- **Solución:** usa `moneda: 'HNL'` (por defecto) o `'USD'` con su `tipoCambio`, en mayúsculas.

### PRECIOS_INCLUYEN_ISV_FORMATO

- **Qué significa:** `preciosIncluyenISV` no es booleano (por ejemplo, el texto `'false'` de un formulario o de
  una variable de entorno). No se toma como verdadero: el total cambiaría y el impreso diría «Precios incluyen ISV».
- **Solución:** pon `preciosIncluyenISV: true` o `false`, sin comillas, u omítelo (false). Si el valor llega como
  texto, conviértelo antes: `valor === 'true'`.

### TIPO_CAMBIO

- **Qué significa:** el documento está en moneda extranjera y no trae un tipo de cambio válido.
- **Solución:** indica `tipoCambio` en lempiras por unidad de moneda extranjera de la fecha de emisión (hasta 6
  decimales). El impreso muestra el tipo de cambio y el equivalente en lempiras del ISV y del total.
- **Base:** Reglamento, Art. 11 (párrafo final: tasa de cambio vigente a la fecha).

### EXONERACION_ORDEN

- **Qué significa:** falta el número de la Orden de Compra Exenta de un adquirente exonerado.
- **Solución:** pídelo al cliente, o el número de su registro SAG/RUPNSA.
- **Base:** Reglamento, Art. 10 num. 8 y Art. 11 num. 4.

### EXONERACION_CONSTANCIA

- **Qué significa:** falta el número de la Constancia del Registro de Exonerados.
- **Solución:** pídelo al cliente, o el número de su registro SAG/RUPNSA.
- **Base:** Reglamento, Art. 10 num. 8 y Art. 11 num. 4.

## SDK: notas de crédito y débito

Con `crearFacturador`, `notaCredito` y `notaDebito` toman del original guardado el cliente, la referencia y la
moneda: la mayoría de estos errores desaparecen.

### REFERENCIA

- **Qué significa:** una nota no trae `referencia` al documento que modifica.
- **Solución:** indica `referencia: { cai, numero, fecha }` del documento original.
- **Base:** Reglamento, Arts. 26 y 28 num. 3.

### REFERENCIA_CAI

- **Qué significa:** falta el CAI del documento original.
- **Solución:** copia el CAI, el número y la fecha tal como están impresos en el documento original.
- **Base:** Reglamento, Arts. 26 y 28 num. 3.

### REFERENCIA_NUMERO

- **Qué significa:** el número del documento original no tiene 16 dígitos válidos.
- **Solución:** usa el número completo, por ejemplo `'000-001-01-00000042'`.
- **Base:** Reglamento, Arts. 26 y 28 num. 3.

### REFERENCIA_FECHA

- **Qué significa:** la fecha del documento original no tiene la forma `AAAA-MM-DD`.
- **Solución:** usa la fecha de emisión del documento original como AAAA-MM-DD.
- **Base:** Reglamento, Arts. 26 y 28 num. 3 c.

### REFERENCIA_FECHA_POSTERIOR

- **Qué significa:** la fecha del documento original es posterior a la de la nota.
- **Solución:** usa la fecha de emisión del original, que es anterior o igual a hoy.
- **Base:** Reglamento, Arts. 26 y 28 num. 3 c, y Art. 4 num. 32.

### REFERENCIA_TIPO

- **Qué significa:** una nota de crédito refiere a un documento que no es un comprobante fiscal.
- **Solución:** una nota de crédito se aplica a un comprobante fiscal, como una factura. Revisa el número de la referencia.
- **Base:** Reglamento, Art. 4 num. 32 y Art. 6.

### REFERENCIA_MONEDA

- **Qué significa:** la moneda del documento original no es `HNL` ni `USD`.
- **Solución:** usa `'HNL'` o `'USD'` como moneda del documento original.

### REFERENCIA_TIPO_CAMBIO

- **Qué significa:** el original está en moneda extranjera y falta su tipo de cambio para convertir la nota a
  lempiras.
- **Solución:** indica en `referencia.tipoCambio` el tipo de cambio del documento original.
- **Base:** Reglamento, Arts. 26 num. 9 y 28 num. 8 (las notas se emiten en lempiras).

### REFERENCIA_NO_EXISTE

- **Qué significa:** el número del original pertenece a una autorización de este sistema y todavía no se ha
  emitido.
- **Solución:** revisa el número.

### REFERENCIA_MODO_MEZCLADO

- **Qué significa:** la nota y el documento original no son del mismo modo: una nota de prueba sobre un
  documento real, o una real sobre uno de prueba.
- **Solución:** emite la nota en el mismo modo que el original. Un documento de prueba no tiene valor fiscal y
  no se ajusta con una nota real.
- **Base:** ninguna fiscal: el modo de prueba es del producto.

### REFERENCIA_ANULADA

- **Qué significa:** el documento original está anulado.
- **Solución:** si la venta sigue vigente, refiere al documento que la respalda.
- **Base:** Reglamento, Art. 41.

### REFERENCIA_CAI_NO_COINCIDE

- **Qué significa:** el CAI de la referencia no es el del original guardado.
- **Solución:** copia el CAI, el número y la fecha tal como están impresos en el documento original. Con `crearFacturador`, `notaCredito` los toma del original.
- **Base:** Reglamento, Arts. 26 y 28 num. 3.

### REFERENCIA_FECHA_NO_COINCIDE

- **Qué significa:** la fecha de la referencia no es la del original guardado.
- **Solución:** copia el CAI, el número y la fecha tal como están impresos en el documento original. Con `crearFacturador`, `notaCredito` los toma del original.
- **Base:** Reglamento, Arts. 26 y 28 num. 3.

### REFERENCIA_RTN_NO_COINCIDE

- **Qué significa:** el RTN del adquirente de la nota no es el del original.
- **Solución:** usa el RTN del adquirente del documento original: la nota es para el mismo cliente.
- **Base:** Reglamento, Arts. 26 y 28 num. 1-2.

### REFERENCIA_MONEDA_NO_COINCIDE

- **Qué significa:** la moneda de la referencia no es la del original guardado.
- **Solución:** omite `referencia.moneda`: se toma del original.

### REFERENCIA_TIPO_CAMBIO_NO_COINCIDE

- **Qué significa:** el tipo de cambio de la referencia no es el del original guardado.
- **Solución:** omite `referencia.moneda` y `referencia.tipoCambio`: se toman del original.

### MOTIVO

- **Qué significa:** una nota no trae `motivo`, o no es texto.
- **Solución:** indica por qué se emite (por ejemplo «Devolución de 1 unidad»).

### NOTA_CLIENTE_RTN

- **Qué significa:** una nota no trae el RTN del adquirente.
- **Causa:** frecuente cuando la factura original se emitió a CONSUMIDOR FINAL.
- **Solución:** indica `cliente: { nombre, rtn }`; si el original no tiene RTN, pídeselo al cliente.
- **Base:** Reglamento, Arts. 26 y 28 num. 1-2.

### NOTA_MONEDA

- **Qué significa:** se pidió una nota en moneda extranjera.
- **Solución:** emite la nota en lempiras; si el original está en otra moneda, indica su moneda y tipo de cambio
  en `referencia` y las líneas se convierten.
- **Base:** Reglamento, Arts. 26 num. 9 y 28 num. 8.

### NOTA_SUPERA_ORIGINAL

- **Qué significa:** la nota de crédito, sumada a las notas vigentes sobre el mismo documento, supera su total o,
  a una tasa (15 % o 18 %), su importe gravado o su ISV. Todo se compara en lempiras; un original en moneda
  extranjera se convierte por el mismo camino que la nota (sus líneas, al tipo de cambio). El mensaje da el saldo
  disponible (por tasa, si es el tope de una tasa).
- **Solución:** reduce la nota al saldo, o revisa las notas ya emitidas. Si el tope es el de una tasa, usa en cada
  línea la misma tasa que en el original.
- **Base:** regla de factura-hn: las notas no devuelven ni descuentan más de lo vendido, ni a otra tasa. La nota
  ajusta el comprobante correspondiente (Reglamento, Art. 4 num. 32).

### NOTA_TASA_DISTINTA

- **Qué significa:** la nota lleva ISV a una tasa que el original no tenía, o ISV sobre un original exonerado.
- **Solución:** usa en cada línea el mismo tratamiento de ISV que en el original.
- **Base:** regla de factura-hn: la nota no cambia la tasa del original. La nota ajusta el comprobante
  correspondiente (Reglamento, Art. 4 num. 32).

## SDK: anulación y consulta

### ANULACION_MOTIVO

- **Qué significa:** se pidió anular (o corregir una fecha adelantada) sin motivo.
- **Solución:** indica por qué se anula; queda en el documento y en la bitácora.
- **Base:** factura-hn exige el motivo para la bitácora (los controles de auditoría del Reglamento, Art. 53
  num. 2). La anulación es la del Art. 41.

### YA_ANULADO

- **Qué significa:** el documento ya estaba anulado.
- **Solución:** no hay que hacer nada. Si la venta era real, emite un documento nuevo.
- **Base:** Reglamento, Art. 41.

### DOCUMENTO_CON_NOTAS

- **Qué significa:** se pidió anular un documento (por ejemplo, una factura) que tiene notas de crédito o débito
  vigentes. El mensaje dice cuáles. Anularlo dejaría en el libro de ventas una nota sin venta (importes negativos).
- **Solución:** anula primero las notas de crédito y débito vigentes que indica el mensaje (con su propio motivo) y
  después el documento. Si la venta era real, emite el documento correcto y, si hace falta, sus notas.
- **Base:** regla de factura-hn, la inversa de [`REFERENCIA_ANULADA`](#referencia_anulada): una nota vigente no
  se queda sin su documento. La anulación es la del Reglamento, Art. 41.

### DOCUMENTO_NO_ENCONTRADO

- **Qué significa:** no existe un documento con ese número en el almacén.
- **Solución:** revisa el número: 16 dígitos con guiones, por ejemplo `'000-001-01-00000001'`.

### OPERADOR

- **Qué significa:** el nombre del operador (cajero) está vacío, pasa de 80 caracteres o tiene caracteres de
  control.
- **Solución:** corrígelo u omite el campo. No lo exige el Reglamento: es para la bitácora y el «Atendido por».

### TEXTO_CARACTER_NO_PERMITIDO

- **Qué significa:** un texto de la entrada (emisor, cliente, líneas, referencia, exoneración, motivo,
  observaciones…), el nombre de uno de sus campos o el motivo de una anulación tiene un carácter de control, como
  NUL (U+0000) o ESC (U+001B), o la mitad suelta de un par sustituto UTF-16. `campo` dice cuál, por ejemplo
  `lineas[0].descripcion`.
- **Causa:** casi siempre un copiar y pegar, un lector de códigos de barras o un texto mal decodificado.
- **Solución:** quita esos caracteres. De los de control se permiten el tabulador, el salto de línea y el retorno
  de carro. Si `campo` empieza con `emisor.`, el carácter está en la configuración del emisor, no en la venta:
  corrígela en `crearFacturador({ emisor })` o, en la API, con `PATCH /v1/emisores/{id}`.
- **Base:** no es una regla fiscal. PostgreSQL no guarda esos caracteres en `jsonb` (el listado y la anulación
  terminaban en error 500) y la impresora toma los de control como comandos. Se rechaza antes de
  consumir número.

## SDK: avisos

### AVISO_AJUSTE_CENTAVO

- **Qué significa:** con precios con ISV incluido, el total quedó hasta un centavo por debajo de la suma de
  precios para que el ISV impreso sea exactamente la tasa por la base.
- **Qué hacer:** cobra `totales.total`, no la suma de precios. `sugerirPrecioSinAjuste` propone precios sin
  ajuste.
- **Base:** Ley del Impuesto Sobre Ventas, Art. 9.

### AVISO_VENTA_MIXTA

- **Qué significa:** la venta mezcla líneas gravadas con exentas o exoneradas y el comprador trae RTN.
- **Qué hacer:** informa al comprador que para su crédito fiscal solo cuenta lo gravado (`baseCreditoFiscal`).
- **Base:** Reglamento, Art. 11 num. 3.

### AVISO_EXONERADO_RTN

- **Qué significa:** un adquirente exonerado sin RTN.
- **Qué hacer:** confirma su RTN; un exonerado normalmente se identifica con él.

### AVISO_ORIGINAL_EXTERNO

- **Qué significa:** el documento que modifica la nota no está en este sistema (talonario, otro sistema o emisión
  anterior a la migración) y no se pudo comparar con él.
- **Qué hacer:** revisa a mano que la referencia y el cliente coinciden con el original en papel.

### AVISO_ORIGINAL_SIN_RTN

- **Qué significa:** el original se emitió sin RTN del adquirente (por ejemplo, a CONSUMIDOR FINAL). La nota se
  emite con el RTN que indiques, que el original no tenía.
- **Qué hacer:** confirma que la nota corresponde al mismo cliente.
- **Base:** la nota lleva nombre y RTN del adquirente (Reglamento, Arts. 26 y 28). factura-hn acepta el RTN que
  indiques y emite este aviso.

### AVISO_NOTA_EXONERACION_DISTINTA

- **Qué significa:** la nota de crédito no es exonerada y su original sí (o al revés). Se emite, pero en el libro de
  ventas el crédito queda en otra columna que la venta: por ejemplo, `importeExento` −100 frente a
  `importeExonerado` +100.
- **Qué hacer:** si el original es exonerado, copia su `exoneracion` en la nota; si no lo es, quita `exoneracion`
  de la nota. El aviso trae esa `solucion`.
- **Base:** aviso de factura-hn, para que el libro de ventas cuadre. Los datos del adquirente exonerado son los
  del Reglamento, Art. 11 num. 4.

### AVISO_VENCIMIENTO

- **Qué significa:** alerta de `estadoAutorizacion`: la autorización entró en los dos meses previos a su fecha
  límite.
- **Qué hacer:** solicita la nueva autorización al SAR.
- **Base:** Reglamento, Art. 59.

### AVISO_RANGO

- **Qué significa:** alerta de `estadoAutorizacion`: se usó el 90 % o más del rango.
- **Qué hacer:** solicita un nuevo rango antes de que se agote.

### AVISO_VIGENCIA_MAYOR_1_ANIO

- **Qué significa:** la fecha límite está a más de un año de la fecha de la resolución.
- **Qué hacer:** verifícala contra la resolución: suele ser un error de digitación.
- **Base:** Reglamento, Art. 62 (vigencia de hasta un año).

## API REST

La API responde con `{ error: { codigo, mensaje, solicitud }, errores?, advertencias? }`. Un error fiscal del SDK
llega como `422 VALIDACION`, con la lista de problemas del SDK (con sus códigos de arriba) en `errores`.
`error.solicitud` es el id de la solicitud, el mismo de la cabecera `Solicitud-Id`: cítalo al reportar un problema.
`@factura-hn/cliente` lanza `ErrorFacturaHN` con el mismo `codigo`; si la respuesta no trae uno, usa
`HTTP_<estado>`.

### VALIDACION

- **Qué significa (422):** el SDK rechazó la operación. También lo usa el servidor MCP.
- **Solución:** lee `errores`: cada uno trae su código del SDK, con su solución en esta página.

### SOLICITUD_INVALIDA

- **Qué significa (400):** el cuerpo no tiene la forma que espera la API. `errores` dice qué campo falla. También
  lo usa el servidor MCP cuando un argumento de una herramienta no tiene la forma esperada (en español, con el campo).
- **Solución:** compara la solicitud con `GET /openapi.json`. En el MCP, corrige ese argumento y vuelve a llamar.

### JSON_INVALIDO

- **Qué significa (400):** el cuerpo no es JSON válido (comillas, comas o llaves de más o de menos).
- **Solución:** genera el cuerpo con `JSON.stringify` (o el equivalente de tu lenguaje) en lugar de armarlo a mano.

### TIPO_DE_CONTENIDO

- **Qué significa (415):** la operación espera un cuerpo JSON y la solicitud no trae `Content-Type: application/json`
  (curl sin `-H`, por ejemplo, manda `application/x-www-form-urlencoded`).
- **Solución:** agrega la cabecera `Content-Type: application/json` y envía el cuerpo como JSON.

### NO_AUTENTICADO

- **Qué significa (401):** falta la llave de API o no es válida.
- **Solución:** envía `Authorization: Bearer fhn_live_…` (o `fhn_test_…` en un tenant de prueba) con una llave
  activa. Una llave `fhn_test_` no entra a un tenant de producción, ni una `fhn_live_` a uno de prueba.

### SOLO_ADMIN

- **Qué significa (403):** la operación requiere una llave con rol admin (registrar un CAI, anular, confirmar un salto
  de fecha, una nota de crédito sobre un original externo, llaves, webhooks y exportación).
- **Solución:** usa la llave admin del negocio.

### TENANT_FUERA_DEL_MODO_LOCAL

- **Qué significa (403):** la API corre en modo local (un solo negocio) y la llave es de otro tenant que no es
  `local` ni `demo` (p. ej. uno creado por fuera de la consola). Lo devuelve cualquier operación de `/v1`.
- **Solución:** usa una llave del tenant `local` (tu negocio) o del `demo`. Si el servidor sirve a varios negocios,
  el operador debe arrancarlo con `FHN_MODO=alojado` (y `FHN_CLAVE_CIFRADO`).

### CAJA_SIN_PUNTO

- **Qué significa (403):** la llave de caja no está atada a un establecimiento y punto de emisión. Lo devuelven
  la emisión y `GET /v1/libro-ventas` (una caja recibe solo el libro de su punto, y esta llave no tiene uno).
- **Solución:** crea otra llave de caja con establecimiento y punto de emisión.

### CAJA_NO_AUTORIZADA

- **Qué significa (403):** la llave de caja pidió emitir en otro establecimiento o punto de emisión.
- **Solución:** omite `establecimiento` y `puntoEmision`: los pone la llave.

### CAJA_INCOMPLETA

- **Qué significa (400):** al crear una llave de caja se indicó solo uno de establecimiento y punto de emisión.
- **Solución:** indica ambos.

### PUNTO_EMISION_REQUERIDO

- **Qué significa (400):** la emisión no dice en qué caja.
- **Solución:** indica `establecimiento` y `puntoEmision`, o usa una llave atada a una caja.

### IDEMPOTENCY_KEY

- **Qué significa (400):** la cabecera `Idempotency-Key` falta, está vacía o es demasiado larga (de 1 a 255
  caracteres visibles).
- **Solución:** envía la cabecera `Idempotency-Key` con un valor único por venta (p. ej. el id del pedido o de la venta) y, si
  reintentas esa misma venta, reutiliza el mismo valor: así nunca se emite dos veces.

### IDEMPOTENCIA_CONFLICTO

- **Qué significa (422):** esa clave de idempotencia ya se usó con otra venta. También lo usa el servidor MCP.
- **Solución:** usa una clave nueva para cada venta nueva.

### OPERADOR_REQUERIDO

- **Qué significa (400):** se pidió imprimir el operador sin indicar quién atiende. También lo usa el servidor MCP.
- **Solución:** indica `operador` (o la cabecera `X-Operador`).

### OPERADOR_CABECERA

- **Qué significa (400):** la cabecera `X-Operador` no se pudo decodificar.
- **Solución:** codifícala con `encodeURIComponent`.

### OPERADOR_CONFLICTO

- **Qué significa (400):** el operador del cuerpo y el de la cabecera no coinciden.
- **Solución:** envía uno solo, o el mismo en los dos.

### SIN_EMISOR

- **Qué significa (409):** el negocio aún no tiene emisor registrado.
- **Solución:** regístralo con `POST /v1/emisores`.

### EMISOR_EXISTE

- **Qué significa (409):** el negocio ya tiene emisor.
- **Solución:** cámbialo con `PATCH /v1/emisores/{id}`.

### EMISOR_RTN_INMUTABLE

- **Qué significa (422):** se intentó cambiar el RTN del emisor.
- **Solución:** el RTN identifica al obligado tributario y sus autorizaciones: para otro RTN, crea otro tenant.

### NO_ENCONTRADO

- **Qué significa (404):** el recurso (documento, emisor, autorización o ruta) no existe. También lo usa el
  servidor MCP.
- **Solución:** revisa el identificador o el número.

### CURSOR_INVALIDO

- **Qué significa (400):** el cursor de paginación no es válido.
- **Solución:** usa el valor `siguiente` de la página anterior, sin cambios.

### CUERPO_DEMASIADO_GRANDE

- **Qué significa (413):** el cuerpo supera 512 KB.
- **Solución:** divide la operación.

### CUERPO_NO_UTF8

- **Qué significa (400):** el cuerpo no es UTF-8 válido.
- **Solución:** envía el JSON en UTF-8; con curl, guárdalo en un archivo y usa `--data-binary @archivo.json`.

### DEMASIADOS_INTENTOS

- **Qué significa (429):** hubo demasiados intentos con llaves no válidas, o hay demasiadas llaves por validar
  a la vez en el servidor (cola llena o más de 5 s de espera).
- **Solución:** revisa que la llave esté completa y activa, y reintenta después de los segundos de la cabecera
  `Retry-After`.

### DEMASIADAS_SOLICITUDES

- **Qué significa (429):** se superó el límite de solicitudes por segundo de la llave.
- **Solución:** espera los segundos de `reintentarEn` (o `Retry-After`) y reintenta.

### LIMITE_SOLICITUDES

- **Qué significa (429):** ya hay demasiados reportes en curso.
- **Solución:** espera a que terminen y reintenta.

### LIMITE_MENSUAL

- **Qué significa (429):** el negocio alcanzó su límite de documentos del mes. `Retry-After` trae los segundos que
  faltan para el primer día del mes siguiente (00:00 en Honduras): un reintento automático antes no sirve.
- **Solución:** espera al mes siguiente o amplía el límite.

### PERIODO_DEMASIADO_GRANDE

- **Qué significa (422):** el período del reporte tiene más documentos que el máximo por reporte.
- **Solución:** divídelo en períodos más cortos (por ejemplo, un mes) y pide cada uno por separado.

### METODO_NO_PERMITIDO

- **Qué significa (405):** se pidió un reporte con `HEAD`.
- **Solución:** usa `GET`.

### ULTIMA_LLAVE_ADMIN

- **Qué significa (409):** se intentó revocar la única llave admin activa.
- **Solución:** crea otra llave admin antes de revocar esta.

### WEBHOOK_URL

- **Qué significa (422):** la URL del webhook no es aceptable: no se puede leer, lleva usuario o contraseña, apunta
  a una dirección interna o, en el modo alojado, no usa HTTPS.
- **Solución:** usa una URL pública con HTTPS.

### LIMITE_WEBHOOKS

- **Qué significa (409):** el negocio ya tiene el máximo de webhooks activos.
- **Solución:** desactiva uno (`DELETE /v1/webhooks/{id}`) antes de crear otro.

### WEBHOOK_INACTIVO

- **Qué significa (409):** se pidió reenviar una entrega, enviar un evento de prueba o rotar el secreto de un
  webhook desactivado. Un webhook desactivado no se reactiva.
- **Solución:** crea otro webhook con `POST /v1/webhooks` (su secreto es nuevo) y recupera lo que no llegó
  consultando la API (por ejemplo, `GET /v1/documentos?desde&hasta`).

### ENTREGA_VENCIDA

- **Qué significa (409):** se pidió reenviar una entrega de `autorizacion.*`, `ENTREGADA` o `FALLIDA`, cuyo cuerpo
  ya se vació por retención (`FHN_RETENCION_DIAS`, 30 días por defecto). Queda solo como registro de que el aviso
  se intentó. Una entrega de `documento.*` o `webhook.prueba` tan vieja ya se borró: da 404 `NO_ENCONTRADO`.
- **Solución:** consulta el dato en la API (por ejemplo, `GET /v1/autorizaciones/{cai}/estado`).

### LIMITE_PRUEBAS

- **Qué significa (409):** el webhook ya tiene 5 eventos de prueba (`webhook.prueba`) pendientes; vale también al
  reenviar una prueba terminada.
- **Solución:** espera a que se entreguen o fallen (cada prueba se intenta a lo sumo 3 veces) y revisa su estado
  con `GET /v1/webhooks/{id}/entregas`.

### BASE_NO_DISPONIBLE

- **Qué significa (503):** la base de datos se está reiniciando, se cayó o no tiene conexiones libres. La API
  sigue en pie y se recupera sola cuando la base vuelve. Trae `Retry-After`.
- **Solución:** reintenta después de los segundos de `Retry-After`. Al emitir, usa la misma `Idempotency-Key`:
  si el documento alcanzó a emitirse recibes el mismo (con `Idempotency-Replayed: true`), y si no, se emite una
  sola vez. Ningún número se pierde ni se repite.

### ERROR_INTERNO

- **Qué significa (500):** un error inesperado del servidor. Se registró para revisión.
- **Solución:** reintenta con la misma `Idempotency-Key`; si persiste, busca en el log del servidor la línea con el
  id de `error.solicitud` (o de la cabecera `Solicitud-Id`).

## API REST: modo `demo`

Solo en un servidor con `FHN_MODO=demo`, que crea entornos de prueba temporales. Todos traen el mismo cuerpo
`{ "error": { "codigo", "mensaje" } }` y, los 429 y 503, la cabecera `Retry-After`.

### DEMO_PAUSADO

- **Qué significa (503):** quien opera el servidor lo puso en pausa (`demo pausar` o `FHN_DEMO_PAUSADO=1`):
  no se crean entornos y los que hay no atienden.
- **Solución:** reintenta más tarde, después de los segundos de `Retry-After`.

### ORIGEN_NO_PERMITIDO

- **Qué significa (403):** `POST /v1/demo/entornos` llegó desde una página de otro sitio (su `Origin` no está en
  `FHN_DEMO_ORIGENES`). Una solicitud sin `Origin` (curl, el SDK) se atiende.
- **Solución:** crea el entorno desde un origen permitido o sin `Origin` (curl, el SDK).

### DEMO_LIMITE_ENTORNOS

- **Qué significa (429):** se alcanzó el límite de entornos de prueba: por dirección por día
  (`FHN_DEMO_ENTORNOS_POR_IP`), por minuto en todo el servicio (`FHN_DEMO_CREACIONES_POR_MINUTO`) o vigentes a la vez
  (`FHN_DEMO_MAX_ENTORNOS`).
- **Solución:** usa el entorno que ya creaste o reintenta después de los segundos de `Retry-After`.

### DEMO_SOLO_PRUEBA

- **Qué significa (403):** la llave no es de un entorno creado con `POST /v1/demo/entornos`. En modo `demo` el
  servidor no atiende otras.
- **Solución:** crea un entorno con `POST /v1/demo/entornos` y usa su llave.

### ENTORNO_VENCIDO

- **Qué significa (401):** el entorno de prueba pasó sus 24 horas (`FHN_DEMO_HORAS`). Se borra con todos sus datos
  en el minuto siguiente.
- **Solución:** crea otro con `POST /v1/demo/entornos`.

### DEMO_NO_DISPONIBLE

- **Qué significa (403):** la operación no existe en modo `demo`: webhooks (no hace solicitudes salientes),
  cambiar el emisor ficticio o crear llaves.
- **Solución:** pruébala en tu propia instalación ([autoalojamiento](autoalojamiento.md)).

### DEMO_LIMITE_SOLICITUDES

- **Qué significa (429):** el entorno usó todas sus solicitudes (`FHN_DEMO_SOLICITUDES_POR_ENTORNO`). Por minuto,
  el límite es `DEMASIADAS_SOLICITUDES`.
- **Solución:** crea otro entorno.

### DEMO_LIMITE_DOCUMENTOS

- **Qué significa (429):** el entorno emitió todos los documentos que permite (`FHN_DEMO_DOCUMENTOS`).
- **Solución:** crea otro entorno.

## Servidor MCP

El servidor MCP devuelve `{ codigo, errores }` en `structuredContent`. Usa estos códigos:

- `VALIDACION`: el SDK rechazó la operación; ver [VALIDACION](#validacion) y el código de cada problema.
- `OPERADOR_REQUERIDO`: ver [OPERADOR_REQUERIDO](#operador_requerido).
- `IDEMPOTENCIA_CONFLICTO`: ver [IDEMPOTENCIA_CONFLICTO](#idempotencia_conflicto).
- `NO_ENCONTRADO`: ver [NO_ENCONTRADO](#no_encontrado).
- `API_INACCESIBLE`: ver [API_INACCESIBLE](#api_inaccesible).
- `BASE_DEMO`: ver [BASE_DEMO](#base_demo).
- `CAI_DEMO`: ver [CAI_DEMO](#cai_demo).
- `SOLICITUD_INVALIDA`: un argumento no tiene la forma esperada; ver [SOLICITUD_INVALIDA](#solicitud_invalida).
- `CONFIRMACION_NO_DISPONIBLE`: ver [CONFIRMACION_NO_DISPONIBLE](#confirmacion_no_disponible).
- `CONFIRMACION_RECHAZADA`: ver [CONFIRMACION_RECHAZADA](#confirmacion_rechazada).

### CONFIRMACION_NO_DISPONIBLE

- **Qué significa:** `anular_documento` o `registrar_cai` necesitan la confirmación del usuario por elicitación MCP
  y el cliente MCP no la ofrece. No se hizo nada. (Anular un documento de prueba y registrar el CAI ficticio del
  demo no la necesitan.)
- **Solución:** registra el CAI tú con `npx -y @factura-hn/mcp registrar-cai`, usa un cliente con elicitación o, si
  aceptas que el asistente anule y registre CAI sin esa confirmación, agrega `FHN_MCP_PERMITIR_DESTRUCTIVAS=1` al
  `env` del servidor MCP y reinícialo.

### CONFIRMACION_RECHAZADA

- **Qué significa:** el servidor MCP pidió confirmación para anular o registrar un CAI y el usuario la rechazó, la
  canceló o no marcó la casilla. No se hizo nada.
- **Solución:** no la reintentes automáticamente: revisa los datos con el usuario y vuelve a llamar solo si lo pide.

En modo API, el servidor MCP pasa tal cual los códigos de la [API REST](#api-rest).

### API_INACCESIBLE

- **Qué significa:** en modo API, el servidor MCP no pudo conectar con la API de factura-hn (está apagada o la URL
  está mal escrita).
- **Solución:** revisa que la API esté en marcha y que `FHN_API_URL` sea correcta.
- **Base:** ninguna fiscal: es un error de conexión.

### BASE_DEMO

- **Qué significa:** se quiso registrar un CAI real en una base de demostración (la que tiene el CAI ficticio).
  Esa base no recibe CAI reales.
- **Solución:** para facturar de verdad, crea la base del negocio con `npx -y @factura-hn/mcp init` (sin `--demo`),
  registra ahí el CAI real y cambia `FHN_SQLITE` y `FHN_EMISOR` en la configuración del cliente MCP.
- **Base:** ninguna fiscal: separa la prueba de la facturación real (los números de una base de demostración ya se
  usaron en documentos de prueba).

### CAI_DEMO

- **Qué significa:** `registrar_cai` (o `registrar-cai`) recibió el CAI ficticio de prueba (`DEMO00-NO-VALIDO-…`),
  no uno de una resolución del SAR.
- **Solución:** el CAI ficticio solo se usa en la base de demostración que crea `npx -y @factura-hn/mcp init --demo`.
  Para facturar de verdad, registra el CAI de la resolución del SAR.
- **Base:** ninguna fiscal: un CAI ficticio no autoriza documentos reales.
