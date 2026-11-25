factura-hn es de código abierto, con licencia MIT. No hay planes de pago, cuentas ni límites de uso en el código:
lo instalas, lo usas y lo cambias sin pedir permiso a nadie.

| | Qué es | Precio |
|---|---|---|
| **SDK** (`factura-hn`) | La librería de TypeScript que emite dentro de tu sistema | Gratis, MIT |
| **CLI** (`npx factura-hn`) | La factura de prueba en la consola y el proyecto inicial | Gratis, MIT |
| **API REST** | La API para autoalojar con Docker y PostgreSQL, en tu servidor | Gratis, MIT |
| **Servidor MCP** (`@factura-hn/mcp`) | Para que un asistente de IA emita, consulte y anule | Gratis, MIT |
| **Demostración pública** | Un entorno de prueba de 24 horas con tu llave y tu URL del MCP, solo con datos de prueba | Gratis |

## Qué pagas tú

Lo que cuesta operar tu propia instalación: el servidor o el equipo donde corre, la base PostgreSQL si usas la
API, y el trámite de tu CAI ante el SAR. factura-hn no cobra por documento ni por caja.

## La demostración pública

Sirve para probar, no para facturar: cada entorno tiene un emisor y un CAI ficticios, todo lo que emite dice
«DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y a las 24 horas se borra con todos sus datos. Tiene límites de uso
para que alcance para todos. Para facturar de verdad, instala factura-hn con los datos de tu negocio.

## Soporte

El soporte es el de un proyecto de código abierto: issues y discusiones en GitHub, sin un compromiso de tiempo
de respuesta. factura-hn no es asesoría fiscal; revisa tu configuración con tu contador.
