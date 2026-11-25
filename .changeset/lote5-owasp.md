---
"@factura-hn/cliente": patch
---

Revisión OWASP API Security Top 10 (2023) de la API REST.

- Los tipos del cliente declaran el 403 `CAJA_SIN_PUNTO` de `GET /v1/libro-ventas` (una llave de caja sin punto de
  emisión), que la API ya devolvía.
- `GET /v1/documentos` corta cada página en unos 8 MiB de documentos: puede traer menos de `limite` con
  `hayMas: true`. `fhn.documentos` ya sigue el cursor mientras `hayMas`; si recorres las páginas a mano, haz lo mismo.
- En modo alojado, una URL de webhook con nombre interno y punto final (`https://localhost./`) se rechaza al
  registrarla (antes se frenaba recién al conectar).
