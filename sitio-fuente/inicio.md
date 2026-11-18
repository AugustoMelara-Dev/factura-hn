# Facturación SAR Honduras, sin inventar reglas

**factura-hn** emite facturas, notas de crédito y notas de débito conforme al Reglamento del Régimen de
Facturación (Acuerdo 481-2017). Cada regla cita su artículo y tiene una prueba. Es código abierto (MIT).

- **Numeración atómica y sin huecos.** Cada número se reserva en la misma transacción que guarda el
  documento, y nunca se borra ni se reutiliza.
- **Dinero exacto.** Sin punto flotante. El ISV sigue el redondeo del Art. 9 de la Ley del ISV.
- **Documentos inmutables.** Se anulan (Art. 41) o se corrigen con notas 06/07.
- **Bitácora de auditoría** con quién hizo cada operación (Art. 53 num. 2).

## Tres formas de usarlo

| | Para quién | Empieza aquí |
|---|---|---|
| **SDK** | Proyectos JavaScript/TypeScript que emiten con su propia base (PostgreSQL o SQLite) | [Guía rápida del SDK](../docs/guia-sdk.md) |
| **API REST** | Cualquier lenguaje, o varias cajas contra un servidor del negocio | [Guía de la API](../docs/api.md) · [Autoalojamiento](../docs/autoalojamiento.md) |
| **Servidor MCP** | Agentes de IA (Claude, Cursor…) que emiten, consultan y anulan | [README del MCP](../packages/mcp/README.md) |

Pruébalo sin instalar nada en el [playground](playground.md): el SDK corre en tu navegador con CAI ficticios.

## Con un agente de IA, en un prompt

**SDK** (tu proyecto JS/TS emite con su propia base):

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

**API** (cualquier lenguaje; la API de factura-hn emite):

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

## Qué tan listo está

- La [matriz de cumplimiento](../docs/investigacion.md) lista cada artículo, cómo se cumple y con qué prueba.
- Algunas interpretaciones esperan respuesta del SAR. La [consulta al SAR](../docs/consulta-sar.md) las reúne; la más
  importante (P-02) decide si se puede ofrecer una API alojada por terceros.
- Versión 0.x: puede haber cambios incompatibles entre versiones menores (ver el
  [CHANGELOG](../CHANGELOG.md)).

> factura-hn no es asesoría fiscal ni un sistema autorizado por el SAR. Quien emite sigue siendo responsable
> de cumplir el Reglamento; revisa la configuración con tu contador.
