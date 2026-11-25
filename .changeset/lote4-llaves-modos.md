---
'@factura-hn/cliente': minor
---

Tenants de prueba y de producción en la API, con llaves `fhn_test_` y `fhn_live_`.

- API: cada tenant tiene un modo, `prueba` o `produccion`. Las llaves nuevas llevan su marca (`fhn_test_…` o
  `fhn_live_…`); las `fhn_<prefijo>_…` de antes siguen valiendo en su tenant. Una llave `fhn_test_` no entra a un
  tenant de producción, ni una `fhn_live_` a uno de prueba (401). Al migrar, los tenants que ya existían quedan en
  producción y el `demo` de demostración, en prueba.
- API: `GET /v1/sesion` trae `modoTenant` y cada respuesta autenticada lleva la cabecera `FacturaHN-Modo`.
  `@factura-hn/cliente` tipa `modoTenant`.
- API: un tenant de prueba solo registra CAI ficticios (`AUTORIZACION_REAL_EN_DEMO`) y uno de producción no
  acepta ninguno, ni con `"prueba": true` (`CAI_DE_PRUEBA`; ya no se devuelve `AUTORIZACION_DEMO_SIN_PRUEBA`).
- API: `GET /v1/libro-ventas` con una llave de caja devuelve solo el libro de su punto de emisión.
- Consola: `tenant crear --modo produccion|prueba`; `llave crear` y `demo llave` crean la llave con la marca del
  modo de su tenant.
