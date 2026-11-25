factura-hn emite facturas, notas de crédito y notas de débito según el Reglamento del Régimen de Facturación del
SAR de Honduras (Acuerdo 481-2017). Es de código abierto (MIT) y cada regla cita su artículo y tiene una prueba.

```bash
npm install factura-hn
```

## Cuatro formas de usarlo

Las mismas reglas fiscales: la API y el MCP llaman por dentro al mismo SDK. Todas empiezan en modo de prueba, con
un CAI ficticio (`DEMO00-NO-VALIDO-…`), y todo lo impreso dice «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».

- [SDK de TypeScript](/guias/sdk/): emite dentro de tu sistema, sobre PostgreSQL, SQLite o tu propia base.
  `npm install factura-hn`.
- [CLI](/guias/cli/): una factura de prueba en la consola y un proyecto inicial. `npx factura-hn demo`.
- [API REST](/guias/api/): para cualquier lenguaje o varias cajas, con Docker y PostgreSQL.
  `docker compose up -d --build --wait`.
- [Servidor MCP](/guias/mcp/): un asistente de IA emite, consulta y anula. `npx -y @factura-hn/mcp init --demo`.

También por [tipo de documento](/documentos/) y por [tipo de negocio](/negocios/).

## Tu primera factura de prueba

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

Ver [Tu primera factura](/empezar/primera-factura/) o el [playground](/empezar/playground/), que corre el SDK en el
navegador. Sin instalar nada, [Pruébalo ahora](/probar/) crea un entorno de prueba con tu llave y tu URL del MCP.

## Lo que resuelve

- **Numeración atómica y sin huecos.** Cada número se reserva en la misma transacción que guarda el documento, y
  nunca se borra ni se reutiliza.
- **Dinero exacto.** Sin punto flotante. El ISV sigue el redondeo del Art. 9 de la Ley del ISV.
- **Documentos inmutables.** Se anulan (Art. 41) o se corrigen con notas de crédito o de débito.
- **Bitácora de auditoría** con quién hizo cada operación (Art. 53 num. 2).

## Confianza

- [Cumplimiento](/cumplimiento/): cada requisito con su artículo, su estado y la prueba que lo verifica.
- [Estado legal](/produccion/estado-legal/): algunos puntos del Reglamento no son literales; factura-hn declara la
  lectura que aplica en cada caso.
- Mientras la versión sea 0.x puede haber cambios incompatibles entre versiones menores: ver los
  [cambios](/ayuda/cambios/).
- Precios: todo es gratis y de código abierto. Ver [precios](/precios/).

**Proyecto independiente, no afiliado al SAR.** factura-hn no es asesoría fiscal ni un sistema autorizado por el
SAR. Quien emite sigue siendo responsable de cumplir el Reglamento; revisa la configuración con tu contador.
