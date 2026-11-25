---
title: Profesional independiente
description: Lo que se sabe y lo que falta confirmar para que un profesional independiente facture servicios con factura-hn, y cómo se configuraría si su contador confirma que puede emitir Factura 01.
sidebar:
  order: 5
---

:::caution[Guía orientativa]
Guía orientativa, pendiente de revisión por un contador. No sustituye asesoría fiscal.
:::

:::danger[Casi todo está por confirmar]
El repositorio no sabe si un profesional independiente puede facturar sus honorarios con Factura (01) como
autoimpresor por sistema, en lugar del Recibo por Honorarios (04), ni cómo se tratan el ISV y las retenciones de
esos honorarios (F-16). No configures factura-hn para emitir honorarios hasta que tu contador lo confirme con su
fuente.
:::

## Perfil

Una persona que presta servicios profesionales (consultoría, diseño, asesoría técnica u otros) a empresas y a
personas. Pocas facturas al mes, casi siempre a clientes con RTN, y en papel carta o PDF.

## Lo que se sabe, con su fuente

- **El Recibo por Honorarios Profesionales (04) solo se emite por imprenta** (Reglamento, Art. 46, C L.2039-2044).
  El Art. 47 excluye a los honorarios del autoimpresor por sistema. Por eso factura-hn rechaza el tipo 04 con
  `TIPO_NO_EMITIBLE`: no hay forma de emitirlo desde el sistema.
- **Momento de emisión en servicios**: al pago o al otorgamiento del crédito, lo primero que ocurra (Art. 14).
- **Un documento por servicio cobrado** (Art. 9), con el nombre, el RTN y la fecha si el cliente lo usa como crédito
  fiscal (Art. 11 num. 1 a-c).

## Configuración, si el contador confirma la Factura 01

| | |
|---|---|
| **Camino** | SDK (`factura-hn`) si tiene un sistema propio en JavaScript o TypeScript. Si factura desde un asistente de IA (Claude Desktop, Cursor), el servidor MCP (`@factura-hn/mcp`) con SQLite en su computadora |
| **Cajas** | Una: un establecimiento y un punto de emisión |
| **Fuera de línea** | Opcional: con SQLite emite sin internet |
| **Impreso** | Carta: `renderizarHTML(doc)` o `renderizarPDF(doc, { formato: 'carta' })`. El MCP devuelve el impreso en texto |
| **Documentos** | Factura (01). Nota de Crédito (06) si hay descuentos o devoluciones posteriores |

Con el MCP, para probar: `npx -y @factura-hn/mcp init --demo`. Ver [Servidor MCP](/ia/mcp/).

## Ejemplo: un servicio a una empresa

Solo para ver cómo quedaría el documento. Usa la demo: CAI ficticio `DEMO00-NO-VALIDO-…` y la leyenda «DOCUMENTO DE
PRUEBA — SIN VALOR FISCAL». El tratamiento de ISV del servicio está por confirmar (F-16): el ejemplo lo marca de
forma explícita para que no pase inadvertido.

```bash
npm install factura-hn
```

```ts
import { writeFile } from 'node:fs/promises';
import { renderizarHTML, type Emisor } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

// Datos del profesional, tal como están en su RTN (estos son ficticios).
const emisor: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Consultoría Demostración',
  nombreComercial: 'Consultoría Demostración',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'contacto@ejemplo.example',
};

// En prueba, en memoria: CAI ficticio y leyenda de prueba en el impreso.
const facturador = await crearFacturadorDemo({ emisor });

// Un servicio cobrado a una empresa con RTN. El precio se pasa sin ISV.
const factura = await facturador.emitir({
  cliente: { nombre: 'Comercial Ejemplo S. de R.L.', rtn: '99990000000002' },
  lineas: [{
    descripcion: 'Asesoría técnica, noviembre de 2026',
    cantidad: '1',
    precioUnitario: '8000.00',
    unidad: 'servicio',
    isv: 'ISV15', // el tratamiento del servicio está por confirmar con tu contador (F-16)
  }],
});
await writeFile('factura-servicio.html', renderizarHTML(factura)); // carta
```

Escribe `factura-servicio.html` con la factura `000-001-01-00000001`. Si el contador indica otro tratamiento, se
cambia `isv` en la línea; factura-hn no decide cuál corresponde.

## Por confirmar con fuente

:::caution[Por confirmar con fuente]
- **Si un profesional independiente puede emitir Factura (01) como autoimpresor** por sistema en lugar del Recibo
  por Honorarios (04), que es solo de imprenta (F-16, pregunta nueva fuera de P-01 a P-14).
- **ISV sobre honorarios profesionales**: si aplica, a qué tasa o si están exentos (F-16).
- **Retenciones sobre honorarios** y el Comprobante de Retención (05), que factura-hn no emite (F-16 y F-15).
- **Qué modalidad le corresponde** según su actividad: sistema, imprenta o máquina registradora (F-20).

Ninguna de estas preguntas está todavía en la [consulta al SAR](/produccion/consulta-sar/), que además aún no se ha
enviado. Si tienes la fuente (un artículo o una respuesta escrita del SAR), apórtala con la plantilla «Regla
fiscal»: ver [Contribuir](/ayuda/contribuir/).
:::

## Qué confirmar con tu contador

- Qué documento debe emitir por sus honorarios, y con qué fuente.
- El tratamiento de ISV de sus servicios.
- Las retenciones que le aplican sus clientes.

Siguiente: [Ir a producción](/produccion/).
