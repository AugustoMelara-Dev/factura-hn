# Plan v1: de «no sé nada» a «emití mi primera factura» en 5 minutos

Fecha: 19-11-2026. Estado: **propuesta para aprobación**; no se ha construido nada.

Se basa en ocho informes de `docs/analisis/`:
- `competencia.md`;
- `primeros-5-minutos.md`;
- `sdk.md`;
- `api-rest.md`;
- `ecosistema.md`;
- `documentacion.md`;
- `sitio-web.md`;
- `confianza.md`.

Los hallazgos citados con dato concreto se comprobaron contra el código.

## 1. Diagnóstico

**Dónde estamos.** El núcleo es sólido:
- un agente sin contexto emitió una factura con el SDK en unos 3 minutos y sin errores, copiando el ejemplo
  del README;
- 207 pruebas en el núcleo; cada regla cita su artículo;
- correlativos atómicos e idempotencia que resiste reintentos simultáneos;
- webhooks firmados que salen en la misma transacción;
- errores fiscales en español, con código y artículo.

La ventaja diferencial es real. En Honduras la emisión no pasa por un servicio web de la autoridad
(investigacion.md §4; Arts. 54 y 58). Por eso se puede ofrecer una factura de prueba **sin cuenta, sin llave
y sin red**, algo que ningún referente argentino puede dar.

**Qué falta para ser la referencia.** No faltan funciones: falta que el camino sea corto, seguro y creíble.

1. **El lanzamiento bloquea los 5 minutos.** No está en npm, el sitio no está publicado y el badge de npm apunta a
   un paquete que no existe.
2. **Solo el SDK cumple la meta.** Con la API, el MCP y Next.js hubo tropiezos en los cuatro casos: 7, 9 y 6 pasos
   mínimos.
   - El MCP no puede registrar un CAI.
   - La API guardó en silencio una factura con texto corrupto y se cae si Postgres se reinicia.
3. **Hay fallos que no pueden salir publicados:**
   - **Montos:** `'89,50'` se lee como L 8,950.00 sin aviso (`packages/core/src/dinero.ts:40`; comprobado).
   - **Ejemplos que caducan:** el CAI de los ejemplos vence el 30-06-2027 (28 apariciones), y la CI no lo nota
     porque congela el reloj.
   - **Notas internas en el paquete:** `copiar-docs.mjs` metería en el paquete npm cualquier archivo nuevo de
     `docs/`, incluidos estos informes.
4. **No hay modo de prueba.** Los impresos de la demo salen como facturas reales, sin ninguna leyenda. Los líderes
   (YoFacturo, Stripe, Afip SDK) tienen llaves o entornos de prueba explícitos.
5. **La confianza se presenta peor de lo que es.** Hay afirmaciones que dicen más de lo que hay:
   - el badge de procedencia, cuando la 0.2.0 sale sin ella;
   - la consulta al SAR, que el sitio muestra como enviada sin haberlo sido;
   - «revisiones independientes» que no dicen quién revisó.

   Además:
   - **decisiones sin estado:** cinco con efecto fiscal no llevan etiqueta (DEC-008, 010, 011, 012 y 025);
   - **consulta incompleta:** `consulta-sar.md` trae 6 de las 14 preguntas.

   Por otro lado:
   - falta un aviso legal único;
   - falta una política de versiones para cambios normativos;
   - el contador no tiene una página propia.
6. **La marca choca con la regla.** El titular dice «Facturación SAR Honduras», igual que la descripción de los
   paquetes, la skill `facturacion-sar-hn` y los prompts.
7. **La documentación existe, pero no llega.** El sitio publica 7 de 31 documentos en un menú plano. «Ir a
   producción» está escondido en `investigacion.md` §3. `normativa.md` contradice al código en los tipos 04, 09,
   10 y 12.

## 2. Hoja de ruta

Ordenada por impacto entre esfuerzo. Cada etapa termina con un criterio medible. Esfuerzos: S < 1 día,
M = 1–3 días, L > 3 días.

### Etapa 0. Antes de publicar la 0.2.0 (2–3 días)

Lo que sería caro o vergonzoso corregir después de publicar.

| # | Cambio | Fuente | Esfuerzo |
|---|---|---|---|
| 0.1 | `parsearDecimal`: comas solo como separador de miles en grupos de 3; `'89,50'` da `ErrorMonto` | sdk I1 | S |
| 0.2 | API: rechazar con 400 los cuerpos que no son UTF-8 válido; manejar `error` del pool de `pg`; `restart: unless-stopped` en el compose | p5, api | S |
| 0.3 | Excluir de los paquetes todo lo interno (`docs/analisis/`, `plan-*.md`, `decisiones.md`…) con una lista de **inclusión**, y que `verificar-dist` falle si se cuela algo | documentacion | S |
| 0.4 | Fechas límite de CAI calculadas en los ejemplos y una prueba que corra el ejemplo del README con el reloj real | sdk C12 | S |
| 0.5 | Marca sin «SAR» en titular, descripciones, `keywords` y nombre de la skill (si lo apruebas, §5) | competencia, sitio | S |
| 0.6 | Honestidad: badge de procedencia «desde 0.2.1», estado real de la consulta, «revisión interna» en lugar de «independiente», etiqueta de estado en las DEC con efecto fiscal | confianza | S |
| 0.7 | Incompatibles de la API que conviene hacer antes de que haya usuarios: paginación por defecto y envolturas uniformes (§3) | api | M |

**Terminado cuando:**
- hay pruebas nuevas en verde para la coma, el UTF-8 y la caída de Postgres;
- `pnpm pack` de los seis paquetes no contiene nada de la lista interna (lo comprueba `verificar-dist`);
- el ejemplo del README pasa en la CI con la fecha real;
- `git grep -i "SAR"` solo encuentra el nombre de la autoridad, nunca la marca (si se aprueba 0.5);
- `pnpm run ci` está en verde.

**Entonces se publica la 0.2.0** con el comando ya preparado.

### Etapa 1. Los 5 minutos de verdad (1 semana)

| # | Cambio | Fuente | Esfuerzo |
|---|---|---|---|
| 1.1 | Submódulo `factura-hn/demo`: `crearFacturadorDemo()`, `EMISOR_DEMO`, `CAI_DEMO` con fecha calculada. El playground, la API y el MCP lo reutilizan en lugar de sus copias | sdk C2 | M |
| 1.2 | **Modo de prueba visible:** leyenda en todo impreso hecho con el CAI de prueba (texto por decidir, §5) y `modo: "prueba"` en el documento | competencia, api | M |
| 1.3 | Errores que dicen qué hacer: `Problema.solucion`, mensajes de `SIN_AUTORIZACION`, `RANGO`, `AUTORIZACION_VENCIDA` y falta de `almacen` | sdk C5–C6 | S |
| 1.4 | MCP: `npx @factura-hn/mcp init --demo` (base, emisor de plantilla, CAI ficticio, bloque `mcpServers` listo para pegar) y `registrar-cai`; validar `emisor.json` al arrancar; señalar reintentos | p5 | M |
| 1.5 | API: 400 en español (`z.locales.es()`); enlaces `pdf`/`html`/`txt` en la respuesta de emisión; la llave demo impresa de forma visible y recuperable; `GET /v1/sesion`, que dice qué falta para emitir | p5, api | M |
| 1.6 | README nuevo: tres caminos de 3 pasos (SDK, API, MCP), sección de Next.js (almacén y CAI una sola vez), cómo ejecutar el ejemplo, PDF al final; corregir `@factura-hn/pdf` en «Almacenes», `engines` y enlaces `../core` | p5, documentacion | M |
| 1.7 | Fachada `crearFacturador` (compatible, sobre `emitir`/`anular`), con su DEC | sdk C1 | M |

**Terminado cuando** se repite la prueba de `primeros-5-minutos.md` con cuatro agentes nuevos sin contexto y:
- cada camino (Node, Next.js, API y MCP) emite su primera factura en **≤ 3 pasos después de instalar**;
- hay **0 errores** y **≤ 5 minutos**;
- el impreso dice que es de prueba.

Los tres pasos de cada camino corren en la CI como prueba de humo.

### Etapa 2. Sitio y confianza (1–2 semanas)

| # | Cambio | Esfuerzo |
|---|---|---|
| 2.1 | Sitio nuevo con Astro Starlight (§4), primera entrega de unas 20 páginas: Empezar, Conceptos, Ir a producción (lista por rol y ficha del Art. 53), Referencia generada (SDK, API, errores) e IA | L |
| 2.2 | Matriz de cumplimiento **generada desde las pruebas** (requisito → artículo → prueba → estado), en CI | M |
| 2.3 | Aviso legal único (README, sitio, AGENTS.md, API y MCP), política de versiones ante cambios normativos, estado público de la consulta y de las DEC [REVISAR]; borradores en `confianza.md` §5, **sujetos a revisión legal** | S |
| 2.4 | Catálogo de errores con una URL por código (`error.documentacion`, como el `doc_url` de Stripe) | M |
| 2.5 | Activar Pages y la publicación con OIDC (pasos 5 y 6 de `lanzamiento.md`) | S |

**Terminado cuando:**
- el sitio está publicado y la verificación de enlaces y anclas corre sobre el HTML final;
- el buscador encuentra en español «CAI», «nota de crédito» y «rango»;
- cada página tiene su versión `.md` y existe `llms-full.txt`;
- la matriz se regenera en CI y falla si una regla pierde su prueba;
- ninguna afirmación pública queda sin respaldo: una lista de comprobación revisada por ti.

### Etapa 3. API para integradores (1–2 semanas)

| # | Cambio | Esfuerzo |
|---|---|---|
| 3.1 | `operationId` en las 23 operaciones, `Solicitud-Id`, `FacturaHN-Version` y cabeceras `RateLimit` | S |
| 3.2 | Webhooks: reintentos de unos 3 días (hoy ~64 min, aunque la doc dice 6 h), listar y reenviar entregas, verificador que acepte varias firmas `v1` **antes** de permitir la rotación | M |
| 3.3 | Sandbox local: llaves `fhn_test_`/`fhn_live_` (las actuales siguen valiendo), CAI ficticio obligatorio en prueba y prohibido en producción | M |
| 3.4 | Colecciones de Bruno y Postman generadas del OpenAPI, probadas contra el Docker en CI | S |
| 3.5 | Imagen Docker publicada en GHCR (con tu permiso) | S |

**Terminado cuando:**
- el OpenAPI pasa un linter con 0 errores y el 100 % de las operaciones tiene `operationId`;
- un cliente Python generado con openapi-python-client emite una factura de prueba en CI;
- la colección de Bruno corre en verde contra la imagen.

### Etapa 4. Ecosistema (después; en parte depende de P-02)

Orden de `ecosistema.md`:
1. Plantilla de Next.js y receta de Excel.
2. Clientes de .NET (POS de escritorio, el mejor encaje con el Art. 47), PHP/Laravel y Python.
3. n8n autoalojado y Odoo con un partner local.
4. **Solo después de la respuesta a P-02:** WooCommerce en hosting, Shopify, Make/Zapier y la API alojada.
5. Guías por negocio (pulpería, restaurante, ferretería, e-commerce, profesional), con revisión de un
   contador. Dependen de 22 puntos fiscales «por confirmar con fuente» (F-01 a F-22 en `documentacion.md` §6),
   que no se redactan inventados.

### En paralelo: tareas del responsable

- Completar `consulta-sar.md` con las 14 preguntas. Añadir a P-02 una subpregunta: ¿cuenta como «instalado en
  el establecimiento» el sistema propio de un negocio alojado en la nube de un tercero? Luego enviarla.
- Conseguir la revisión de un contador o abogado y publicarla con su alcance, sin llamarla certificación.

## 3. Cambios incompatibles propuestos

Nada está publicado y la política vigente permite cambios incompatibles en 0.x (D-02). Hacerlos ahora no le
cuesta nada a nadie; después, cada uno exige nota de migración.

| # | Cambio | Paquete | Recomendación | Motivo |
|---|---|---|---|---|
| I1 | `'89,50'` da `ErrorMonto` (las comas solo como miles, en grupos de 3) | core | **Sí, Etapa 0** | Hoy multiplica el monto por 100 en silencio. Ninguna entrada correcta deja de funcionar |
| I2 | `Problema.campo` apunta al campo exacto (`lineas[0].precioUnitario`) | core, api | Sí, Etapa 1 | Cumple la promesa de «errores con campo» del README. OpenAPI y API cambian a la vez |
| I3 | Tipos `Readonly` en profundidad para los documentos emitidos | core | Sí, Etapa 1 | Ese código ya falla en ejecución porque el objeto está congelado (Art. 41); así falla al compilar |
| I4 | Quitar `OpcionesEmision.opciones` anidado | core | **En 1.0.0** | Antes basta con aceptar las dos formas |
| I5 | `ErrorValidacion.message` con el contexto real (hoy dice «Documento inválido» al anular) | core | Sí | El contrato son los códigos, no el texto |
| A1 | Paginación por defecto en `GET /v1/documentos` y en la bitácora | api, cliente | **Sí, Etapa 0** | Hoy puede devolver 366 días en una sola respuesta (AIP-158) |
| A2 | Envolturas uniformes en todas las respuestas | api, cliente | **Sí, Etapa 0** | Después solo se podría en `/v2` |
| A3 | Montos de salida como texto | api | **No** | Rompería el JSON guardado y su contraste con el SDK. Se añade, de forma compatible, un objeto en centavos enteros (sdk C8) |
| A4 | Dejar de aceptar el formato viejo de llaves | api | **No**; solo en `/v2` | Las llaves nuevas conviven con las viejas |
| M1 | Renombrar la skill `facturacion-sar-hn` | skill | Si apruebas la marca | Debe hacerse antes de publicar, o queda fijado en npm |

## 4. Plan del sitio

**Stack: Astro Starlight**, en un paquete privado del workspace, desplegado en GitHub Pages con el mismo
`pages.yml`. Los motivos (`sitio-web.md` §3–4):
- es el único de los tres con la interfaz en español y un buscador estático, Pagefind, que entiende el español;
- trae modo oscuro, plantilla de landing y MDX.

Los otros dos:
- **VitePress:** obliga a traducir a mano la interfaz y el buscador, y su versión 2 sigue en alfa.
- **Fumadocs:** en Pages pierde lo que lo distingue y arrastra Next, React y Tailwind.

Exige una DEC nueva que reemplace a DEC-043, e instalar dependencias de desarrollo (te pediré permiso).

**Se conserva del generador actual:**
- los mismos Markdown como fuente;
- la reescritura de enlaces a GitHub;
- el playground;
- la verificación de enlaces y anclas, ahora sobre el HTML final.

**La referencia de la API** se genera con el código propio (`referenciaApi()`), que ya está en español y queda
indexado. Scalar sería un explorador opcional de solo lectura.

**Mapa** (52 páginas en 7 bloques, de `documentacion.md` §4; la primera entrega publica unas 20):

```text
/                      Inicio: elegir camino (SDK, API, MCP), código en el hero, estado del proyecto
/empezar/              Tu primera factura en 5 minutos · elegir camino · playground · con IA
/conceptos/            Cómo funciona (CAI, rango, punto de emisión) · ISV y montos · inmutables · almacén
/documentos/           Los 10 códigos · 01 · 06 · 07 · no emitibles (04, 09, 10, 12) · pendientes [F]
/guias/                Imprimir · varias cajas · fuera de línea · reloj · reportes · webhooks · autoalojar
/negocios/             Pulpería · restaurante · ferretería · e-commerce · profesional   [Etapa 4, F]
/produccion/           Lista por rol · trámites [F] · CAI y rangos · ficha Art. 53 · operación mensual
/referencia/           SDK [G] · API [G] · errores [G] · cumplimiento [G] · normativa · decisiones · glosario
/ia/                   Prompts probados · AGENTS.md · skill · MCP · llms.txt, llms-full.txt y .md por página
/ayuda/                Preguntas frecuentes · errores frecuentes · contribuir · changelog [G]
```

([G] se genera; [F] depende de contenido por confirmar con fuente.)

**Dirección visual** (`sitio-web.md` §5): una referencia técnica seria y tranquila, ni marketing ni portal de
gobierno.
- **Tipografía:** IBM Plex Sans (texto) y IBM Plex Mono (código y cifras), alojadas en el propio sitio, sin
  Google Fonts.
- **Paleta clara:** fondo `#FAFAF9`, texto `#1A1A18`, acento `#0B5D8F` (el azul actual; 6,75:1).
- **Paleta oscura:** fondo `#111110`, texto `#ECEBE7`, acento `#7CC0EC`, con texto oscuro en el botón (el blanco
  da 1,98:1).
- **Contraste:** todos los textos pasan AA, calculados.
- **Referencias:**
  - la referencia de la API de Stripe, por el orden: autenticación, errores, idempotencia y versiones antes de
    las rutas;
  - biomejs.dev, por la landing con instalación y código en el hero;
  - afipsdk.com, por las llamadas «Comenzar» y «Documentación», la barra de cambios normativos y el aviso de no
    afiliación.
- **Landing:** propuesta de titular «Facturación para Honduras, sin inventar reglas». El subtítulo nombra el
  Acuerdo 481-2017. Botones «Empezar» y «Probar en el navegador», y `npm install factura-hn` con botón de
  copiar.

## 5. Decisiones que necesito de ti

1. **Marca.** ¿Quito «SAR» del titular, de las descripciones, de las `keywords` y del nombre de la skill (por
   ejemplo `facturacion-hn`) antes de publicar? «SAR» seguiría apareciendo como nombre de la autoridad.
2. **Publicación.** ¿Espero a terminar la Etapa 0 para publicar la 0.2.0? Lo recomiendo: 0.1, 0.3 y 0.5 no
   deben quedar fijados en npm.
3. **Texto de la leyenda de prueba.** Por ejemplo «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». No viene de ningún
   artículo: es una marca de producto, y la registraría como DEC.
4. **API:** ¿paginación por defecto y envolturas uniformes ahora (A1, A2), y montos como número más un objeto en
   centavos (A3)?
5. **Sitio:** ¿Starlight, con la instalación de sus dependencias de desarrollo cuando lleguemos a la Etapa 2?
6. **Orden.** ¿Apruebas Etapa 0 → publicar → Etapa 1 → Etapa 2 → Etapa 3?
