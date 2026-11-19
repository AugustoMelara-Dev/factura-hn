# Modelo de negocio

## Principio

El cumplimiento fiscal no se cobra. Todo lo que un negocio necesita para emitir conforme al Reglamento, en sus
propios equipos, es gratis y de código abierto (MIT), para siempre:

| Gratis | Qué incluye |
|---|---|
| **SDK** (`factura-hn`) | Reglas, numeración, cálculo, impresión, anulación, notas 06/07, libro de ventas |
| **Adaptadores** (`@factura-hn/sqlite`, `@factura-hn/postgres`) y **PDF** | Almacén fiscal probado y PDF carta/ticket |
| **Modo local** de la API (Docker) | Servidor del negocio para varias cajas, con su base, llaves y bitácora |
| **Cliente, MCP, ejemplos y documentación** | Integración con cualquier lenguaje y con agentes de IA |

Ninguna función fiscal queda detrás de un pago, ni ahora ni en el futuro. Una corrección de cumplimiento llega a
todas las versiones con soporte.

## API alojada: solo después de la respuesta del SAR (P-02)

El código del modo alojado (varios negocios en un servidor, aislados con RLS) existe y está probado, pero
**no se ofrece como servicio** hasta que el SAR responda por escrito la
[consulta P-02](consulta-sar.md#p-02-sistema-alojado-en-la-nube-por-un-tercero). El Art. 47 pide registrar
«el establecimiento donde se encuentre el servidor», y en la nube ese servidor lo opera un tercero.

| Respuesta del SAR | Qué hacemos |
|---|---|
| Lo permite (con o sin condiciones) | Ofrecemos la API alojada cumpliendo las condiciones, documentadas en `docs/investigacion.md` |
| Lo permite solo con servidor en el establecimiento | Ofrecemos instalación y soporte del modo local, no alojamiento |
| No responde | No hay servicio alojado. Seguimos con el modo local |

Mientras tanto, la documentación presenta el modo alojado como capacidad técnica, no como servicio, y nadie
puede registrarse: los tenants los crea el operador.

## Ingresos posibles

Estas fuentes solo se activan con una decisión del responsable. Hoy no hay ninguna activa.

1. **API alojada** (si P-02 lo permite): cuota mensual por negocio según documentos emitidos. El límite mensual
   por tenant ya existe (`limite_mensual`). Incluye respaldos, actualizaciones y monitoreo.
2. **Instalación y soporte del modo local**: puesta en marcha en el establecimiento (Docker, respaldos, red de
   cajas, TLS) y soporte con tiempo de respuesta acordado.
3. **Integraciones a medida** para sistemas existentes (ERP, POS, tiendas en línea) que usan el SDK o la API.
4. **Patrocinios** de empresas que lo usan.

Ninguno cambia la licencia ni limita el código abierto. Cambiar la licencia requiere la aprobación del
responsable.

## Lo que necesitamos antes de cobrar por el alojamiento

- La respuesta del SAR a P-02 por escrito, archivada en `docs/investigacion.md`.
- Términos de servicio y política de privacidad: quién es responsable de qué ante el SAR, y el plazo de
  conservación (P-06).
- Respaldos fuera del servidor, con restauración probada, y un plan de continuidad.
- Una revisión de seguridad independiente del modo alojado.
- Asesoría legal y contable en Honduras.
