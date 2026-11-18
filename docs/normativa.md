# Qué cubre la librería y de dónde sale cada regla

> **Aviso.** `factura-hn` te ayuda a generar documentos con los requisitos del reglamento, pero no
> sustituye la autorización del SAR ni la asesoría de un contador. Para emitir desde un sistema necesitas
> inscribirte en el Régimen de Facturación, registrarte como autoimpresor y obtener tu CAI y rango.
> La normativa cambia: revisa los acuerdos vigentes en sar.gob.hn antes de salir a producción.

## Base normativa

- **Acuerdo 481-2017**, Reglamento del Régimen de Facturación, Otros Documentos Fiscales y Registro Fiscal
  de Imprentas (La Gaceta, 10 ago 2017), con sus reformas (Acuerdos 609-2017 y 725-2018, entre otros).
- **Ley del Impuesto Sobre Ventas**: tasa general 15%; 18% para bebidas alcohólicas, cigarrillos y boletos
  aéreos en clase ejecutiva/primera.
- Situación de la factura electrónica (nov. 2026): el régimen vigente es el de **CAI + rango autorizado**.
  La modalidad electrónica es la de *autoimpresor* (sistema computarizado) dentro de ese régimen; no hay un
  esquema XML obligatorio con validación previa del SAR. Si el SAR publica uno, se agregará como módulo.

## Mapa de requisitos → librería

| Requisito (Acuerdo 481-2017) | Dónde |
|---|---|
| Número de 16 dígitos `NNN-NNN-NN-NNNNNNNN` (establecimiento, punto de emisión, tipo, correlativo) | `formatearNumero`, `parsearNumero` |
| Códigos de tipo de documento vigentes (01, 04–12; reforma del Acuerdo 609-2017: 06 Nota de Crédito, 07 Nota de Débito) | `TIPOS_DOCUMENTO` |
| CAI, rango autorizado y fecha límite de emisión impresos | `DocumentoFiscal.cai/rangoAutorizado/fechaLimiteEmision`, render |
| No emitir después de la fecha límite ni fuera del rango | `emitir` (`AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`, `CORRELATIVO_FUERA_DE_RANGO`) |
| Autorización por punto de emisión y tipo de documento, vigencia máx. 1 año | `AutorizacionCAI`, `estadoAutorizacion` |
| Datos del emisor: RTN, razón social, nombre comercial, direcciones, teléfono, correo | `Emisor`, render |
| Destino de ejemplares (original cliente / copia emisor) | `DESTINO_EJEMPLARES` |
| Datos del adquirente exonerado: orden de compra exenta, constancia de registro, registro SAG | `Exoneracion` |
| RTN del cliente cuando la compra es para crédito fiscal, costo o gasto | `Cliente.rtn` |
| "CONSUMIDOR FINAL" cuando no se identifica al cliente | `CONSUMIDOR_FINAL` |
| Identificación obligatoria en ventas a consumidor final mayores de L 10,000 | `CONSUMIDOR_FINAL_IDENTIFICACION` (umbral configurable) |
| Descripción, cantidad, valor unitario | `LineaEntrada` |
| Descuentos y rebajas otorgados | `Totales.descuentos` |
| Importes exonerado, exento y gravado por tasa; ISV discriminado por tasa | `calcularDocumento` |
| Importe total en número y letras, moneda | `Totales.totalEnLetras`, `montoEnLetras` |
| Tipo de cambio si la moneda es extranjera | `tipoCambio` (`TIPO_CAMBIO`) |
| Notas de crédito/débito: CAI, número y fecha del documento que modifican, y motivo | `ReferenciaDocumento`, `motivo` |
| Notas: nombre y RTN del adquirente; moneda nacional (Arts. 26 y 28) | `NOTA_CLIENTE_RTN`, `NOTA_MONEDA` |
| Nota de Crédito: nombre, identidad y firma de quien la recibe (Art. 26 num. 7) | render (campos en blanco) |

## Fuera de alcance en v0.1

- Recibo por honorarios (04), comprobante de retención (05), guía de remisión (08), ticket (09),
  factura prevalorada (10), boleta de compra (11) y constancia de donación (12).
  La numeración sí los soporta; falta su cálculo y render.
- Exportaciones a tasa cero (Art. 12).
- Envío de archivos al SAR y declaración SAR-222 (hay `libroVentasCSV` y `resumenVentas` como apoyo).
- Validación del dígito verificador del RTN y consulta en línea de RTN/CAI.

## Puntos para confirmar con tu contador

- Si tu giro tiene productos al 18% o exentos, que la clasificación de cada producto esté bien.
- Si aplicas ISV línea por línea o por grupo de tasa: la librería lo calcula **por grupo de tasa**,
  así el total siempre cuadra con la suma de importes más ISV.
- La leyenda "La factura es beneficio de todos, exíjala" **no** la exige el reglamento; es opcional (`leyenda`).

## Referencias y créditos

- [invoicehn](https://github.com/JorgePadilla/invoicehn) (Ruby, MIT, Jorge Padilla): la referencia más completa
  que existe. De su investigación salen la tabla de códigos vigente (Acuerdo 609-2017) y los textos
  consolidados en `doc/fuentes/` (Gacetas 34,413 · 34,457 · 34,792 · 34,811).
- [skillsarhn](https://github.com/Javitonito-Javier/skillsarhn) (MIT, Ing. Javier Omar Oliva Meza): skills de
  facturación y contabilidad tributaria. Su tabla de códigos usa la numeración original de 2017.
- Texto consolidado del Reglamento: el Art. 53 permite sistemas "desarrollados o adquiridos" por el obligado
  tributario, con integración contable o de inventario, controles de auditoría, persistencia y exportación a texto.
