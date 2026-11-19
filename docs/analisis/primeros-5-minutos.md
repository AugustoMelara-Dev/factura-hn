# Primeros 5 minutos: cuatro agentes sin contexto

Fecha: 19-11-2026. Versión probada: 0.2.0 (tarballs de `pnpm pack`, equivalentes a lo que daría npm; aún no
está publicado).

## Método

Cuatro agentes independientes, sin contexto previo, recibieron una tarea de una línea y solo el README del
repositorio. Podían seguir los enlaces del README y la documentación, pero no leer el código fuente.

Condiciones de todos:
- instalación sin red, desde la caché de pnpm;
- nada global;
- Docker solo con el `docker-compose.yml` de factura-hn, sin construir ni descargar imágenes.

Cada uno llevó una bitácora con pasos, errores con su mensaje exacto, dudas y tiempos. Los tropiezos que solo
se deben al entorno de prueba (sin red, pnpm 12, simular npm con tarballs) se separan de los de factura-hn.

| Escenario | Tarea | ¿Emitió? | Tiempo | Pasos (total / mínimos) | Errores de factura-hn |
|---|---|---|---|---|---|
| Node | «Emite una factura de prueba con factura-hn en este proyecto» | Sí, con PDF carta y ticket | ~3 min | 14 / 5 | 0 |
| Next.js | «… en mi app de Next.js» | Sí (route handler + HTML) | ~5 min (1,5 de instalación offline) | 11 / 6 | 0 |
| API REST | «Emite una factura de prueba usando la API REST» | Sí, con PDF, pero la primera con datos corruptos | ~3 min | 14 / 7 | 3 |
| MCP | «Conecta el servidor MCP a mi asistente y emite una factura de prueba» | Sí, en modo SQLite | ~3 min | 12 / 9 | 2 bloqueos |

Meta del plan: un agente sin contexto emite su primera factura en ≤ 3 pasos y sin errores. **Ningún escenario
la cumple todavía**; el SDK directo (Node) es el más cerca.

## Hallazgos, ordenados por gravedad

### Graves

1. **La API guarda en silencio texto corrupto** (API).
   - El `curl -d '…Café…'` de `docs/api.md`, copiado en Git Bash de Windows, envió la «é» en otra codificación.
   - La API respondió 201 y guardó U+FFFD en un documento inmutable. El PDF dice «Caf?».
   - La API debe rechazar con 400 un cuerpo que no sea UTF-8 válido, y la documentación debe mandar el cuerpo
     desde un archivo (`--data-binary @factura.json`).
2. **La API se cae cuando Postgres se reinicia** (API).
   - El contenedor ya estaba en `Exited (255)` al llegar el agente: `Unhandled 'error' event`,
     `terminating connection due to administrator command`.
   - El pool de `pg` no tiene manejador de `error`, y el compose no tiene `restart:`.
   - La traza (~280 líneas) entierra las llaves de demostración en el log.
3. **El MCP no puede registrar un CAI** (MCP).
   - Para emitir en modo SQLite, el agente tuvo que instalar `factura-hn` y `@factura-hn/sqlite` y escribir un
     script con `registrarAutorizacion`.
   - El error `[SIN_AUTORIZACION] … (Arts. 59-61)` dice qué falta, pero no cómo resolverlo desde el MCP.

### Importantes

4. **No hay modo de prueba explícito** (Node, MCP, API).
   - En el SDK, «prueba» es memoria más el CAI ficticio del ejemplo, pero ningún texto lo dice.
   - El PDF de la demo sale como una factura real, sin leyenda de documento de prueba. En la API, el tenant demo
     usa un CAI `DEMO00-NO-VALIDO-…`; es el único indicio.
5. **El README no explica el uso dentro de un servidor** (Next.js).
   - Si alguien copia «En 30 segundos» dentro de un route handler, registraría el CAI en cada petición.
   - Falta decir que el almacén se crea una vez y el CAI se registra una vez.
6. **La llave de demostración de la API solo está en el log** (API).
   - Hay que buscar `fhn_` en el log y saber, por `docs/api.md`, que la llave útil es la de caja del tenant demo.
   - No está documentado cómo recuperarla si el log se pierde.
7. **Faltan enlaces en la respuesta de emisión** (API).
   - La respuesta no trae enlaces `pdf`, `html` ni `txt`.
   - El ejemplo descarga `00000001` fijo, aunque el número emitido puede ser otro.
8. **Los mensajes de validación de la API salen en inglés** (API): son los de Zod («Invalid input: expected string,
   received undefined») y no dicen qué hacer. El SDK, en cambio, responde en español y con código
   (`CLIENTE_RTN`), y lo hace bien.
9. **El servidor MCP no orienta al arrancar** (MCP).
   - No valida `emisor.json` (tampoco hay ejemplo de ese archivo).
   - No menciona `FHN_ESTABLECIMIENTO` ni `FHN_PUNTO` ni sus valores por defecto.
   - No avisa si no hay CAI.

### Menores

10. **`renderizarPDF` está mal ubicado en el README** (Node): aparece bajo «Almacenes», y el README raíz no dice
    que es asíncrona ni qué devuelve.
11. **No se dice cómo ejecutar el ejemplo** (Node): hace falta `"type": "module"` y Node ≥ 22.6 para `.ts`, o tsx.
12. **El README raíz muestra primero el modo del MCP que exige Docker** (MCP): el modo SQLite, el más fácil, solo
    aparece en el README del paquete.
13. **Versiones de Node que no coinciden** (MCP): `engines` de `@factura-hn/mcp` pide Node ≥ 22.13, mientras su
    README dice que el modo API funciona con Node 20.
14. **Enlaces que se rompen en npm** (MCP): `[factura-hn](../core)` en los README de sqlite, postgres y pdf no
    funciona fuera del repositorio.
15. **Reintentos idempotentes sin distinguir** (MCP): un reintento con la misma `idempotencyKey` devuelve el mismo
    número, que es lo correcto, pero el texto dice «Emitida» igual que una emisión nueva.
16. **Aviso de pnpm sin explicar** (Node, Next.js): `Agent skills awaiting approval: factura-hn (tarball)`. Ningún
    documento dice qué es ni si hay que aprobarlo.
17. **El ejemplo no deja nada visible** (Node): termina en `console.log`. Guardar `factura.html` o `factura.pdf`
    haría evidente el resultado.

## Lo que funcionó

- **SDK:** el ejemplo «En 30 segundos» del README corre sin cambios y produce exactamente lo prometido:
  `000-001-01-00000001`, L 371.00 y el monto en letras.
- **Errores del SDK:** en español, con código y artículo, y un intento fallido no consume correlativo (Next.js:
  la emisión posterior a un 422 fue la siguiente en orden).
- **Next.js:** no necesitó configuración especial.
- **Idempotencia:** funciona en la API y en el MCP.
- **Avisos:** la venta mixta se marcó con `AVISO_VENTA_MIXTA`.

## Rutas propuestas de 3 pasos

| Escenario | Paso 1 | Paso 2 | Paso 3 |
|---|---|---|---|
| Node | `npm install factura-hn` | pegar `factura.ts`, que termina guardando `factura.pdf` | `node factura.ts` |
| Next.js | `npm install factura-hn` | copiar `lib/factura.ts`, con almacén y CAI una sola vez | copiar `app/api/factura/route.ts` y llamar con `curl` |
| API | `docker compose up -d` | `docker compose logs api \| grep "caja demo"` o un comando que imprima la llave | `curl --data-binary @factura.json`; la respuesta trae el enlace al PDF |
| MCP | `npx -y @factura-hn/mcp init --demo`: crea la base, el emisor de plantilla y el CAI ficticio, e imprime el bloque `mcpServers` | pegar el bloque en el asistente | «emite una factura de prueba» |

## Bitácoras

Las bitácoras completas y los proyectos de prueba quedaron fuera del repositorio, en el directorio temporal de
la sesión. Los datos que contienen son ficticios.

Las dos facturas de prueba de la API (`00000003` y `00000004`) quedaron en la base local de desarrollo, en el
tenant demo con CAI ficticio.
