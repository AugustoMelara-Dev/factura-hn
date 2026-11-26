---
title: CAI
description: Qué es el CAI, qué datos de la resolución se registran, cómo registrar una autorización, sus alertas de fecha límite y de rango, y cómo migrar una serie con ultimoEmitidoAntes.
sidebar:
  order: 2
---

El **CAI** es el código de la autorización que la autoridad tributaria otorga para emitir un rango de
documentos. El Reglamento lo define como «una serie alfanumérica generada electrónicamente» (Art. 4 num. 7) y no
publica su longitud ni su formato.

Cada autorización es para **un punto de emisión y un tipo de documento** (Art. 59), con un rango de números y
una fecha límite de emisión (Art. 10 num. 3-5). Su vigencia máxima es de un año (Art. 62). Ver
[Cómo funciona](/conceptos/como-funciona/).

## Qué datos se registran

Los datos salen de la resolución. En el SDK forman una `AutorizacionCAI`:

| Campo | Qué es | Obligatorio |
|---|---|---|
| `cai` | El código, tal como viene en la resolución | Sí |
| `tipoDocumento` | `'01'` Factura, `'06'` Nota de Crédito, `'07'` Nota de Débito | Sí |
| `establecimiento` | Hasta 3 dígitos; la casa matriz es `000` | Sí |
| `puntoEmision` | Hasta 3 dígitos | Sí |
| `rangoInicial`, `rangoFinal` | El primer y el último correlativo autorizados, de 1 a 99,999,999 | Sí |
| `fechaLimiteEmision` | `AAAA-MM-DD` | Sí |
| `fechaAutorizacion` | La fecha de la resolución, `AAAA-MM-DD`. Permite revisar el año de vigencia (Art. 62) | No |
| `ultimoEmitidoAntes` | Solo al migrar una serie que ya se usaba fuera de este sistema. Ver [abajo](#migrar-una-serie-ultimoemitidoantes) | No |
| `prueba` | Solo para un CAI ficticio. Ver [Modo de prueba](/empezar/modo-de-prueba/) | No |

El CAI, el rango y la fecha límite se imprimen en cada documento (Art. 10 num. 3-5).

**Formato del CAI.** Como el Reglamento no fija un formato, el SDK acepta letras, dígitos y guiones, y recorta
los espacios del inicio y del final. Un espacio o un signo en medio da
[`CAI_FORMATO`](/referencia/errores/#cai_formato): suele ser un error al copiarlo. La forma `6-6-6-6-6-2` que se
observa en los CAI solo se exige con la opción `caiEstricto`, y no es normativa.

## Registrar una autorización

Se registra **una vez por resolución**, desde la pantalla de configuración de tu sistema, no en cada arranque
ni en cada venta. Los datos los carga el usuario; no van escritos en el código.

```js
import { registrarAutorizacion } from 'factura-hn';

const autorizacion = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', // de la resolución (este es ficticio)
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
  fechaAutorizacion: '2026-07-01',
};
await registrarAutorizacion(almacen, autorizacion);
```

`almacen` es tu [almacén fiscal](/conceptos/almacen/).

Con `crearFacturador`, el establecimiento y el punto los pone el facturador:
`caja.registrarAutorizacion({ cai, tipoDocumento, rangoInicial, rangoFinal, fechaLimiteEmision })`.

Si vas a emitir notas de crédito o de débito, registra también las autorizaciones de los tipos `06` y `07`:
cada tipo tiene su propia serie.

Al registrar, el SDK revisa:

| Código | Cuándo |
|---|---|
| [`RANGO_SOLAPADO`](/referencia/errores/#rango_solapado) | El rango comparte números con otro CAI de la misma serie |
| [`AUTORIZACION_DUPLICADA`](/referencia/errores/#autorizacion_duplicada) | Ese CAI ya está registrado en la serie |
| [`RANGO`](/referencia/errores/#rango) · [`FECHA_LIMITE`](/referencia/errores/#fecha_limite) | El rango o la fecha no tienen la forma correcta |

Con `fechaAutorizacion`, si la fecha límite queda a más de un año de la resolución (Art. 62), sale el aviso
[`AVISO_VIGENCIA_MAYOR_1_ANIO`](/referencia/errores/#aviso_vigencia_mayor_1_anio). No bloquea el registro: lo
devuelven `registrarAutorizacionConAvisos(almacen, autorizacion)` (en `advertencias`, junto a la autorización
guardada) y `validarAutorizacion(autorizacion)`, queda en el evento `AUTORIZACION_REGISTRADA` de la bitácora y lo
llevan en `advertencias` los documentos emitidos con esa autorización. Para verlo antes de guardar, llama a
`validarAutorizacion` en la pantalla de configuración. Suele ser un error al copiar la fecha.

Un CAI registrado no se borra: las autorizaciones son parte del archivo fiscal, y los almacenes de Postgres y
SQLite lo impiden aunque alguien edite la base a mano. Cada registro queda en la bitácora
(`AUTORIZACION_REGISTRADA`).

### Renovar

Cuando la autoridad otorga un rango nuevo para la misma caja y tipo, se registra igual. La numeración continúa
sola: `emitir` elige la autorización vigente que cubre el siguiente número. Si la anterior venció con números
sin usar, esos números se reportan como no utilizados (Art. 42); `documentosNoUtilizados` y
`noUtilizadosDelAlmacen` calculan los rangos, la causal y la fecha límite del aviso.

## Alertas

`estadoAutorizacion` dice cuánto le queda a una autorización. Úsalo para mostrar un aviso en la caja antes de
quedarse sin números o sin vigencia, porque la solicitud de un CAI nuevo toma tiempo.

```js
import { estadoAutorizacion } from 'factura-hn';

// La autorización de arriba, con el correlativo 4600 ya emitido.
const estado = estadoAutorizacion(autorizacion, 4600, { hoy: '2027-05-15' });

estado.vigente;               // true
estado.diasRestantes;         // 46
estado.correlativosRestantes; // 400
estado.porcentajeUsado;       // 92
estado.alertas.map((a) => a.codigo); // ["AVISO_VENCIMIENTO", "AVISO_RANGO"]
```

| Alerta | Cuándo |
|---|---|
| [`AVISO_VENCIMIENTO`](/referencia/errores/#aviso_vencimiento) | Desde la misma fecha, dos meses de calendario antes de la fecha límite. `diasAviso` la cambia por un número de días |
| [`AVISO_RANGO`](/referencia/errores/#aviso_rango) | Al usar el 90 % del rango. `porcentajeAviso` cambia el porcentaje |
| [`AUTORIZACION_VENCIDA`](/referencia/errores/#autorizacion_vencida) | Pasó la fecha límite. `emitir` ya no la usa |
| [`RANGO_AGOTADO`](/referencia/errores/#rango_agotado) | Se usaron todos los números |

El aviso de vencimiento sigue al Art. 59: la nueva autorización se solicita «dentro de los dos (2) meses
previos» a la fecha límite.

Los dos meses se cuentan como meses de calendario, no como 60 días.

La API expone lo mismo en `GET /v1/autorizaciones/{cai}/estado` y el MCP en la herramienta `estado_cai`.

## Migrar una serie: `ultimoEmitidoAntes`

Si la caja ya emitía con esa autorización en otro sistema o en talonario, indica el último correlativo emitido
antes de pasar a factura-hn:

```js
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
  ultimoEmitidoAntes: 1250, // lo emitido fuera de este sistema
});
// La siguiente factura de la serie es la 000-001-01-00001251.
```

Con eso:

- la serie continúa en el siguiente número, sin reutilizar los ya emitidos;
- una nota de crédito o de débito sobre un número igual o menor se acepta como documento externo, con el aviso
  [`AVISO_ORIGINAL_EXTERNO`](/referencia/errores/#aviso_original_externo);
- una nota sobre un número mayor que todavía no se emitió es un error
  ([`REFERENCIA_NO_EXISTE`](/referencia/errores/#referencia_no_existe)).

Omite el campo en una autorización nueva.

## Siguientes pasos

- Las funciones `registrarAutorizacion`, `estadoAutorizacion` y `documentosNoUtilizados`, en la
  [referencia del SDK](/referencia/sdk/).
- Solicitar y renovar autorizaciones ante la autoridad: [Ir a producción](/produccion/).
