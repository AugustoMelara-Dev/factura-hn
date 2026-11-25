---
title: CAI y rangos
description: Cómo solicitar el CAI, registrarlo en factura-hn, pasar de la demo al CAI real, renovarlo antes de que venza o se agote y qué hacer con los rangos no utilizados.
sidebar:
  order: 2
---

El CAI (Código de Autorización de Impresión) es la autorización del SAR para emitir un rango de números de un tipo
de documento, en un punto de emisión, hasta una fecha límite. Esta página cubre el ciclo completo: pedirlo,
registrarlo, pasar de la demo al real, renovarlo y reportar lo que no se usó.

Los artículos son del Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas). Las citas
«C L.n» remiten a la línea del texto consolidado con el que trabaja el proyecto (ver
[Normativa](/referencia/normativa/)).

## Solicitar el CAI

Lo hace el negocio ante el SAR, después de inscribirse en el Régimen de Facturación (Art. 45) y como autoimpresor
por sistema computarizado (Art. 47), y de presentar la Declaración Jurada del Art. 53. El orden completo está en
[Trámites ante el SAR](/produccion/tramites/).

Lo que dice el Reglamento:

- La autorización se solicita **electrónicamente**, **por punto de emisión y por tipo de documento**, con su rango
  (Art. 59, C L.2245-2260).
- El autoimpresor por sistema la pide **por cada sistema** y tipo de documento (Art. 61, C L.2279-2295).
- La vigencia máxima es de **1 año**. Vencida, el documento pierde validez (Art. 62, C L.2297-2303).
- Si la solicitud se rechaza, el negocio se presenta dentro de 10 días hábiles o pide una verificación (Art. 64,
  C L.2347-2355).

En la práctica, un negocio con una caja que emite facturas y notas de crédito necesita dos autorizaciones: una
para el tipo 01 y otra para el 06 en el mismo punto de emisión. Con tres cajas, una por tipo en cada caja.

:::caution[Por confirmar con fuente]
El repositorio no tiene el procedimiento actual de la solicitud: el formulario, la pantalla de la Oficina Virtual,
los anexos y el tiempo de respuesta (pregunta P-03). Tampoco sabe qué es «un Sistema» para el Art. 61 cuando
la API está alojada por un tercero para varios negocios (pregunta P-02). Confírmalo con tu contador. La
consulta está en [Consulta al SAR](/produccion/consulta-sar/) y aún no se ha enviado.
:::

## Qué trae la resolución y dónde va cada dato

Cada documento impreso debe llevar el CAI, la fecha límite de emisión y el rango autorizado (Art. 10 num. 3-5,
C L.600-605). Por eso factura-hn los guarda en la autorización y los copia en cada documento.

| Dato de la resolución | Campo en factura-hn | Nota |
|---|---|---|
| CAI | `cai` | Se copia tal cual. Se aceptan letras, dígitos y guiones (DEC-013). El Reglamento no publica un formato (Art. 4 num. 7) |
| Tipo de documento | `tipoDocumento` | `'01'`, `'06'` o `'07'` |
| Establecimiento y punto de emisión | `establecimiento`, `puntoEmision` | Tres dígitos cada uno. Casa matriz = `000` |
| Rango autorizado | `rangoInicial`, `rangoFinal` | El correlativo de 8 dígitos, sin el resto del número |
| Fecha límite de emisión | `fechaLimiteEmision` | `YYYY-MM-DD` |
| Fecha de la resolución | `fechaAutorizacion` | Opcional. Con ella, el SDK avisa si la vigencia pasa de 1 año (`AVISO_VIGENCIA_MAYOR_1_ANIO`, Art. 62) |

Los datos los escribe una persona desde la resolución, en una pantalla de configuración o en un script de
instalación. No van en el código y nadie los «completa» ni los adivina: un dato mal escrito deja mal la
numeración desde el primer documento, y una autorización registrada no se puede borrar.

## Registrar el CAI

### Con el SDK

```ts
import { registrarAutorizacion } from 'factura-hn';

// Una vez por resolución del SAR. Todos los datos salen de la resolución (estos son ficticios).
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',          // una autorización por tipo de documento…
  establecimiento: '000',       // …y por punto de emisión (Art. 59)
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
  fechaAutorizacion: '2026-11-20', // opcional: con ella, avisa si la vigencia pasa de 1 año (Art. 62)
});
```

`almacen` es tu `AlmacenPostgres` o `AlmacenSQLite`. Con `crearFacturador`, `caja.registrarAutorizacion({ … })`
pone el establecimiento y el punto de emisión de la caja. Errores frecuentes al registrar:

- `RANGO_SOLAPADO` o `AUTORIZACION_DUPLICADA`: ese rango o ese CAI ya están registrados;
- `CAI_FORMATO`: el CAI tiene un carácter que no es letra, dígito ni guion;
- `RANGO`: el rango está invertido o fuera de 1 a 99 999 999.

Todos están en [Errores](/referencia/errores/).

### Con la API

Con la llave **admin** (la de caja no registra CAI). El cuerpo va en un archivo UTF-8:

```json
{
  "cai": "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4",
  "tipoDocumento": "01",
  "establecimiento": "000",
  "puntoEmision": "001",
  "rangoInicial": 1,
  "rangoFinal": 5000,
  "fechaLimiteEmision": "2027-06-30"
}
```

```bash
curl -f -X POST http://127.0.0.1:8787/v1/autorizaciones \
  -H "authorization: Bearer $LLAVE_ADMIN" -H "content-type: application/json" \
  --data-binary @autorizacion.json
```

Las validaciones son las del núcleo. Un CAI ficticio (`DEMO00-…`) en un negocio real necesita `"prueba": true`
explícito (`AUTORIZACION_DEMO_SIN_PRUEBA`, DEC-093). Ver [API REST](/referencia/api/).

### Con el MCP

En una línea; funciona igual en PowerShell, cmd y bash:

```bash
npx -y @factura-hn/mcp registrar-cai --base C:/negocio/factura.db --cai A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4 --tipo 01 --establecimiento 000 --punto 001 --desde 1 --hasta 5000 --fecha-limite 2027-06-30
```

La herramienta `registrar_cai` hace lo mismo desde el asistente. Está marcada como destructiva porque no se puede
deshacer, y su descripción le exige al asistente no inventar ningún dato y confirmarlos contigo antes de
registrar (DEC-081).

### Si ya emitiste con ese CAI en otro sistema

Si parte del rango ya se usó en un talonario u otro sistema, indica el último número usado. La serie continúa en el
siguiente y no repite números:

```ts
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
  ultimoEmitidoAntes: 120, // el último número que se usó fuera de este sistema; la serie sigue en el 121
});
```

En la API es el mismo campo; en el MCP, `--ultimo-emitido-antes 120`. Es una decisión pendiente de revisión
(DEC-008 [REVISAR]).

## Pasar de la demo al CAI real

La demo (`crearFacturadorDemo`, el tenant `demo` de la API o `init --demo` del MCP) usa CAI ficticios
`DEMO00-NO-VALIDO-…`. Todo lo que emite lleva la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y queda fuera del
libro de ventas y de la exportación (DEC-063, DEC-064).

**Lo recomendado: una base nueva para producción.** Prueba en un almacén y emite de verdad en otro. Así la serie
real empieza en el primer número de tu resolución y no comparte historia con la demo.

Si aun así registras el CAI real en el almacén donde probaste, estas son las reglas (DEC-091):

- **Un punto de emisión pasa de prueba a real, nunca al revés.** Registrar un CAI real en un punto que solo tiene
  autorizaciones de prueba se acepta. Desde ese momento, la demo de ese punto queda retirada en todos los tipos:
  no se vuelve a usar para emitir.
- Los documentos de prueba ya emitidos no cambian: conservan la leyenda y siguen fuera de los reportes.
- **Un número no se repite en una serie.** Si tu rango real empieza en 1 y ya emitiste documentos de prueba en esa
  serie, el registro da `RANGO_USADO_EN_PRUEBA` (Arts. 10 num. 3-5 y 59). La solución es registrar el CAI en una
  base nueva. Si tu rango empieza después del último número de prueba, sí se acepta.
- Lo contrario se rechaza: una autorización de prueba en un punto que tiene o tuvo una real da
  `AUTORIZACION_MODO_MEZCLADO`.

En la API, el tenant `demo` no acepta un CAI real (`AUTORIZACION_REAL_EN_DEMO`); en el MCP, la base de prueba
tampoco (`BASE_DEMO`). En los dos casos se configura el negocio aparte: el tenant `local` con `FHN_DEMO=0`, o una
base SQLite nueva con `npx -y @factura-hn/mcp init`.

## Renovar antes de vencer o de agotar

El Reglamento pide solicitar la nueva autorización **dentro de los dos meses previos** a la fecha límite, con una
sola solicitud por punto hasta agotar (Art. 59, C L.2263-2266). La vigencia máxima es de 1 año (Art. 62).

factura-hn avisa en estos casos:

| Alerta | Cuándo | Fuente |
|---|---|---|
| `AVISO_VENCIMIENTO` | Desde la misma fecha, dos meses de calendario antes de la fecha límite | Art. 59; la forma de contar los dos meses es DEC-025 [REVISAR] |
| `AVISO_RANGO` | Al usar el 90 % del rango (configurable con `porcentajeAviso`) | Decisión operativa, no fiscal |
| `AUTORIZACION_VENCIDA` | Pasó la fecha límite: no se emite más con ese CAI | Art. 62 |
| `RANGO_AGOTADO` | Se usó el último número del rango | Art. 59 |

Para mostrarlas en la caja con el SDK:

```ts
import { estadoAutorizacion, identificadorDe, type AlmacenFiscal } from 'factura-hn';

// Para el aviso de la caja: la autorización en uso de una serie y sus alertas.
async function alertasDeLaSerie(almacen: AlmacenFiscal, establecimiento: string, puntoEmision: string) {
  const id = identificadorDe({ establecimiento, puntoEmision, tipoDocumento: '01' });
  return almacen.transaccion(async (tx) => {
    const { ultimo } = await tx.bloquearSerie(id);
    const autorizaciones = await tx.autorizaciones(id);
    const enUso = autorizaciones.find((a) => (ultimo ?? 0) < a.rangoFinal) ?? autorizaciones.at(-1);
    if (!enUso) return [];
    const ultimoDeEsta = ultimo === null || ultimo < enUso.rangoInicial ? null : ultimo;
    return estadoAutorizacion(enUso, ultimoDeEsta).alertas; // AVISO_VENCIMIENTO, AVISO_RANGO, AUTORIZACION_VENCIDA, RANGO_AGOTADO
  });
}

const alertas = await alertasDeLaSerie(almacen, '000', '001');
for (const a of alertas) console.warn(a.codigo, a.mensaje);
```

Con la API: `GET /v1/autorizaciones/{cai}/estado`, o los webhooks `autorizacion.por_vencer` (alerta del Art. 59 o
90 % del rango) y `autorizacion.agotada`. Con el MCP: la herramienta `estado_cai`.

**Cuando llega la nueva resolución**, se registra igual que la primera. Si el rango nuevo continúa la numeración
(por ejemplo, del 5001 al 10000), la serie pasa sola de una autorización a la otra: el almacén lleva un contador
por identificador `NNN-NNN-TT`, no por CAI, y rechaza rangos que se solapan.

:::caution[Por confirmar con fuente]
No se sabe si hay una fecha mínima para la primera emisión de una serie, por ejemplo la fecha de la resolución
(pregunta P-13). factura-hn no pone piso: la fecha de emisión es siempre la de hoy en Honduras (DEC-022). Ver
[Consulta al SAR](/produccion/consulta-sar/).
:::

## Rangos no utilizados

Los números que quedan sin usar se comunican al SAR **dentro de los diez días hábiles del mes siguiente** al
acontecimiento (Art. 42, C L.1958-1990). El Art. 42 enumera doce causales; entre ellas, el vencimiento de la
autorización, la baja del punto de emisión, el cese de operaciones y las fallas técnicas del sistema.

factura-hn calcula qué rangos quedaron sin usar, la causal y la fecha límite del aviso, pero **no envía el aviso**:
se hace en el sistema del SAR. Cómo obtener la lista cada mes está en
[Operación mensual](/produccion/operacion-mensual/#documentos-no-utilizados).

Un CAI vencido con números libres no se puede seguir usando: la serie salta a la siguiente autorización vigente y
los números saltados son los que hay que reportar.
