---
title: Recibir webhooks
description: Los avisos que envía la API de factura-hn, cómo verificar su firma con verificarFirmaWebhook, cómo se reintentan, reenvían y prueban, cómo rotar el secreto y cómo hacer un receptor que tolere repetidos.
sidebar:
  order: 6
---

La API REST avisa a tu sistema cuando pasa algo: se emite o se anula un documento, o un CAI está por vencer o se
agota. Cada aviso es un `POST` firmado a la URL que registres. Esta guía es solo para la API: con el SDK, lo
equivalente es `alEmitir` y `alAnular`, dentro de la transacción (ver [Fuera de línea](/guias/fuera-de-linea/)).

## Eventos

| Evento | Cuándo | `datos` |
|---|---|---|
| `documento.emitido` | Se emitió una factura o una nota | El documento |
| `documento.anulado` | Se anuló un documento (Art. 41) | El documento anulado |
| `autorizacion.por_vencer` | Un CAI entró en los dos meses previos a su fecha límite (Art. 59) o usó el 90 % del rango | La autorización y su estado |
| `autorizacion.agotada` | Un CAI agotó su rango | La autorización y su estado |

Los dos eventos de autorización se envían una vez por autorización. Además, `webhook.prueba` llega solo cuando lo
pides (ver «Probar, ver y reenviar entregas»).

Cada entrega lleva este cuerpo:

```json
{ "id": "…", "evento": "documento.emitido", "creado": "2026-11-24T15:00:00.000Z", "datos": { } }
```

`id` es un UUID por entrega. Es el mismo en cada reintento y en un reenvío manual, y va también en la cabecera
`X-FacturaHN-Entrega`. No se garantiza el orden de llegada.

## Registrar un webhook

Con la llave admin, `POST /v1/webhooks`:

```json
{ "url": "https://ejemplo.example/webhooks/factura-hn", "eventos": ["documento.emitido", "documento.anulado"] }
```

La respuesta trae el `webhook` y su `secreto` (`whsec_…`). El secreto se muestra **solo esa vez**: guárdalo en una
variable de entorno del receptor. `GET /v1/webhooks` los lista y `DELETE /v1/webhooks/{id}` desactiva uno.

- **Tope de 20.** Cada negocio tiene a lo sumo 20 webhooks activos. Con 20, crear otro da 409
  `LIMITE_WEBHOOKS`: desactiva uno antes (DEC-058).
- **URL.** En el modo alojado, solo HTTPS y nunca hacia direcciones internas. En el modo local, también http y
  hacia la red del negocio. Una URL que no cumple da `WEBHOOK_URL`.

## Verificar la firma

Cada entrega lleva la cabecera:

```text
X-FacturaHN-Firma: t=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>
```

Durante la gracia de una rotación del secreto, la cabecera trae **dos** `v1`: la entrega es válida si alguno
verifica con tu secreto.

`verificarFirmaWebhook` de `@factura-hn/cliente` la comprueba sin dependencias, con Web Crypto: funciona en
Node 20+, navegadores, Deno, Bun y entornos edge. Tres detalles importan:

1. **El cuerpo crudo.** La firma se calcula sobre el texto tal como llegó. Si tu framework ya lo convirtió a JSON,
   volver a serializarlo puede cambiar un espacio y la firma no coincide. En Express, usa
   `express.raw({ type: 'application/json' })` en esa ruta.
2. **`await`.** `verificarFirmaWebhook` devuelve una promesa. Sin `await`, la condición nunca rechaza.
3. **Antigüedad.** Una firma de más de 5 minutos no es válida (`toleranciaSegundos`, 300 por defecto). Protege
   contra repeticiones; el reloj del receptor debe estar en hora.

Si escribes tu propio verificador, recorre todas las entradas `v1` e ignora las que no conozcas (`v0=`, `v2=`…).
No armes un mapa de la cabecera: con dos `v1`, se queda con uno solo y la rotación te rechaza avisos válidos.

## Un receptor que tolera repetidos

La API puede entregar el mismo aviso más de una vez: si tu receptor procesó el aviso pero la respuesta no llegó,
la API lo reintenta. El receptor tiene que ser idempotente:

<!-- declaraciones:
declare const avisos: {
  yaProcesado(id: string): Promise<boolean>;
  procesarYMarcar(aviso: { id: string; evento: string; datos: unknown }): Promise<void>;
};
-->
```ts
import { verificarFirmaWebhook, type AvisoWebhook } from '@factura-hn/cliente';

// `cuerpo`: el texto tal como llegó, antes de JSON.parse. `firma`: la cabecera X-FacturaHN-Firma.
export async function recibirAviso(cuerpo: string, firma: string | null): Promise<number> {
  if (!(await verificarFirmaWebhook(cuerpo, firma, process.env.FHN_SECRETO_WEBHOOK!))) return 400;
  const aviso = JSON.parse(cuerpo) as AvisoWebhook;
  if (await avisos.yaProcesado(aviso.id)) return 204; // repetido: ya se procesó, no se repite el efecto
  // Procesa y guarda el id en la misma transacción de tu base. Si algo falla, lanza: tu servidor responde 500
  // y la API vuelve a intentarlo más tarde.
  await avisos.procesarYMarcar(aviso);
  return 204;
}
```

- **Responde 2xx solo cuando ya procesaste el aviso.** Cualquier otra respuesta, o ninguna en 10 segundos, cuenta
  como fallo y se reintenta.
- **Descarta repetidos por `id`.** Guarda los `id` procesados en tu base, con una restricción de unicidad. Un mapa
  en memoria se pierde al reiniciar el receptor.
- **Sé rápido.** Una entrega tiene 10 segundos en total. Si el trabajo tarda más, guarda el aviso, responde 2xx y
  procésalo aparte.

El ejemplo `examples/express` del repositorio tiene un receptor completo en Express, que corre en la CI.

## Reintentos

Los avisos se encolan en la misma transacción que la operación: si la emisión se revierte, no hay aviso. Un
despachador los entrega cada 5 segundos.

- Hasta **22 intentos** durante unos **3 días**, con espera creciente: 30 s, 1 min, 2 min, … 4 h 16 min y después
  6 h entre cada uno. Cada espera varía ±20 % al azar, para que los avisos que fallaron juntos no vuelvan todos a
  la vez. Entre el primer intento y el último pasan unas 74 horas y media de media.
- Después, la entrega queda `FALLIDA` y se puede reenviar a mano.
- Lo pendiente de un webhook desactivado no se entrega.
- Un receptor lento solo retrasa los avisos de su propio negocio.
- Pasados `FHN_RETENCION_DIAS` días (30 por defecto), las entregas terminadas de `documento.*` y `webhook.prueba`
  se borran.

Si tu receptor estuvo caído más tiempo que los reintentos, reenvía las entregas `FALLIDA` (abajo) o recupera lo que
falta consultando la API: por ejemplo, `GET /v1/documentos?desde&hasta` para el período.

## Probar, ver y reenviar entregas

Con la llave admin:

- `POST /v1/webhooks/{id}/probar` encola un aviso `webhook.prueba` solo para ese webhook, firmado. Se intenta a lo
  sumo 3 veces, no 3 días. Sirve para probar el receptor sin emitir un documento. Su `datos` trae `webhookId` y un
  mensaje. Cada webhook tiene a lo sumo 5 pruebas pendientes.
- `GET /v1/webhooks/{id}/entregas` lista las entregas, de la más reciente a la más antigua, paginadas como las
  demás listas, con `?estado=PENDIENTE|ENTREGADA|FALLIDA` opcional. Cada una trae su estado, sus intentos, el
  próximo intento y el último código o error del receptor.
- `POST /v1/webhooks/{id}/entregas/{entrega}/reenviar` vuelve a poner la entrega en la cola, con el mismo `id`.
  Una `FALLIDA` empieza otra vez sus 3 días de reintentos; una pendiente se adelanta a ahora.

## Rotar el secreto

`POST /v1/webhooks/{id}/rotar-secreto` crea un secreto nuevo y lo muestra **solo esa vez**. Durante la gracia
(`graciaHoras`, 24 por defecto, de 0 a 168), cada entrega se firma con los dos secretos; al terminar, solo con el
nuevo. `webhook.graciaHasta` dice hasta cuándo. Si rotas otra vez durante la gracia (por ejemplo, un reintento),
se conserva el secreto más viejo, el que tu receptor puede seguir usando: valen ese y el último, y el intermedio se
descarta.

1. Asegúrate de que el receptor usa un verificador que acepta varios `v1` (`verificarFirmaWebhook` de
   `@factura-hn/cliente` lo hace).
2. Rota con `POST /v1/webhooks/{id}/rotar-secreto`.
3. Cambia `FHN_SECRETO_WEBHOOK` en el receptor antes de que termine la gracia.
4. Comprueba con `POST /v1/webhooks/{id}/probar`.

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`LIMITE_WEBHOOKS`](/referencia/errores/#limite_webhooks) | Ya hay 20 webhooks activos |
| [`WEBHOOK_URL`](/referencia/errores/#webhook_url) | URL ilegible, con usuario o contraseña, hacia una dirección interna o, en modo alojado, sin HTTPS |
| [`SOLO_ADMIN`](/referencia/errores/#solo_admin) | Los webhooks se administran con la llave admin |
| [`WEBHOOK_INACTIVO`](/referencia/errores/#webhook_inactivo) | Reenviar, probar o rotar un webhook desactivado |
| [`ENTREGA_VENCIDA`](/referencia/errores/#entrega_vencida) | Reenviar un aviso de autorización cuyo cuerpo ya se vació por retención |
| [`LIMITE_PRUEBAS`](/referencia/errores/#limite_pruebas) | Ya hay 5 eventos de prueba pendientes para ese webhook |

En el receptor, una firma que no verifica no es un código de la API: es tu respuesta 400. Las causas habituales
son el cuerpo ya convertido a JSON, el secreto equivocado o el reloj del receptor desfasado.

## Fuentes

- [Referencia de la API](/referencia/api/), «Webhooks»; `@factura-hn/cliente` (`verificarFirmaWebhook`,
  `AvisoWebhook`); `examples/express`.
- DEC-033 y DEC-058 en [decisiones](/referencia/decisiones/).
