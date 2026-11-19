# Análisis: arquitectura de la documentación de factura-hn

Fecha: 2026-11-19. Alcance: documentación del repositorio y del sitio que genera `scripts/sitio.mjs`.
Referentes estudiados (solo lectura, sin copiar texto): docs.afipsdk.com y docs.stripe.com.

Convenciones de este informe:

- **Público:** D = desarrollador · C = contador o dueño del negocio · A = agente de IA · O = operador o técnico
  que instala el servidor del negocio · M = mantenedor del proyecto.
- **Por confirmar con fuente:** contenido fiscal que el repositorio no respalda con un artículo. No se redacta
  hasta tener la fuente oficial. Cuando existe, se indica la pregunta abierta (P-xx) de `docs/investigacion.md`.
- La autoridad tributaria se nombra como «SAR» solo cuando se habla de ella, no como parte de la marca.

---

## 1. Resumen

- **El contenido es bueno, pero está escrito para quien ya decidió integrar.** Hay 31 documentos propios,
  con citas de artículo y ejemplos que se compilan en las pruebas. Faltan los puntos de entrada de un
  referente: un «Empezar» de 5 minutos, guías por tipo de documento, guías por tipo de negocio, glosario,
  preguntas frecuentes y una página de «Ir a producción».
- **El sitio publica 7 páginas en un menú plano. Varias piezas clave no llegan a él:** `persistencia.md`,
  `normativa.md`, `AGENTS.md`, el README del MCP, los ejemplos, el `CHANGELOG.md` y la sección 3 de
  `investigacion.md` («Pasos ante el SAR»), que es justo la base de «Ir a producción». Los enlaces a esos
  documentos llevan a GitHub.
- **Hay duplicación y algunas contradicciones.** Los dos prompts de una línea aparecen en 6 archivos, y la
  prueba de coherencia vigila solo 4. Las variables de entorno se repiten en 2 páginas. Además:
  - `normativa.md` conserva una sección «v0.1» que contradice el rechazo de los códigos 04, 09, 10 y 12;
  - la skill omite `GRAVADO0`;
  - `docs/api.md` importa `verificarFirmaWebhook` de un paquete que no se publica;
  - la marca usa «SAR» («Facturación SAR Honduras», la skill `facturacion-sar-hn`).
- **Propuesta: 6 secciones y unas 50 páginas.** Las secciones son Empezar, Guías (documentos, negocios y
  tareas), Ir a producción, Referencia, IA y agentes, y Ayuda. Las piezas generadas (SDK, API, errores,
  estado de los documentos, cumplimiento, changelog y llms.txt) se construyen con el generador propio
  (DEC-043) y el compilador de TypeScript que ya está en el repositorio, sin dependencias nuevas.
- **Lo fiscal que falta es mucho y no se debe improvisar:**
  - qué productos son exentos o van al 18 %;
  - el trámite exacto de inscripción y de la Declaración Jurada;
  - los requisitos de los documentos 05, 08 y 11;
  - las reglas propias de restaurantes (propina, cuentas divididas) y de profesionales (honorarios);
  - la entrega del original por correo.

  Todo eso va marcado como «por confirmar con fuente». Las guías por negocio dependen de esas respuestas y
  de la revisión de un contador, así que se redactan al final.

---

## 2. Inventario actual

### 2.1 Documentos

Columnas: público · ¿publicado en el sitio? · ¿va en el paquete npm? · estado.

| Documento | Público | Sitio | npm | Estado y observaciones |
|---|---|---|---|---|
| `README.md` | D, A | No (lo sustituye `sitio-fuente/inicio.md`) | Sí (`factura-hn`) | Al día con 0.2.0. Largo (18 KB): mezcla inicio rápido, referencia de funciones, API REST, MCP, ejemplos, desarrollo y hoja de ruta. La tabla «Desarrollo» marca los seis paquetes como «npm», pero ninguno está publicado. El MCP dice «aún no está en npm». La marca dice «Facturación SAR Honduras» |
| `AGENTS.md` | A | No | Sí (`factura-hn` y `@factura-hn/cliente`) | Muy bueno: principios, mapeo carrito → entrada, emisión, notas, reloj, operador, API. Su tabla de errores cubre unos 25 códigos de los ~70 que existen en `packages/core/src` |
| `llms.txt` | A | No | Sí | Al día. Su lista «Docs» omite `guia-sdk.md`, `autoalojamiento.md`, el README del MCP y la URL del sitio. «Tipos clave» repite a mano lo que podría generarse |
| `skills/facturacion-sar-hn/SKILL.md` | A (Claude) | No | Sí | El paso 6 lista `ISV15 \| ISV18 \| EXENTO` y omite `GRAVADO0`, que `AGENTS.md` sí incluye. El nombre lleva «sar» |
| `CLAUDE.md` | A que desarrolla, M | No | No | Interno, correcto |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | Contribuyentes | No | No | Correctos. `CONTRIBUTING.md` documenta los datos ficticios, un buen insumo para el glosario |
| `CHANGELOG.md` | D | No (solo se enlaza a GitHub) | No | «0.2.0, sin publicar». Bien escrito, orientado al usuario |
| `.changeset/README.md` | M | No | No | Correcto |
| `docs/guia-sdk.md` | D | Sí (`guia-sdk.html`, «SDK») | Sí | Al día. Se solapa con «En 30 segundos» del README. Es la más cercana a un «Empezar», pero exige SQLite (Node 22.13+) desde el paso 2 |
| `docs/api.md` | D, O | Sí (`api.html` + referencia generada) | Sí | Al día. El ejemplo de webhook importa `verificarFirmaWebhook` de `@factura-hn/api`, que no se publica en npm; `AGENTS.md` usa `@factura-hn/cliente`. La tabla de variables de entorno está duplicada en `autoalojamiento.md` |
| `docs/autoalojamiento.md` | O | Sí | Sí | Al día y práctico (respaldos, llaves, actualizar) |
| `docs/persistencia.md` | D | **No** | Sí | Al día. Incluye «Sistemas en red (Art. 48)», contenido de producción que no se ve en el sitio. Afirma «5 años» como hecho; `autoalojamiento.md` lo trata como pregunta abierta (P-06) |
| `docs/normativa.md` | C, D | **No** | Sí | **Desactualizado:** su sección «Fuera de alcance en v0.1» dice que 04, 09, 10 y 12 tienen numeración y que solo les «falta cálculo y render», pero el núcleo los rechaza con `TIPO_NO_EMITIBLE` (Arts. 4 num. 43, 46 y 47). Presenta la lista del 18 % como hecho, mientras que `investigacion.md` dice que no hay texto primario (P-11). Menciona la «declaración SAR-222» sin artículo |
| `docs/investigacion.md` | C, M, auditor | Parcial: `cumplimiento.html` publica solo la sección 1 (matriz) | Sí | Fuente de verdad. Mezcla lo vigente (matriz, pasos ante la autoridad, preguntas abiertas, estado del CAEE) con lo histórico («Versión evaluada 0.1.0», columna «Brecha (0.1)», plan de trabajo de la Fase 1). **La sección 3, la mejor base para «Ir a producción», no se publica** |
| `docs/consulta-sar.md` | Autoridad, C | Sí (`consulta-sar.html`) | Sí | Carta formal con huecos de firma. Útil como transparencia, pero en el menú principal confunde: es un insumo de «Estado normativo», no una guía |
| `docs/decisiones.md` | M, C | No | Sí | Registro de 44 decisiones. `AGENTS.md` lo cita (DEC-018, DEC-019, DEC-031). No apto como página, pero sí como enlace desde las guías |
| `docs/modelo-de-negocio.md` | M, público interesado | No | Sí | Interno o semipúblico. Se distribuye en el paquete npm sin necesidad |
| `docs/avance.md`, `docs/lanzamiento.md` | M | No | No (excluidos en `copiar-docs.mjs`) | Internos, al día |
| `docs/analisis/` (nuevo) | M | No | **Sí, por accidente** | `copiar-docs.mjs` copia todo `docs/` salvo `avance.md` y `lanzamiento.md`, así que estos informes entrarían en el tarball de `factura-hn`. Hay que agregarlos a `INTERNOS` |
| `sitio-fuente/inicio.md` | D, C | Sí (`index.html`) | No | Bien enfocado: tres caminos, prompts y estado. Título «Facturación SAR Honduras». Enlaza el README del MCP, que no es página del sitio |
| `sitio-fuente/playground.md` | D, C | Sí | No | Muy útil. Es la vía más corta para «ver una factura» |
| `packages/api/README.md` | O | No | No (privado) | **Desactualizado:** 2 líneas que nombran primero el modo «alojado» (contra la recomendación) y remiten a `investigacion.md` en vez de `docs/api.md` |
| `packages/cliente/README.md` | D | No | Sí | Al día |
| `packages/mcp/README.md` | A, D | No | Sí | Al día; «aún no publicado» hasta el lanzamiento |
| `packages/pdf/README.md`, `postgres`, `sqlite` | D | No | Sí | Al día. Enlazan `../core` con ruta relativa, que se rompe en npmjs.com. El aviso de papel térmico (Art. 38) se repite en 3 lugares |
| `examples/*/README.md` (express, nextjs, playground, pos-offline) | D | No | No | Al día y valiosos para las guías por negocio (POS fuera de línea, e-commerce). `examples/basico` no tiene README |
| `packages/api/openapi.json` (descripción) | D, A | Sí (referencia generada) | En el contenedor | Al día. La regenera `pnpm --filter @factura-hn/api openapi` |
| `.github/ISSUE_TEMPLATE/*.yml`, `pull_request_template.md` | Contribuyentes | No | No | La plantilla «Regla fiscal» exige artículo y fuente: encaja con «por confirmar con fuente» |

Las copias en `packages/core/` (README, AGENTS, llms.txt, skills, docs) y `packages/cliente/AGENTS.md` se
generan en `prepack` y están en `.gitignore`. Hoy son idénticas a las de la raíz: no hay deriva.

### 2.2 Qué publica hoy el sitio (`scripts/sitio.mjs`)

| Página | Menú | Fuente |
|---|---|---|
| `index.html` | Inicio | `sitio-fuente/inicio.md` |
| `guia-sdk.html` | SDK | `docs/guia-sdk.md` |
| `api.html` | API | `docs/api.md` + referencia generada de `openapi.json` |
| `autoalojamiento.html` | Autoalojamiento | `docs/autoalojamiento.md` |
| `playground.html` | Playground | `sitio-fuente/playground.md` + `examples/playground/public` |
| `cumplimiento.html` | Cumplimiento | `docs/investigacion.md`, solo la sección 1 |
| `consulta-sar.html` | Consulta al SAR | `docs/consulta-sar.md` |

Lo que ya hace bien el generador, y conviene conservar:

- una sola fuente: el Markdown del repositorio;
- reescritura de enlaces y verificación de enlaces y anclas, que falla si algo se rompe;
- referencia de la API desde OpenAPI;
- modo oscuro;
- pie con la fuente de cada página.

Lo que le falta para la arquitectura propuesta:

- menú lateral por grupos y rutas con carpetas;
- búsqueda;
- versión `.md` de cada página y `llms.txt` publicado;
- generación de la referencia del SDK, de los errores y del estado de los documentos;
- una plantilla de guía (requisitos previos → pasos → pruébalo → siguiente).

El flujo de Pages sigue apagado (`PUBLICAR_SITIO`).

### 2.3 Duplicaciones y contradicciones

| Contenido | Dónde se repite | Riesgo | Propuesta |
|---|---|---|---|
| Prompts de una línea (SDK y API) | README, AGENTS, llms.txt, SKILL, `inicio.md`, `guia-sdk.md` (solo SDK) | `readme.test.ts` vigila solo los 4 primeros | Página «Integrar con IA» como fuente para el sitio; extender la prueba a `inicio.md` y `guia-sdk.md` |
| Ejemplo de emisión mínima | README «En 30 segundos», `guia-sdk.md` §4, AGENTS | Bajo: se compilan | Un ejemplo canónico en «Empezar», que el README enlaza |
| Lista de funciones del SDK | README «API», llms.txt «Tipos clave» | Deriva al cambiar firmas | Referencia del SDK generada; el README queda con un resumen y un enlace |
| Tabla de errores | AGENTS (parcial) | Incompleta (~25 de ~70 códigos) | Catálogo de errores en el código y página generada |
| Variables de entorno de la API | `api.md`, `autoalojamiento.md` | Deriva | Una tabla en la referencia de la API, enlazada desde las dos |
| Aviso de papel térmico (Art. 38) | README, `packages/pdf/README.md`, `investigacion.md` | Bajo | Una ficha en «Ir a producción» |
| Conservación de 5 años | `persistencia.md` y README de sqlite (como hecho); `autoalojamiento.md` (como pregunta P-06) | Mensaje inconsistente | Un solo texto con la reserva de P-06 |
| Documentos 04, 09, 10 y 12 | README (no emitibles, con artículo), `normativa.md` («falta cálculo y render») | **Contradicción** | Corregir `normativa.md` |
| Tratamientos ISV | AGENTS (4 valores), SKILL (3 valores) | **Contradicción** | Agregar `GRAVADO0` a la skill |
| Verificación de webhooks | `api.md` (`@factura-hn/api`), AGENTS y ejemplos (`@factura-hn/cliente`) | Un integrador no puede instalar `@factura-hn/api` | Usar `@factura-hn/cliente` en `api.md` |

### 2.4 Marca

Hoy «SAR» forma parte de la marca en estos lugares:

- el título del README («Facturación SAR Honduras para JavaScript/TypeScript»);
- el `<title>` del sitio («factura-hn: facturación SAR Honduras»);
- el H1 de `inicio.md`;
- la descripción de `package.json`;
- los prompts («agrega facturación SAR Honduras»);
- el nombre de la skill (`facturacion-sar-hn`);
- los temas de GitHub (`sar`).

Propuesta: usar «factura-hn» como marca y una descripción que nombre la norma, no la autoridad. Por ejemplo:
«Facturación conforme al Régimen de Facturación de Honduras (Acuerdo 481-2017)». «SAR» se reserva para
hablar de la autoridad («tu resolución del SAR», «consulta al SAR»). Renombrar la skill y cambiar los
prompts rompe la configuración de quien ya los usa, y los prompts están fijados en `readme.test.ts`. Es
una decisión del responsable y conviene hacerla antes de publicar la 0.2.0 en npm.

---

## 3. Lecciones de los referentes

### 3.1 docs.afipsdk.com

Qué tiene:

- una portada que es un selector de integración: tarjetas por lenguaje, por framework, API directa y
  plataformas sin código;
- una sección «Siguientes pasos» con «Ir a producción» y los servicios web;
- una sección «Recursos» con tutoriales del portal de la autoridad paso a paso (certificados, autorizar
  servicios, crear punto de venta), métodos útiles, preguntas frecuentes y errores frecuentes.

Lecciones para factura-hn:

1. **La portada decide el camino en un clic.** factura-hn ya tiene «tres formas de usarlo». Falta
   convertirlas en tarjetas por entorno: Node, Next.js, Express, Bun/Deno/edge, «otro lenguaje → API» y
   «agente de IA → MCP». Sin prometer SDK de Python o .NET mientras sean hoja de ruta.
2. **«Ir a producción» es corto y está separado de los tutoriales del portal.** Los pasos ante la autoridad
   son una sección propia de «recursos». Para Honduras, el paso a paso en la Oficina Virtual no está
   documentado en el repositorio (P-03): esa sección se crea vacía y marcada, no inventada.
3. **Errores frecuentes y preguntas frecuentes son páginas distintas.** Una responde «qué significa este
   código», la otra «puedo hacer X».
4. **Hay que superar sus vacíos.** Afip SDK no separa las páginas por tipo de comprobante (los tipos son
   códigos dentro de los ejemplos), no tiene tablas de parámetros (los documenta en comentarios), ni
   glosario, ni changelog visible. En Honduras los requisitos cambian por código (Arts. 10-11 para la
   factura, 25-28 para las notas), así que una página por código aporta valor y se encuentra mejor en las
   búsquedas.
5. **Pruebas contra producción con un solo interruptor.** Allá, pasar a producción es cambiar un parámetro.
   Aquí no hay ambiente de homologación de la autoridad documentado en el repositorio (`investigacion.md`
   §4: no hay una API pública que conozcamos). La «prueba» es el CAI ficticio (`DEMO00-NO-VALIDO-…`) y el
   tenant `demo`. Hay que decirlo con esa claridad.

### 3.2 docs.stripe.com

Qué tiene:

- un «Start here» con inicios rápidos y entradas por caso de uso (cobrar en línea, facturas, en persona,
  suscripciones);
- una sección «Build with AI» con MCP, skills, plugin y «cómo trabajan los agentes»;
- recursos legibles por máquinas: cualquier página en `.md`, MCP y catálogo de skills;
- documentación por producto, separada de la referencia de la API;
- una lista de verificación para salir a producción, con casillas que recuerda el navegador;
- un changelog por versiones.

Lecciones para factura-hn:

1. **Entradas por caso de negocio, no solo por función.** Es el patrón que se propone para pulpería,
   restaurante, ferretería, e-commerce y profesional independiente. Cada guía enlaza los conceptos y la
   referencia; no los repite.
2. **IA como sección de primer nivel.** factura-hn ya tiene la materia prima (AGENTS.md, skill, llms.txt,
   MCP, prompts probados). Falta una sección que la ordene y la publique, y una versión `.md` de cada página
   para que un agente lea el sitio sin HTML.
3. **La lista de verificación de producción, interactiva y separada por rol:** el dueño o contador (trámites)
   y el desarrollador u operador (llaves, TLS, respaldos, datos de demostración apagados). Cada casilla
   enlaza su artículo o su guía.
4. **Una plantilla de página repetible:** qué vas a lograr, requisitos previos, pasos numerados, pruébalo,
   siguientes pasos.
5. **La referencia de la API y la del SDK, separadas de las guías y generadas.** Las guías no repiten
   firmas: enlazan la referencia.
6. **Sandbox frente a producción explicado al principio.** En factura-hn: CAI ficticio y tenant `demo`
   frente al CAI de la resolución.

---

## 4. Mapa de páginas propuesto

Rutas relativas a la raíz del sitio. Las marcas al final de cada línea indican:

- **[G]** se genera automáticamente;
- **[R]** reutiliza un documento existente;
- **[N]** contenido nuevo;
- **[F]** depende de contenido «por confirmar con fuente».

```text
/                                         Inicio: selector de camino y estado del proyecto      [R inicio.md]
│
├── Empezar
│   ├── /empezar/                         Tu primera factura en 5 minutos                        [N, R README]
│   ├── /empezar/elegir-camino            SDK, API REST o MCP: cuál te conviene                  [R inicio.md, api.md]
│   ├── /empezar/playground               Playground en el navegador                             [R playground.md]
│   └── /empezar/con-ia                   Integrar con un agente en un prompt                    [R README, AGENTS]
│
├── Conceptos
│   ├── /conceptos/como-funciona          CAI, rango, establecimiento, punto de emisión, número  [N, R investigacion §1]
│   ├── /conceptos/isv-y-montos           Tratamientos de ISV, precios con ISV, redondeo Art. 9  [R AGENTS, CHANGELOG]
│   ├── /conceptos/documentos-inmutables  Anular, corregir con notas, reloj y fechas             [R AGENTS, guia-sdk]
│   └── /conceptos/almacen-fiscal         Persistencia y sistemas en red (Art. 48)               [R persistencia.md]
│
├── Documentos
│   ├── /documentos/                      Los 10 códigos y qué puede emitir un sistema           [G]
│   ├── /documentos/01-factura            Factura                                                [N, R AGENTS, investigacion]
│   ├── /documentos/06-nota-de-credito    Nota de Crédito                                        [R AGENTS, guia-sdk]
│   ├── /documentos/07-nota-de-debito     Nota de Débito                                         [N, R investigacion]
│   ├── /documentos/05-comprobante-de-retencion   Pendiente                                      [G, F]
│   ├── /documentos/08-guia-de-remision           Pendiente                                      [G, F]
│   ├── /documentos/11-boleta-de-compra           Pendiente                                      [G, F]
│   └── /documentos/no-emitibles          04, 09, 10 y 12: por qué un sistema no los emite       [G, R README]
│
├── Guías por negocio
│   ├── /negocios/pulperia                                                                       [N, F]
│   ├── /negocios/restaurante                                                                    [N, F]
│   ├── /negocios/ferreteria                                                                     [N, F]
│   ├── /negocios/e-commerce                                                                     [N, R ejemplos express/nextjs, F]
│   └── /negocios/profesional-independiente                                                      [N, F]
│
├── Guías técnicas
│   ├── /guias/imprimir                   Carta, ticket 80 mm, PDF y térmica                     [R README, pdf/README]
│   ├── /guias/varias-cajas               Varias cajas y sucursales                              [R persistencia.md, api.md]
│   ├── /guias/fuera-de-linea             POS sin internet                                       [R pos-offline/README]
│   ├── /guias/reloj                      Reloj adelantado o atrasado                            [R AGENTS]
│   ├── /guias/clientes-especiales        Exonerados, moneda extranjera, exportación             [R AGENTS, README]
│   ├── /guias/reportes                   Libro de ventas, exportación, no utilizados            [R README, api.md]
│   ├── /guias/webhooks                   Recibir y verificar avisos                             [R api.md, ejemplos]
│   ├── /guias/almacen-propio             Escribir un AlmacenFiscal para otra base               [R persistencia.md]
│   └── /guias/autoalojamiento            Servidor del negocio con Docker                        [R autoalojamiento.md]
│
├── Ir a producción
│   ├── /produccion/                      Lista de verificación (por rol)                        [N]
│   ├── /produccion/tramites              Pasos ante la autoridad tributaria                     [R investigacion §3a, F]
│   ├── /produccion/cai-y-rangos          Solicitar, registrar y renovar autorizaciones          [R investigacion, README]
│   ├── /produccion/ficha-art-53          Ficha técnica para la Declaración Jurada (Art. 53)     [N, R matriz]
│   ├── /produccion/operacion-mensual     No utilizados, libro de ventas, respaldos, renovación  [R README, autoalojamiento]
│   ├── /produccion/contingencia          Sin sistema: talonarios (Art. 55) y papel térmico      [R investigacion, F]
│   └── /produccion/portal-autoridad      Paso a paso en la Oficina Virtual                      [F, vacía hasta P-03]
│
├── Referencia
│   ├── /referencia/sdk/                  Referencia del SDK (índice por paquete)                [G]
│   │   ├── factura-hn · @factura-hn/postgres · @factura-hn/sqlite · @factura-hn/pdf
│   │   └── @factura-hn/cliente · factura-hn/pruebas
│   ├── /referencia/api/                  Referencia de la API REST                              [G, R api.md]
│   ├── /referencia/errores               Códigos de error y aviso                               [G]
│   ├── /referencia/cumplimiento          Matriz artículo → función → prueba                     [G, R investigacion §1]
│   ├── /referencia/normativa             Base normativa, estado del CAEE, preguntas abiertas    [R normativa, investigacion §3-4, consulta-sar]
│   ├── /referencia/decisiones            Interpretaciones adoptadas (DEC-xxx)                   [G, R decisiones.md]
│   └── /referencia/glosario              Glosario fiscal                                        [N]
│
├── IA y agentes
│   ├── /ia/                              Panorama: integrar frente a operar                     [N]
│   ├── /ia/prompts                       Prompts de una línea, probados                         [R README]
│   ├── /ia/agents-md                     AGENTS.md publicado                                    [R AGENTS.md]
│   ├── /ia/skill                         Skill para Claude                                      [R SKILL.md]
│   ├── /ia/mcp                           Servidor MCP                                           [R mcp/README, G herramientas]
│   └── /ia/recursos-para-maquinas        llms.txt, llms-full.txt, .md de cada página            [G]
│
└── Ayuda
    ├── /ayuda/preguntas-frecuentes                                                              [N, R README, AGENTS, F]
    ├── /ayuda/errores-frecuentes         Los 10 errores que más aparecen y cómo resolverlos     [N, R AGENTS]
    ├── /ayuda/contribuir                 Contribuir y reportar una regla fiscal                 [R CONTRIBUTING, SECURITY]
    └── /changelog                        Cambios por versión                                    [G, R CHANGELOG.md]
```

En total son 52 páginas: unas 14 generadas o casi generadas, 22 reutilizadas con edición y 16 nuevas.

---

## 5. Fichas de página

Formato de las tablas: propósito · público · contenido mínimo · fuente reutilizable · ¿se genera?

### 5.1 Inicio y Empezar

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Inicio** `/` | Decidir el camino en 10 segundos y confiar en el proyecto | D, C, A | Promesa en una línea, sin «SAR» en la marca. Tarjetas: «JS/TS → SDK», «otro lenguaje o varias cajas → API», «agente de IA → MCP», «solo quiero verlo → Playground». Tres garantías (numeración atómica, dinero exacto, artículo citado). Estado: 0.x, preguntas abiertas, aviso de que no es asesoría fiscal | `sitio-fuente/inicio.md` | No |
| **Tu primera factura en 5 minutos** `/empezar/` | Llevar de cero a una factura de prueba impresa | D | Requisito: Node 18+. Pasos con tiempos: (1) `npm install factura-hn`; (2) un archivo `.mjs` (JavaScript, sin herramientas de TypeScript) con `AlmacenFiscalMemoria`, `registrarAutorizacion` con CAI ficticio, `emitir` y `renderizarHTML` a un archivo; (3) abrirlo en el navegador; (4) provocar un error (RTN de 13 dígitos) y leer `ErrorValidacion.errores`; (5) siguientes pasos: SQLite, CAI real («Ir a producción»), API o MCP. Aviso visible: la factura no tiene validez fiscal sin un CAI de tu resolución | README «En 30 segundos», `guia-sdk.md` §3-4, datos de `CONTRIBUTING.md` | No, pero el script debe correr en `test:ejemplos` para garantizar que funciona |
| **Elegir camino** `/empezar/elegir-camino` | Comparar SDK, API y MCP | D, O | Tabla: lenguaje, número de cajas, fuera de línea, quién guarda los datos, modo local frente a alojado (con la reserva de P-02). Árbol de decisión corto | `inicio.md`, `api.md` (modos), `persistencia.md` | No |
| **Playground** `/empezar/playground` | Probar sin instalar | D, C | El iframe actual y una lista de cosas que probar | `playground.md` | Ya existe |
| **Integrar con IA en un prompt** `/empezar/con-ia` | Que un agente integre la librería | D, A | Los dos prompts (SDK y API), qué hace el agente, qué revisar después (lista corta) | README, AGENTS | Sí: el texto de los prompts puede inyectarse desde una constante que la prueba ya vigila |

### 5.2 Conceptos

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Cómo funciona** | El modelo mental fiscal y técnico | D, C | CAI (Art. 4 num. 7: serie alfanumérica sin formato publicado). Rango y fecha límite (Arts. 10 num. 3-5, 59, 62: vigencia máxima de 1 año). Número `NNN-NNN-NN-NNNNNNNN` e identificador (Art. 10 num. 7). Una autorización por punto de emisión y tipo (Art. 59). Varias autorizaciones continúan la serie. Diagrama: registrar CAI → emitir → imprimir → anular o nota | `investigacion.md` §1, README «API», `persistencia.md` | Parcial: el diagrama puede ser fijo |
| **ISV y montos** | Calcular y cobrar bien | D, C | `ISV15`, `ISV18`, `GRAVADO0` (Art. 12), `EXENTO`, exonerado. Precios con ISV incluido y el centavo del Art. 9 de la Ley del ISV (`ajustePorRedondeo`, `sugerirPrecioSinAjuste`). Cobrar `totales.total`. Montos como texto. Crédito fiscal en ventas mixtas (Art. 11 num. 3). Qué producto lleva qué tasa: **por confirmar con fuente (P-11)**; el negocio lo decide con su contador | AGENTS principio 6, CHANGELOG (B-03, B-17), `investigacion.md` filas ISV 3, 6 y 9 | No |
| **Documentos inmutables** | Corregir sin romper la ley | D, C | No borrar ni reutilizar. Anular (Art. 41). Corregir con 06 o 07. La fecha la pone el reloj (no se retrofecha, Arts. 14 y 43). Reimprimir desde lo guardado (Art. 38) | AGENTS, `guia-sdk.md` §5-6 | No |
| **Almacén fiscal** | Elegir dónde se guardan los documentos | D | Tabla de almacenes, las reglas que cumplen, sistemas en red (Art. 48), «una serie, un almacén» | `persistencia.md` | No (se publica casi tal cual) |

### 5.3 Documentos (por código)

El índice `/documentos/` se genera de `TIPOS_DOCUMENTO` (`numeracion.ts`), de los mensajes de
`TIPO_NO_EMITIBLE` (`documento.ts`) y de `TipoDocumentoSoportado` (`tipos.ts`). Así no se desalinea con el
código.

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Índice de documentos** | Saber qué se puede emitir | D, C, A | Tabla con los 10 códigos: nombre, artículo que lo regula (comentarios de `tipos.ts`: 01 Art. 10; 04 Art. 18; 05 Art. 33; 06 Art. 25; 07 Art. 27; 08 Art. 29; 09 Art. 17; 10 Art. 15; 11 Art. 20; 12 Art. 23) y estado: **soportado** (01, 06, 07), **pendiente** (05, 08, 11, según la hoja de ruta y B-15) o **no emitible por sistema** (04, 09, 10, 12, con su artículo). Nota: tabla vigente tras el Acuerdo 609-2017 | `numeracion.ts`, `documento.ts`, `tipos.ts`, README | **Sí** |
| **01 Factura** | Emitir una factura completa | D, C | Requisitos del emisor (Art. 10 num. 1: los siete datos). Cliente con RTN, consumidor final, más de L 10,000 (Art. 11 párrafo final). Líneas, descuentos (Ley ISV Art. 3). Exonerados (Art. 11 num. 4, DEC-019, DEC-021). Moneda extranjera y tipo de cambio (Art. 11 párrafo). Exportación (Art. 12). Un documento por venta (Art. 9 del Reglamento). Momento de emisión (Art. 14). Ejemplo SDK y API. Errores frecuentes del tipo | AGENTS «Mapeo», README «Avisos», matriz filas 10-12 | Parcial: los ejemplos y la lista de errores salen del catálogo |
| **06 Nota de Crédito** | Devoluciones, descuentos posteriores, anulación de operaciones | D, C | Cuándo se usa (Art. 4 num. 31). Autorización propia. RTN obligatorio y sin consumidor final (Art. 26 num. 1-2). Referencia: CAI, número y fecha (Art. 26 num. 3), coherente con el original (DEC-004, DEC-017). Motivo. Solo en lempiras (Art. 26 num. 9, DEC-018). Firma de quien recibe (Art. 26 num. 7). Signo en el libro de ventas | AGENTS «Notas de crédito», `guia-sdk.md` §6, matriz filas 25-28 | Parcial |
| **07 Nota de Débito** | Ajustes que aumentan el monto | D, C | Art. 4 num. 32; puede referir «el Comprobante Fiscal o el documento» (Art. 28 num. 3 b, DEC-016). Mismos datos que la NC salvo la firma. Casos de uso concretos: **por confirmar con fuente** (el repositorio solo dice «ajustes») | matriz, DEC-016 | Parcial |
| **05, 08, 11 (pendientes)** | Decir con honestidad que aún no se emiten | D, C | Nombre, artículo, «pendiente en la hoja de ruta». Requisitos de contenido: **por confirmar con fuente** (el repositorio solo cita dónde están, Arts. 33, 29 y 20, sin resumirlos). Qué hacer mientras tanto: por confirmar con un contador | `tipos.ts`, README «Hoja de ruta», B-15 | **Sí** (página corta desde una tabla) |
| **No emitibles (04, 09, 10, 12)** | Evitar que alguien intente emitirlos | D, C, A | Una sección por código con su ancla, la cita y la modalidad correcta: 09 solo máquina registradora (Arts. 4 num. 43 y 52); 04 y 10 solo imprenta (Art. 46); 12 excluida del autoimpresor (Art. 47). El error `TIPO_NO_EMITIBLE` | README «Lo que esta librería no va a emitir» | **Sí** (desde los mensajes de `documento.ts`) |

### 5.4 Guías por caso de negocio

Plantilla común:

- perfil del negocio;
- documentos que usa;
- configuración recomendada (almacén, cajas, impresión);
- ejemplo de venta típica (código);
- situaciones frecuentes;
- «qué confirmar con tu contador»;
- enlaces.

Cada afirmación fiscal lleva su artículo. Lo demás va en un recuadro «Por confirmar con fuente».

| Página | Propósito | Público | Contenido mínimo con respaldo en el repo | Por confirmar con fuente | Fuente | ¿Generable? |
|---|---|---|---|---|---|---|
| **Pulpería** | Una caja, ventas pequeñas, consumidor final | C, D | Precios de góndola con ISV incluido y el centavo del Art. 9 de la Ley del ISV. Consumidor final; identificación arriba de L 10,000 (Art. 11). Un documento por venta, aunque sea pequeña: la exención de L 50 no aplica a sistemas (Art. 9 del Reglamento, C L.559-566). Factura a consumidor final, no ticket (Art. 4 num. 43). Ticket térmico y certificación del papel (Art. 38). POS fuera de línea con SQLite y su propio punto de emisión. Contingencia con talonarios (Art. 55) | Qué productos de una pulpería son exentos (el repositorio no tiene ninguna lista; el ejemplo de los frijoles exentos es ilustrativo). Qué va al 18 % (P-11). Si un negocio de este tamaño está obligado a un sistema o puede usar talonarios de imprenta | README, `pos-offline/README`, AGENTS | No |
| **Restaurante** | Servicio en mesa, varias cajas, bebidas | C, D | Momento de emisión en servicios: al pago o al crédito (Art. 14). Un documento por venta (Art. 9). Varias cajas: un punto de emisión por caja o API central (Art. 48). Impresión térmica (Art. 38). El ticket (09) no se emite por sistema | Propina o cargo por servicio: si forma parte de la base del ISV y cómo se imprime. Cuentas divididas entre comensales. Bebidas alcohólicas al 18 % (P-11; `normativa.md` lo afirma sin texto primario). Consumo en el local frente a llevar | `persistencia.md` (Art. 48), AGENTS (Art. 14), `investigacion.md` §5 (flujo de caja del POS de referencia) | No |
| **Ferretería** | Clientes con RTN, crédito, exonerados, devoluciones | C, D | Cliente con RTN y crédito fiscal (Art. 11 num. 1 a-c). Venta mixta y `baseCreditoFiscal` (Art. 11 num. 3). Exonerados con OCE y constancia o registro SAG/RUPNSA (Art. 11 num. 4); OCE parcial → dos facturas (DEC-019). `condicionPago: 'CREDITO'` y emisión al otorgar el crédito (Art. 14). Devoluciones con NC 06. Precios en dólares con tipo de cambio | Si debe emitir Guía de Remisión (08) al despachar mercadería y cuándo (Art. 29 citado, sin contenido). Usos concretos de la ND 07. Retenciones de grandes contribuyentes | AGENTS, README «Avisos», matriz | No |
| **E-commerce** | Ventas en línea pagadas antes de entregar | D | Fecha de emisión = fecha del pago; el documento se entrega con el bien (Art. 14). Emisión en el servidor con `Idempotency-Key` por pedido. Webhooks firmados. PDF servido por pedido o enlace firmado, no por número. Identificación arriba de L 10,000 | Si el PDF por correo cuenta como entrega del original (AGENTS lo sugiere como ejemplo, sin artículo). Ventas a compradores en el extranjero: si son exportación (Art. 12) o no. Moneda de cobro frente a la moneda del documento | `examples/express`, `examples/nextjs`, AGENTS «Con la API REST», `api.md` | Parcial: puede incrustar código de los ejemplos, que ya se prueban |
| **Profesional independiente** | Servicios profesionales | C | El Recibo por Honorarios (04) solo se emite por imprenta (Art. 46): factura-hn no lo emite. Momento de emisión en servicios (Art. 14) | **Casi todo:** si un profesional puede facturar con Factura 01 como autoimpresor en lugar del 04. ISV sobre honorarios. Retenciones (05 y otras). Esta guía no debe publicarse sin esas respuestas | README, `documento.ts` | No |

### 5.5 Guías técnicas

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| Imprimir | Carta, ticket, PDF y térmica | D | `renderizarHTML`, `renderizarTexto` (32/42/48 columnas), `renderizarPDF`. Reimpresión idéntica (Art. 38). Leyenda ANULADA (Art. 41). Latin-1 en el PDF. Papel térmico (Art. 38) | README, `pdf/README` | No |
| Varias cajas y sucursales | Configurar la red | D, O | Los tres modelos del Art. 48 y cómo se configuran. Llaves de caja por punto de emisión | `persistencia.md`, `api.md` | No |
| Fuera de línea | POS sin internet | D | SQLite, idempotencia con `alEmitir`, cola de salida, un punto por caja | `pos-offline/README` | No |
| Reloj | Resolver `RELOJ_ADELANTADO_SOSPECHOSO` y `FECHA_ANTERIOR_AL_ULTIMO` | D, O | Los dos casos, los botones recomendados, `corregirFechaAdelantada` (Arts. 41 y 43) | AGENTS «Reloj del dispositivo» | No |
| Clientes especiales | Exonerados, moneda extranjera, exportación | D, C | Art. 11 num. 4, DEC-019, DEC-021; tipo de cambio (Art. 11 párrafo); nota sobre una factura en dólares (DEC-018); `GRAVADO0` (Art. 12, con la reserva de P-09) | AGENTS, README | No |
| Reportes | Cierre del mes | D, C | `libroVentasCSV`, `resumenVentas`, `exportarTexto` (Art. 53 num. 5, formato propio a la espera de P-14), `documentosNoUtilizados` (Art. 42) | README, `api.md` | No |
| Webhooks | Recibir avisos | D | Eventos, reintentos, firma, cuerpo crudo, duplicados | `api.md`, ejemplos | No |
| Almacén propio | Otra base de datos | D | Interfaces, bloqueo por base, batería de contrato | `persistencia.md` | Parcial: las interfaces pueden salir de los tipos |
| Autoalojamiento | Servidor del negocio | O | Sin cambios de fondo; las variables de entorno se enlazan a la referencia | `autoalojamiento.md` | No |

### 5.6 Ir a producción

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Lista de verificación** `/produccion/` | Que nada se olvide antes de la primera factura real | C, D, O | Casillas en dos columnas, guardadas en el navegador. **Negocio:** inscripción y autoimpresor (Arts. 45 y 47), Declaración Jurada (Art. 53), CAI por punto y tipo (Arts. 59 y 61), papel térmico (Art. 38), talonarios de contingencia (Art. 55), revisión con el contador. **Técnica:** almacén persistente (no `AlmacenFiscalMemoria`), `FHN_DEMO=0`, contraseña y TLS de Postgres, llaves de caja por punto, respaldos probados, datos del emisor completos, webhooks verificados, alertas de vencimiento visibles | `investigacion.md` §3a, `autoalojamiento.md`, `api.md` «Producción» | No |
| **Pasos ante la autoridad tributaria** | El orden de los trámites, con sus artículos | C | Los 13 pasos de `investigacion.md` §3a, cada uno con su artículo: datos del RTN al día (Arts. 45 num. 1-2, 63); contrato de adhesión (Art. 45 num. 3); Régimen de Facturación (Art. 45 num. 4-5); autoimpresor por sistema (Art. 47); Declaración Jurada (Art. 53); autorización de impresión (Arts. 59 y 61); renovación (Arts. 59 y 62); rechazo (Art. 64); no utilizados (Art. 42); uso temporal (Art. 40); contingencia (Art. 55); papel térmico (Art. 38); custodia (Arts. 41 y 43). Recuadro: formularios, medio y plazos **por confirmar con fuente (P-03)** | `investigacion.md` §3a | No |
| **CAI y rangos** | Del papel de la resolución al sistema | C, D | Qué datos trae la resolución y dónde se cargan (`registrarAutorizacion` o `POST /v1/autorizaciones`). Una autorización por punto y tipo (Art. 59). Vigencia máxima de 1 año (Art. 62). Ventana de renovación de 2 meses (Art. 59) y alertas. Rango agotado o vencido. Rangos que continúan la serie | README, `investigacion.md` filas 59-62, `api.md` | No |
| **Ficha técnica Art. 53** | Que el negocio pueda firmar la Declaración Jurada con fundamento | C | Por numeral del Art. 53: (1) integración contable (`libroContable`, `alEmitir`); (2) seguridad y auditoría (bitácora, disparadores, roles, RLS); (3) persistencia; (4) código 2D/3D opcional (no implementado); (5) archivos de texto (`exportarTexto`). La versión del software. La propuesta ya figura en `investigacion.md` §3b | Matriz, fila 53 | Parcial: la versión y las filas pueden salir de la matriz |
| **Operación mensual** | Lo que se repite cada mes | C, O | Comunicar los no utilizados dentro de 10 días hábiles del mes siguiente (Art. 42). Libro de ventas. Respaldos. Revisar las alertas de renovación. Conservación: 5 años con la reserva de P-06 | README, `autoalojamiento.md`, `investigacion.md` §3b | No |
| **Contingencia** | Qué hacer si el sistema no está disponible | C | Talonarios preimpresos de imprenta certificada; vender sin documento se sanciona (Art. 55). No justifica retrofechar | Matriz, fila 55 | No |
| **Portal de la autoridad** | Paso a paso en la Oficina Virtual | C | Vacía y marcada hasta que haya fuente: **por confirmar con fuente (P-03)**. Idealmente, aportada por contadores con capturas | Ninguna | No |

### 5.7 Referencia

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **SDK** `/referencia/sdk/…` | Firma y descripción de cada exportación | D, A | Por paquete: funciones, clases, tipos e interfaces con su TSDoc (`tipos.ts` ya tiene 57 bloques), parámetros, retorno, errores que lanza y artículo citado. Enlaces cruzados entre tipos | `packages/*/src/index.ts` | **Sí**, con la API del compilador de TypeScript, que ya se usa en `readme.test.ts` (sin dependencias nuevas, en línea con DEC-043). Una prueba debería exigir TSDoc en cada exportación pública |
| **API REST** `/referencia/api/` | Endpoints, esquemas y errores | D, A | Lo que ya genera `referenciaApi()`, más la tabla única de variables de entorno, roles y códigos HTTP | `openapi.json`, `api.md` | **Sí** (ya existe) |
| **Errores y avisos** | Qué significa cada código y qué hacer | D, A, C | Los ~70 códigos de `packages/core/src` y los de la API (`IDEMPOTENCIA_CONFLICTO`, `OPERADOR_CONFLICTO`…): tipo (error o aviso), mensaje, campo, artículo y acción recomendada | Hoy, la tabla parcial de AGENTS | **Sí, si se crea un catálogo** (`ERRORES` exportado con código, artículo y acción). Hoy los códigos están dispersos como literales: requiere un cambio de código |
| **Cumplimiento** | Trazabilidad artículo → función → prueba | C, auditor | Matriz vigente, sin las columnas históricas («Brecha (0.1)», invoicehn) | `investigacion.md` §1 | **Sí** (ya existe; filtrar columnas) |
| **Normativa** | Base legal, estado del CAEE, preguntas abiertas | C | Acuerdo 481-2017 y reformas; Ley del ISV; Código Tributario (compilación de 2024, con su reserva); estado del CAEE (§4); tabla P-01 a P-14 con su estado; enlace a la carta de consulta | `normativa.md` (corregido), `investigacion.md` §3-4, `consulta-sar.md` | Parcial |
| **Decisiones** | Interpretaciones aplicadas | C, M | Lista de DEC-xxx con su estado (APROBADA o REVISAR); las guías enlazan aquí | `decisiones.md` | **Sí** (índice desde los encabezados) |
| **Glosario** | Vocabulario fiscal y del SDK | C, D, A | Cada término con su definición breve, su artículo y el nombre en el SDK. Lista en la sección 5.10 | Matriz, AGENTS, `consulta-sar.md` | No (parcial: el nombre en el SDK puede enlazarse solo) |

### 5.8 IA y agentes

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Panorama** `/ia/` | Elegir entre integrar (AGENTS, skill) y operar (MCP) | D, A | Tabla: qué recurso usar según la tarea. Reglas para agentes: no inventar reglas, mostrar los errores tal cual, no aprobar `anular_documento` automáticamente | AGENTS, `mcp/README` | No |
| **Prompts** | Copiar y pegar | D | Los dos prompts, la versión detallada y qué revisar después | README | Sí (desde la constante probada) |
| **AGENTS.md** | Publicarlo como página | A, D | El archivo tal cual | `AGENTS.md` | Sí |
| **Skill** | Instalar la skill de Claude | D | Dónde está (`node_modules/factura-hn/skills/…`), cómo instalarla y qué hace | `SKILL.md` | Parcial |
| **MCP** | Configurar el servidor MCP | D, A | Herramientas, seguridad, configuración vía API y vía SDK local, `FHN_OPERADOR` | `mcp/README` | Parcial: la tabla de herramientas puede salir de `packages/mcp/src/servidor.ts` |
| **Recursos para máquinas** | Que un agente lea el sitio | A | `llms.txt` publicado en la raíz del sitio; `llms-full.txt` (concatenación de las guías); `.md` de cada página; enlace a `openapi.json` | `llms.txt` | **Sí** (el generador puede copiar el Markdown fuente junto a cada `.html`) |

### 5.9 Ayuda y changelog

| Página | Propósito | Público | Contenido mínimo | Fuente | ¿Generable? |
|---|---|---|---|---|---|
| **Preguntas frecuentes** | Respuestas cortas que enlazan la guía | C, D | Preguntas con respaldo en el repositorio: ¿necesito inscribirme? (Arts. 45 y 47); ¿es factura electrónica? (§4, CAEE); ¿puedo usarlo en la nube? (P-02, modo local recomendado); ¿por qué el total bajó un centavo? (Art. 9 de la Ley del ISV); ¿puedo cambiar la fecha? (no, Arts. 14 y 43); ¿puedo emitir tickets o recibos por honorarios? (no, Arts. 4 num. 43 y 46); ¿qué pasa si se va la luz? (Art. 55 y POS fuera de línea); ¿cuánto cuesta? (gratis, `modelo-de-negocio.md`); ¿cuánto tiempo guardo los documentos? (con la reserva de P-06); OCE parcial; nota sobre una factura en dólares | README, AGENTS, `modelo-de-negocio.md`, `investigacion.md` | No |
| **Errores frecuentes** | Los casos que más bloquean | D, C | `SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`, `CONSUMIDOR_FINAL_IDENTIFICACION`, `EMISOR_*`, `FECHA_*`, `TIPO_NO_EMITIBLE`, `IDEMPOTENCIA_CONFLICTO`: síntoma, causa y solución | AGENTS «Referencia rápida de errores» | Parcial (desde el catálogo) |
| **Contribuir** | Sumar contadores y desarrolladores | Contribuyentes | Cómo reportar una regla con su fuente (plantilla «Regla fiscal»), datos ficticios, seguridad | `CONTRIBUTING.md`, `SECURITY.md` | No |
| **Changelog** | Qué cambió y cómo migrar | D | `CHANGELOG.md` tal cual; más adelante, una guía de migración por versión menor mientras sea 0.x | `CHANGELOG.md` | **Sí** |

### 5.10 Glosario: términos con respaldo en el repositorio

Los artículos citados son los que ya aparecen en `investigacion.md`, `AGENTS.md` o el código.

| Término | Artículo o fuente en el repo | Nombre en el SDK |
|---|---|---|
| Acuerdo 481-2017 (y reformas 609-2017, 725-2018, 817-2018) | `investigacion.md` «Fuentes» | — |
| Autoimpresor (por sistema computarizado) | Art. 47 | — |
| CAI | Art. 4 num. 7 | `AutorizacionCAI.cai` |
| CAEE | Art. 4 num. 9; Art. 54 | (no implementado) |
| Comprobante Fiscal | Art. 6; `COMPROBANTES_FISCALES` | — |
| Consumidor final | Art. 11 num. 2 a | `CONSUMIDOR_FINAL` |
| Contingencia | Art. 55 | — |
| Contrato de adhesión | Art. 45 num. 3 | — |
| Crédito fiscal (base de) | Art. 11 num. 3 | `baseCreditoFiscal` |
| Declaración Jurada (del sistema) | Art. 53 | — |
| Documentos no utilizados | Art. 42 | `documentosNoUtilizados` |
| Establecimiento, punto de emisión, identificador | Art. 10 num. 7 | `establecimiento`, `puntoEmision` |
| Exento / exonerado / gravado 0 % | Art. 11 num. 1 g; Art. 12 | `EXENTO`, `exoneracion`, `GRAVADO0` |
| Facturación electrónica | Art. 4 num. 22 | — |
| Fecha límite de emisión | Art. 10 num. 3-5; Art. 62 | `fechaLimiteEmision` |
| ISV (15 % y 18 %) | Ley del ISV Art. 6 (18 % con la reserva de P-11) | `ISV15`, `ISV18` |
| Nota de Crédito / Nota de Débito | Art. 4 num. 31-32; Arts. 25-28 | `'06'`, `'07'` |
| Orden de Compra Exenta, Constancia del Registro de Exonerados, registro SAG/RUPNSA | Art. 11 num. 4 | `Exoneracion` |
| Rango autorizado | Arts. 10 y 59 | `rangoInicial`, `rangoFinal` |
| Redondeo del Art. 9 (Ley del ISV) | Ley del ISV Art. 9 | `ajustePorRedondeo` |
| Régimen de Facturación | Art. 45 | — |
| Registro Fiscal de Imprentas | Arts. 66-70 | — |
| Sistema independiente / sistema en red | Art. 4 num. 41-42; Art. 48 | — |
| Ticket (y por qué no se emite) | Art. 4 num. 43; Art. 17 | `TIPO_NO_EMITIBLE` |
| Anulación (leyenda ANULADA) | Art. 41 | `anular` |
| RTN (14 dígitos) / DNI (13 dígitos) | DEC-024 (decisión aprobada, no un artículo) | `esRTNValido`, `esDNIValido` |
| Idempotencia, llave de caja o admin, tenant | Términos técnicos (`api.md`) | — |

---

## 6. Contenido que falta y requiere fuente

Ninguno de estos puntos debe redactarse sin la fuente indicada. En el sitio, cada uno aparece como un
recuadro «Por confirmar con fuente» con su identificador, para que los lectores (sobre todo contadores)
puedan aportarla con la plantilla «Regla fiscal».

| # | Tema | Páginas afectadas | Qué tiene hoy el repo | Qué falta | Pregunta o fuente a pedir |
|---|---|---|---|---|---|
| F-01 | Lista de bienes y servicios gravados al 18 % | ISV y montos, Pulpería, Restaurante | `normativa.md` lo afirma; `investigacion.md` dice que no hay texto primario | Texto vigente del Decreto 278-2013 Art. 16 y la lista oficial | P-11 |
| F-02 | Qué bienes son exentos (canasta básica u otros) | Pulpería, Ferretería, ISV y montos | Nada: el SDK deja la clasificación al negocio | Artículos de la Ley del ISV y listas vigentes | Nueva pregunta (no está en P-01 a P-14) |
| F-03 | Procedimiento de inscripción como autoimpresor y Declaración Jurada del Art. 53: formulario, medio y plazos | Pasos ante la autoridad, Portal de la autoridad | Solo los artículos | Procedimiento actual en la Oficina Virtual | P-03 |
| F-04 | Registro o certificación de proveedores de software | Ficha Art. 53, Preguntas frecuentes | No se encontró en el Reglamento (no prueba que no exista) | Respuesta de la autoridad | P-01 |
| F-05 | Servidor en la nube de un tercero (API alojada) | Elegir camino, Autoalojamiento, Preguntas frecuentes | Modo local recomendado | Respuesta escrita | P-02 |
| F-06 | Formato del archivo de texto (Art. 53 num. 5) y de la comunicación de no utilizados (Art. 42) | Reportes, Operación mensual | Formatos propios (jsonl, csv, txt) | Formato oficial, si existe | P-04, P-14 |
| F-07 | Plazo de conservación vigente | Operación mensual, Almacén fiscal, Preguntas frecuentes | 5 años según la compilación de 2024 del Código Tributario | Confirmación en La Gaceta | P-06 |
| F-08 | Papel térmico: trámite de la certificación y «resúmenes de ventas» | Imprimir, Lista de verificación, Pulpería, Restaurante | El Art. 38 citado | Quién lo gestiona y en qué formato | P-07 |
| F-09 | Exportaciones: «gravado 0 %» o «exento» | Clientes especiales, E-commerce | Lectura del Reglamento (Art. 12) | Respuesta de la autoridad | P-09 |
| F-10 | ISV por línea o por grupo de tasa | ISV y montos | Por grupo de tasa (lectura adoptada) | Confirmación | P-10 |
| F-11 | Exonerado agroindustrial solo con el registro SAG/RUPNSA | Clientes especiales, Ferretería | Lectura DEC-021 | Confirmación | P-08 |
| F-12 | Fecha mínima de la primera emisión de una serie | CAI y rangos | Sin piso; la fecha siempre es hoy | Respuesta | P-13 |
| F-13 | Calendario y especificación técnica del CAEE | Normativa, Preguntas frecuentes | Sin publicación oficial encontrada | Publicación de Finanzas y de la autoridad (Arts. 57-58) | P-12 |
| F-14 | Datos personales del adquirente guardados por terceros | Autoalojamiento, Preguntas frecuentes | Nada | Normativa de protección de datos aplicable | P-05 |
| F-15 | Requisitos de contenido del Comprobante de Retención (05), la Guía de Remisión (08) y la Boleta de Compra (11), y cuándo son obligatorios | Páginas 05, 08 y 11, Ferretería | Solo dónde están (Arts. 33, 29 y 20) | Resumen artículo por artículo del texto consolidado, con la línea citada, como en la matriz | Texto consolidado (ya está en las fuentes de `investigacion.md`; falta el análisis) |
| F-16 | Profesional independiente: si puede usar Factura 01 como autoimpresor; ISV y retenciones sobre honorarios | Profesional independiente | Solo que el 04 es de imprenta (Art. 46) | Respuesta de la autoridad o de un contador, con artículo | Nueva pregunta |
| F-17 | Restaurante: propina o cargo por servicio en la base del ISV; cuentas divididas entre comensales | Restaurante | Nada | Artículo aplicable | Nueva pregunta |
| F-18 | Entrega del original en ventas a distancia (PDF por correo) | E-commerce, 01 Factura | AGENTS lo sugiere como ejemplo bajo el Art. 14 | Si la entrega electrónica cumple la obligación de entregar el original (Arts. 5 y 14) | Nueva pregunta |
| F-19 | Usos concretos de la Nota de Débito (intereses, fletes, diferencias de precio) | 07 Nota de Débito, Ferretería | Art. 4 num. 32: «ajustes» | Casos admitidos | Contador |
| F-20 | Obligación según el tamaño o el tipo de negocio (sistema, imprenta o máquina registradora) | Pulpería, Elegir camino | Las modalidades se mencionan (Arts. 46, 47 y 52) | Qué modalidad corresponde a cada negocio | Contador o autoridad |
| F-21 | Declaración mensual (formulario, nombre y campos) | Reportes, Operación mensual | `normativa.md` menciona un formulario sin artículo | Fuente del formulario y su relación con el libro de ventas | Nueva pregunta |
| F-22 | Sanciones concretas (montos, tipos de falta) | Preguntas frecuentes, Contingencia | Solo «vender sin documento se sanciona» (Art. 55) | Artículos del Código Tributario | Código Tributario (texto oficial) |

---

## 7. Orden de redacción recomendado

El criterio es el impacto en «de cero a la primera factura» primero, el riesgo fiscal bajo antes que el
alto, y no escribir lo que depende de una fuente pendiente.

**Fase A. Correcciones rápidas (antes de publicar la 0.2.0)**

1. `scripts/copiar-docs.mjs`: excluir `docs/analisis/` (y, a criterio del responsable,
   `modelo-de-negocio.md`) del paquete npm.
2. `normativa.md`: quitar la sección «v0.1» y marcar el 18 % con P-11.
3. `SKILL.md`: agregar `GRAVADO0`.
4. `docs/api.md`: usar `verificarFirmaWebhook` de `@factura-hn/cliente`.
5. `packages/api/README.md`: redirigir a `docs/api.md` y nombrar primero el modo local.
6. README de `pdf`, `postgres` y `sqlite`: enlace absoluto en lugar de `../core`.
7. README: corregir la columna «npm» de la tabla «Desarrollo».
8. Decisión de marca (sección 2.4): si se cambia, hacerlo ahora, junto con la prueba de los prompts.

**Fase B. Infraestructura del sitio (habilita todo lo demás)**

9. `scripts/sitio.mjs`:
   - grupos y menú lateral, rutas con carpetas;
   - plantilla de guía;
   - un `.md` junto a cada `.html`;
   - `llms.txt` publicado;
   - el componente «Por confirmar con fuente»;
   - la lista de verificación con casillas.
10. Páginas generadas que no requieren código nuevo: Changelog, Cumplimiento (con columnas filtradas),
    Decisiones e índice de Documentos.

**Fase C. El camino de los 5 minutos**

11. **Empezar** (con su script en `test:ejemplos`), Elegir camino e Integrar con IA.
12. Conceptos: Cómo funciona, e ISV y montos (con F-01 y F-02 marcados).
13. Documentos 01, 06 y 07, la página de no emitibles y las de pendientes.

**Fase D. Producción**

14. Pasos ante la autoridad, CAI y rangos, Lista de verificación, Operación mensual, Contingencia y Ficha
    técnica Art. 53. Todo sale de `investigacion.md` §3 y la matriz. La página del Portal de la autoridad
    se crea vacía y marcada (F-03).

**Fase E. Referencia generada**

15. Catálogo de errores en el código (cambio pequeño en `packages/core`), la página de Errores y Errores
    frecuentes.
16. Generador de la referencia del SDK con el compilador de TypeScript y una prueba que exija TSDoc en las
    exportaciones.
17. Tabla única de variables de entorno en la referencia de la API.

**Fase F. IA y ayuda**

18. Sección IA (panorama, MCP con las herramientas generadas, recursos para máquinas).
19. Glosario.
20. Preguntas frecuentes, solo con las respuestas que tienen artículo; las demás, con su marca.

**Fase G. Guías técnicas restantes**

21. Imprimir, Varias cajas, Fuera de línea, Reloj, Clientes especiales, Reportes, Webhooks y Almacén
    propio. Son casi todas reubicaciones de contenido existente.

**Fase H. Guías por negocio (al final, con revisión de un contador)**

22. E-commerce primero (la que más se apoya en los ejemplos probados), después Pulpería y Ferretería, luego
    Restaurante. **Profesional independiente no se publica** hasta resolver F-16.
23. Antes de publicar cada guía, enviar las preguntas nuevas (F-02, F-16, F-17, F-18, F-20, F-21) junto con
    la consulta formal existente (`docs/consulta-sar.md`) y registrar las respuestas en `investigacion.md`.

Para medir la meta de los 5 minutos: una persona que no conoce el proyecto, con Node instalado, cronometrada
desde la portada hasta ver el HTML de la factura de prueba. El script de «Empezar» corre en la CI, así que
el camino no se rompe con un cambio de firma.
