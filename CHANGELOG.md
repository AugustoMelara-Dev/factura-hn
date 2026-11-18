# Changelog

## 0.1.0 — 2026-11-18

- Primera versión: Factura (01), Nota de Crédito (06), Nota de Débito (07), con la tabla de códigos vigente tras el Acuerdo 609-2017.
- Las notas exigen RTN del adquirente y moneda nacional; la Nota de Crédito imprime los campos de quien la recibe.
- La leyenda "La factura es beneficio de todos, exíjala" es opcional (el reglamento no la exige).
- Numeración de 16 dígitos, control de CAI/rango/fecha límite y estado de la autorización.
- Cálculo de ISV 15%, 18%, exento y exonerado, con precios con o sin ISV.
- Montos en letras, validación con códigos de error, render HTML (carta/ticket) y texto térmico.
- Libro de ventas CSV y resumen por tasa.
- Documentación para agentes de IA: AGENTS.md, llms.txt y skill de Claude.
