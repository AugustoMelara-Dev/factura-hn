# Análisis: propuesta del sitio web de factura-hn

Fecha: 19-11-2026. Alcance: landing, funciones, stack, dirección visual, mapa del sitio y migración desde
`scripts/sitio.mjs`. Solo lectura: no se instaló nada ni se tocó otro archivo. Las afirmaciones sobre
herramientas salen de su documentación oficial, de su repositorio o del registro de npm, consultados en esa
fecha (ver [Fuentes](#8-fuentes)). Si algo no se pudo confirmar, el informe lo dice.

## 1. Resumen

- **Stack recomendado: Astro Starlight**, en un paquete privado del workspace (`sitio/`). Trae en español la
  interfaz, el buscador (Pagefind, con lematización en español), el modo oscuro, los bloques de código y la
  landing con hero. Genera HTML estático para GitHub Pages con muy poco JavaScript. Sus dependencias son
  solo de desarrollo y no tocan los paquetes publicados. Esta decisión reemplazaría a DEC-043.
- **La referencia de la API sigue saliendo del generador propio.** Se porta `referenciaApi()` para que
  escriba páginas de Starlight: quedan en español, las indexa el buscador y usan el mismo diseño.
  `starlight-openapi` se descarta porque sus textos están fijos en inglés (verificado en su código).
  Scalar, que sí trae español, queda como explorador interactivo opcional, sin «probar petición».
- **Una sola fuente, como hoy.** Un script convierte los Markdown del repositorio en contenido del sitio al
  construir. Conserva la reescritura de enlaces, el recorte de `investigacion.md`, el playground y la
  verificación de enlaces y anclas sobre el HTML final.
- **La landing explica el valor en 10 segundos.** Lleva titular, comando de instalación y un ejemplo
  probado del README con su salida. Las llamadas son «Empezar» y «Probar en el navegador». La prueba de
  confianza es verificable (matriz de cumplimiento, MIT, consulta al SAR publicada, CI), sin logos ni cifras
  inventadas.
- **Visual sobrio de referencia técnica:** IBM Plex Sans y Plex Mono, papel cálido y el azul actual
  (`#0B5D8F` y `#7CC0EC`). Todos los pares de texto pasan AA, calculados. Sin bandera, escudo ni «SAR» en
  la marca. Hoy el `<title>` y la meta descripción del sitio sí dicen «SAR»: hay que corregirlo.

## 2. Landing

### 2.1 Estructura (de arriba abajo)

| # | Bloque | Propósito |
|---|---|---|
| 0 | Barra superior: marca `factura-hn` · Guías · Referencia · Cumplimiento · Playground · buscador · tema · GitHub | Navegación fija, igual en todo el sitio |
| 1 | **Hero**: titular, subtítulo, dos botones, comando de instalación con copiar | El valor en 10 segundos |
| 2 | **Ejemplo de código** con pestañas *SDK · API REST · Agente de IA* | Mostrar, no contar |
| 3 | **Lo que resuelve** (4 puntos) | Por qué no hacerlo a mano |
| 4 | **Tres formas de usarlo** (tarjetas SDK / API / MCP) | Elegir camino |
| 5 | **Pruébalo sin instalar nada** (captura o iframe del playground) | Segunda llamada a la acción |
| 6 | **Transparente por diseño** (prueba de confianza) | Credibilidad verificable |
| 7 | **Con un agente de IA, en un prompt** | Diferenciador |
| 8 | Pie: aviso legal, licencia, enlaces | Responsabilidad |

En Starlight, el bloque 1 es la página `index.mdx` con `template: splash` y `hero` (`title`, `tagline`,
`actions`). Los bloques 2 a 7 son MDX con componentes propios o de Starlight (Tabs, Cards).

### 2.2 Textos propuestos

Todos salen del README, de `sitio-fuente/inicio.md` o de `docs/`. No se añade ninguna regla fiscal.

**Titular (H1).** *Facturación para Honduras, sin inventar reglas.*

Alternativas:
- *Emite facturas conforme al Acuerdo 481-2017 desde tu código.*
- *La capa fiscal hondureña de tu sistema, en una dependencia.*

**Subtítulo.**
> SDK de TypeScript, API REST y servidor MCP de código abierto para emitir facturas, notas de crédito y
> notas de débito conforme al Reglamento del Régimen de Facturación (Acuerdo 481-2017). Numeración, CAI,
> ISV y montos en letras ya resueltos; cada regla cita su artículo y tiene una prueba.

**Botones.** `Empezar` (primario, va a `/empezar/`) · `Probar en el navegador` (secundario, va a
`/playground/`) · `GitHub` (enlace mínimo).

**Bajo los botones.** `npm install factura-hn` con botón de copiar, y debajo: *Sin dependencias · Node, Bun,
Deno, navegador y edge · MIT*.

**Ejemplo de código (pestaña SDK).** Es el ejemplo «En 30 segundos» del README, recortado:

```ts
import { AlmacenFiscalMemoria, emitir, registrarAutorizacion } from 'factura-hn';

const almacen = new AlmacenFiscalMemoria(); // en producción: AlmacenPostgres o AlmacenSQLite

// Una vez por resolución: el CAI, su rango y su fecha límite.
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2027-06-30',
});

// En cada venta: valida, numera y guarda en una transacción.
const factura = await emitir(
  {
    emisor, // RTN, razón social, nombre comercial, direcciones, teléfono y correo
    cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' },
      { descripcion: 'Cerveza lata', cantidad: 6, precioUnitario: '32.00', isv: 'ISV18' },
    ],
  },
  { almacen, establecimiento: '000', puntoEmision: '001' },
);

factura.numero;                // "000-001-01-00000001"
factura.totales.total;         // 371
factura.totales.totalEnLetras; // "TRESCIENTOS SETENTA Y UN LEMPIRAS CON 00/100"
```

> Este fragmento tiene que probarse igual que el README: `packages/core/test/readme.test.ts` ya comprueba
> que el ejemplo da los números que promete. Hay dos caminos: sacar el fragmento del README con un marcador,
> o agregar el archivo de la landing a esa prueba con el comentario `<!-- declaraciones: … -->` que declara
> `emisor`.

**Pestaña API REST.** Es el `curl` de `docs/api.md` tal cual (`POST /v1/documentos` con `authorization:
Bearer`, `idempotency-key` y cuerpo `{"documento": …}`), con este texto al pie:
*Cualquier lenguaje. `Idempotency-Key` obligatoria; los errores fiscales llegan como 422 con la lista
completa.*

**Pestaña Agente de IA.** El prompt de una línea del SDK, del README, sin cambios (está probado).

**Lo que resuelve.** Sale de `inicio.md`:
- **Numeración atómica y sin huecos.** Cada número se reserva en la misma transacción que guarda el
  documento. Nunca se borra ni se reutiliza.
- **Dinero exacto.** Sin punto flotante. El ISV sigue el redondeo del Art. 9 de la Ley del ISV.
- **Documentos inmutables.** Se anulan (Art. 41) o se corrigen con notas de crédito o de débito.
- **Bitácora de auditoría** con quién hizo cada operación.

**Tres formas de usarlo.** Sale de la tabla de `inicio.md`:
- **SDK:** proyectos JavaScript/TypeScript que emiten con su propia base, PostgreSQL o SQLite.
- **API REST:** cualquier lenguaje, o varias cajas contra un servidor del negocio. Se instala con Docker.
- **Servidor MCP:** agentes de IA que emiten, consultan y anulan.

**Pruébalo sin instalar nada.**
> El SDK corre en tu navegador, sin servidor. Emite, mira la factura impresa, el ticket y los errores
> fiscales. Los CAI son ficticios: nada de lo que emitas tiene validez fiscal.

**Transparente por diseño (prueba de confianza).** Solo afirmaciones que se pueden comprobar con un clic:
- **Matriz de cumplimiento pública:** cada artículo, cómo se cumple y la prueba que lo verifica. Enlaza a
  `/cumplimiento/matriz/`.
- **Lo que aún no sabemos, por escrito:** las preguntas abiertas están en la consulta al SAR. Enlaza a
  `/cumplimiento/consulta-sar/`.
- **Código abierto (MIT)** con CI público. En npm, con procedencia firmada en las versiones publicadas desde
  el CI. La 0.2.0 sale sin procedencia (DEC-042), así que no hay que afirmarlo de todas.
- **Datos de ejemplo ficticios** y auditados en cada cambio (`pnpm auditar:datos`).
- *No usar:* logos de clientes, número de descargas ni testimonios mientras no existan. Afip SDK usa logos y
  «100 mil descargas»; aquí sería inventado.

**Pie (obligatorio).**
> factura-hn no es asesoría fiscal ni un sistema autorizado por el SAR. Quien emite sigue siendo responsable
> de cumplir el Reglamento; revisa la configuración con tu contador. Para emitir desde un sistema necesitas
> inscribirte como autoimpresor y obtener tu CAI.

Este aviso combina `inicio.md` y `normativa.md`. Mencionar al SAR aquí es correcto: es una aclaración, no
la marca.

### 2.3 Problemas de marca en el sitio actual

`scripts/sitio.mjs` publica `<title>factura-hn: facturación SAR Honduras</title>` y la meta descripción
«Facturación conforme al SAR de Honduras…». El H1 de `sitio-fuente/inicio.md` es «Facturación SAR Honduras,
sin inventar reglas», y el lema del README es «Facturación SAR Honduras para JavaScript/TypeScript».
Propuesta:
- Título del sitio: `factura-hn`.
- Descripción: «Facturación conforme al Acuerdo 481-2017 de Honduras: SDK, API REST y servidor MCP de
  código abierto».
- Decidir aparte si los prompts probados («…agrega facturación SAR Honduras…») se mantienen. Funcionan como
  término de búsqueda, no como marca, pero cambiarlos obliga a cambiar `readme.test.ts`.

## 3. Comparación de stacks

El generador actual va como referencia. Las versiones y las dependencias directas salen del registro de npm
el 19-11-2026. Las dependencias transitivas no se midieron porque no se instaló nada.

| Criterio | Generador propio (`sitio.mjs` + marked) | **Astro Starlight** | VitePress | Fumadocs |
|---|---|---|---|---|
| **Madurez** | Propio, 252 líneas, en uso | `@astrojs/starlight` 0.43.1 (13-11-2026) sobre Astro 7. Todavía es 0.x: la 0.43.0 trajo cambios incompatibles en una versión menor | 1.6.4 estable; la 2.0 lleva tiempo en alfa (2.0.0-alpha.21) | 16.19.5 (19-11-2026), con publicaciones casi diarias; sobre Next.js 16 |
| **Dependencias directas** | 1 (`marked`) | 27 directas más `astro` como peer (Astro trae su propio árbol) | 18 directas, entre ellas `vue`, `vite` y `shiki` | `fumadocs-core` (21) + `fumadocs-ui` (20) + `fumadocs-mdx`, con `next`, `react`, `react-dom` y Tailwind (`@fumadocs/tailwind`) |
| **i18n en español** | Textos propios | Español incluido en la interfaz. `root` con `lang: 'es'` pone el sitio en español sin rutas `/es/` | Sin traducciones incluidas: hay que traducir a mano unas 13 etiquetas (`outline`, `docFooter`, `darkModeSwitchLabel`…) y las del buscador | No se confirmó un paquete oficial en español; se agregan con `i18nProvider`/`.add()` |
| **Buscador** | No tiene | Pagefind, sin configurar, estático, con lematización y textos en español | MiniSearch local (índice en el navegador) o Algolia | Orama estático: el cliente descarga el índice exportado. En español hay que configurar el tokenizador |
| **OpenAPI** | Propio y en español (`referenciaApi()`) | `starlight-openapi` 0.27.1: 4 dependencias, OAS 2/3.0/3.1, páginas estáticas. **Sus textos están fijos en inglés** («Request Body», «required»). Scalar tiene integración con Astro | `vitepress-openapi`: OAS 3.0/3.1, **español incluido** (comunitario) | `fumadocs-openapi` 12.6.6: páginas por operación con playground. No se confirmó cómo envía las peticiones en modo estático |
| **MDX** | No | Sí (MDX y Markdoc) | No: Markdown con componentes Vue | Sí, nativo |
| **Rendimiento** | HTML puro, CSS en línea | HTML estático. JS solo para islas (buscador, tema) | HTML prerenderizado; después se hidrata como SPA de Vue y precarga enlaces | Next exporta HTML y luego hidrata React y la carga RSC |
| **Estático puro en Pages** | Sí | Sí. Acción oficial `withastro/action` o build propio; `site` + `base: '/factura-hn'` | Sí, con `base: '/factura-hn/'` y guía oficial de Pages | **Sí, con pérdidas:** `output: 'export'` funciona, pero sin buscador de servidor, Ask AI, servidor MCP, `proxy.ts` (ni redirecciones de idioma ni Markdown por `Accept`), rewrites ni optimización de imágenes por defecto. Las versiones `.md` quedan en rutas con prefijo `/llms.mdx/…` |
| **llms.txt** | Hay un `llms.txt` curado en la raíz, pero el sitio no lo publica | `starlight-llms-txt` 0.12.0: `llms.txt`, `llms-full.txt` y `llms-small.txt` | `vitepress-plugin-llms` (comunitario): `llms.txt`, `llms-full.txt` y `.md` por página | Integrado: `llms.txt`, `llms-full.txt` y `.md` por página |
| **Mantenimiento** | Todo a mano: barra lateral, TOC, móvil, accesibilidad, resaltado, buscador | Equipo de Astro; plugins activos (`starlight-links-validator`, `starlight-llms-txt`) | Equipo de Vue/Vite; la rama 1.x cambia poco | Muy activo, pero con un solo responsable principal y muchas piezas en movimiento (Next, React, Tailwind) |
| **Migración desde los Markdown actuales** | Ninguna | Los Markdown viven en `docs/` y el contenido va en `src/content/docs/` con `title` obligatorio. **No reescribe enlaces relativos `.md`**: se resuelve con el script de sincronización (sección 7) | Igual: copia, `base` y enlaces | Igual, más la convención de rutas de Next (`app/[lang]`) y React |

### Herramientas para la referencia de la API

| Opción | Español | Estático e indexable | Probar peticiones | Estado |
|---|---|---|---|---|
| **Generador propio portado** | Sí, nativo | Sí: el HTML lo indexa Pagefind | No | Ya funciona; falta portarlo a páginas de Starlight |
| **Scalar** (MIT) | Sí: `localization: { locale: 'es' }` entre 9 idiomas incluidos | Se renderiza en el cliente; Pagefind no lo indexa | Sí. Desde otro origen pide `proxyUrl` (el ejemplo usa `proxy.scalar.com`, de terceros) | ~16 400 estrellas, muy activo; CDN sin build |
| **Redoc CE** (MIT) | No documentado | `redocly build-docs` genera un HTML suelto | No documentado en CE | 3.2.0 (19-11); una sola vista para OAS 3.0, 3.1 y 3.2 |
| **Stoplight Elements** | No documentado | Web component en el cliente | En la hoja de ruta, sin confirmar | Commits hasta el 19-11-2026, npm 9.0.29; la página de releases de GitHub está desactualizada (v6.1.10); 215 incidencias abiertas |
| **starlight-openapi** | **No** (textos fijos en inglés) | Sí | No | 0.27.1, activo |

Hoy la API no tiene una URL pública: corre en la máquina del negocio con `docker compose`. Un «probar
petición» en GitHub Pages apuntaría a `127.0.0.1` del visitante y chocaría con CORS. Por eso conviene una
referencia estática. La documentación interactiva ya existe en el `/docs` de cada instalación (Swagger UI).

## 4. Recomendación

**Astro Starlight**, por estas razones:

1. **Español sin trabajo extra.** Es el único de los tres que trae la interfaz en español y un buscador con
   lematización en español (Pagefind). VitePress obliga a traducir a mano su interfaz y la de su buscador.
   En Fumadocs no se confirmó un paquete oficial en español.
2. **Estático de verdad.** Pagefind no tiene componente de servidor. Fumadocs funciona en Pages, pero
   pierde justo lo que lo distingue (buscador de servidor, Ask AI, MCP, Markdown por `Accept`). Además arrastra
   Next, React y Tailwind para una documentación de 10 a 20 páginas.
3. **Lo que la landing necesita ya existe.** `template: splash`, `hero` con `actions`, Cards, Tabs, Asides,
   Steps, Expressive Code (marcos de terminal, títulos, marcadores) y tema claro, oscuro o automático.
4. **Encaja con lo que ya hay.** MDX para la landing, Markdown para las guías, `starlight-links-validator`
   para enlaces y anclas, y `starlight-llms-txt` si se quiere `llms-full.txt` automático.
5. **Sus riesgos se pueden manejar.** Starlight es 0.x y rompe en versiones menores. Se fijan versiones
   exactas, como hace el repositorio con sus acciones y dependencias, y se actualiza leyendo el changelog.

**Por qué no VitePress.** Es estable, rápido y tiene menos dependencias directas, y `vitepress-openapi` trae
español. Pero hay que traducir a mano toda la interfaz y el buscador, su contenido es Markdown con Vue en vez
de MDX, y la 2.0 sigue en alfa sin fecha. Es la segunda opción razonable si se quiere mínimo peso.

**Por qué no Fumadocs.** Es el más completo en IA (llms, MCP, Ask AI), pero esas funciones necesitan
servidor y GitHub Pages no lo tiene. Si algún día el sitio pasa a un host con servidor, conviene volver a
evaluarlo.

**Sobre DEC-043.** El generador propio se eligió para no tener «decenas de dependencias y una segunda
estructura de documentación». La propuesta respeta las dos condiciones:
- Las dependencias quedan aisladas en un paquete privado `sitio/` del workspace. Son solo de desarrollo, no
  entran en `pnpm test` (filtra `./packages/*`) y no afectan el «sin dependencias» del SDK.
- No hay segunda estructura: el contenido se genera desde los mismos Markdown.

Hace falta una nueva decisión que reemplace a DEC-043, con la alternativa descartada anotada: seguir con el
generador propio y añadir Pagefind, un selector de tema y una barra lateral a mano.

**Funciones pedidas, cómo quedan:**

| Función | Solución |
|---|---|
| Guías | Páginas de Starlight generadas desde `docs/*.md` y los README de los paquetes |
| Referencia de la API | `referenciaApi()` portado: escribe Markdown/HTML en español, una página por grupo (tag) y otra de esquemas. Opcional: una página «Explorador» con Scalar (CDN, `locale: 'es'`, `hideTestRequestButton: true`) |
| Buscador | Pagefind, el de Starlight. Se excluyen la landing y el playground con `pagefind: false` |
| Modo oscuro | El de Starlight (oscuro, claro o automático) con la paleta de la sección 5. El playground recibe el tema con `?tema=` o `postMessage`, porque hoy solo sigue `prefers-color-scheme` |
| Versión en una sola URL | (a) Una URL estable sin `/v0/` mientras sea 0.x (`starlight-versions` existe para más adelante). (b) **`/todo/`**: toda la documentación en una página HTML (página Astro que recorre la colección), útil para imprimir, buscar con Ctrl+F y dársela a un agente. Su par en texto es `/llms-full.txt` |
| llms.txt | Publicar el `llms.txt` curado de la raíz (ya probado por `readme.test.ts`) con los enlaces convertidos a URLs del sitio. Generar `llms-full.txt` concatenando los mismos Markdown, y copiar el Markdown de cada página como `/<ruta>.md`, como recomienda llmstxt.org. Docs de Stripe y Resend ya sirven Markdown a los agentes |

## 5. Dirección visual

Busca parecer una referencia técnica seria y tranquila, no una página de marketing ni un portal del
gobierno.

### 5.1 Tipografía

- **Texto e interfaz: IBM Plex Sans** (SIL OFL 1.1). Pesos 400, 500 y 600. Cubre el latín extendido
  (ñ, tildes, ¿¡) y es sobria y legible en tablas densas como la matriz.
- **Código y cifras: IBM Plex Mono** (OFL 1.1). Pesos 400 y 500. Los montos de tablas y ejemplos van en
  mono, o con `font-variant-numeric: tabular-nums` si se confirma que Plex Sans lo soporta al implementar.
- **Alternativa con el mismo papel:** Geist y Geist Mono (OFL).
- **Carga:** las fuentes se alojan en el propio sitio con Fontsource (`@fontsource/ibm-plex-sans` y
  `@fontsource/ibm-plex-mono`), el método documentado por Starlight. Solo los subconjuntos `latin` y
  `latin-ext`, con `font-display: swap`. Sin Google Fonts: ni terceros ni otra conexión.
- **Escala:**
  - Texto: 16 px con interlineado 1,65 y un ancho de 68 a 72 caracteres.
  - H1 de la landing: `clamp(2.25rem, 5vw, 3.5rem)`, peso 600, interlineado 1,1, `letter-spacing: -0.02em`.
  - Subtítulo: 1,25 rem en color suave.
  - H1 de las guías: 2 rem.
  - En Starlight se configuran `--sl-font` y la variable de mono de `props.css`.

### 5.2 Paleta

Mantiene el azul del sitio actual para dar continuidad. Los contrastes se calcularon con la fórmula de
luminancia relativa de WCAG 2.x.

**Claro**

| Token | Hex | Contraste sobre `fondo` | Uso |
|---|---|---|---|
| `fondo` | `#FAFAF9` | — | Página |
| `superficie` | `#F2F1EE` | — | Código, tarjetas, encabezados de tabla |
| `borde` | `#E2E0DB` | 1,26 (decorativo) | Separadores |
| `borde-fuerte` | `#86837B` | **3,63** (≥ 3 para componentes, WCAG 1.4.11) | Campos, foco secundario |
| `texto` | `#1A1A18` | **16,69** (AAA) | Cuerpo |
| `suave` | `#5B5952` | **6,71** (AA; 6,21 sobre `superficie`) | Texto secundario |
| `acento` | `#0B5D8F` | **6,75** (AA; 6,25 sobre `superficie`) | Enlaces, botón primario |
| `acento-hover` | `#084A72` | **9,01** | Hover |
| `acento-suave` | `#E3EEF6` | `acento` encima: 5,99 | Fondo de badges y selección |
| `exito` | `#17663D` | **6,69** | POST, estados correctos |
| `aviso` | `#8A5300` | **6,06** (5,61 sobre `#FBF0DC`) | Avisos `AVISO_*`, «obligatorio» |
| `error` | `#B42318` | **6,29** | DELETE, errores |
| Botón primario | blanco sobre `#0B5D8F` | **7,06** (AAA) | «Empezar» |

**Oscuro**

| Token | Hex | Contraste sobre `fondo` | Uso |
|---|---|---|---|
| `fondo` | `#111110` | — | Página |
| `superficie` | `#1B1B19` | — | Código, tarjetas |
| `borde` | `#2E2D2A` | 1,37 (decorativo) | Separadores |
| `borde-fuerte` | `#6E6B64` | **3,55** | Campos |
| `texto` | `#ECEBE7` | **15,84** | Cuerpo |
| `suave` | `#A3A099` | **7,24** (6,61 sobre `superficie`) | Secundario |
| `acento` | `#7CC0EC` | **9,54** (8,71 sobre `superficie`) | Enlaces |
| `acento-hover` | `#A6D5F3` | **12,09** | Hover |
| `acento-suave` | `#14293A` | `acento` encima: 7,53 | Badges |
| `exito` | `#6FD39F` | **10,34** | POST |
| `aviso` | `#F0C060` | **11,17** (9,02 sobre `#2E2410`) | Avisos |
| `error` | `#FF8F85` | **8,56** | DELETE |
| Botón primario | **`#111110` sobre `#7CC0EC`** | **9,54** | En oscuro el texto del botón va oscuro: blanco sobre `#7CC0EC` da **1,98** y no pasa |

**Badges de método:**

| Método | Claro | Oscuro |
|---|---|---|
| GET | `#0B5D8F` sobre `#E3EEF6`: 5,99 | `#7CC0EC` sobre `#14293A`: 7,53 |
| POST | `#17663D` sobre `#E4F3EA`: 6,09 | `#6FD39F` sobre `#12291D`: 8,45 |
| DELETE | `#B42318` sobre `#FCE8E6`: 5,58 | `#FF8F85` sobre `#3A1C19`: 7,00 |

Todos pasan AA para texto normal (≥ 4,5).

En Starlight, los tokens se asignan a sus variables de color (`--sl-color-accent*` y la escala de grises de
`props.css`; confirmar los nombres al implementar). El tema oscuro va en `:root` y el claro en
`:root[data-theme='light']`. El playground (`examples/playground/public/index.html`) tiene sus propias
variables: conviene igualarlas a estos tokens.

### 5.3 Estilo de código

- **Motor:** Expressive Code, que viene con Starlight. Temas Shiki `github-light` y `github-dark`, con el
  fondo cambiado a `superficie` para que el código se integre con la página.
- **Marcos:** los bloques `bash` llevan marco de terminal. Los de archivo llevan título (`title="caja.ts"`).
  Botón de copiar en todos.
- **Convención de la casa (ya está en el README):** el resultado esperado va como comentario al final de la
  línea (`// "000-001-01-00000001"`). Los marcadores de texto resaltan la línea que importa para la regla
  fiscal.
- **Pestañas de instalación:** pnpm, npm, yarn y bun.
- **Prompts** (`text`): se ajustan al ancho en vez de desplazarse, como ya hace el CSS actual con
  `pre:has(code.language-text)`.
- **Contraste del código:** Expressive Code tiene un ajuste de contraste mínimo para el resaltado. Hay que
  revisarlo con la paleta final.

### 5.4 Iconografía y marca

- **Interfaz:** los iconos que trae Starlight (`<Icon>`). En la landing, **Lucide** (ISC) en SVG en línea, de
  20 px, trazo de 1,5 y `currentColor`.
- **Sin emojis en el sitio.** El ⚠️ del README pasa a un Aside `caution`. Los símbolos de estado de la matriz
  (✅ 🟡 ❌ 📄 ➖) pueden quedar en el texto, pero conviene mostrarlos como badges con texto («cubierto»,
  «parcial», «ausente»…) para lectores de pantalla.
- **Marca:**
  - Logotipo: la palabra `factura-hn` en Plex Mono 600, en minúsculas.
  - Favicon: el cuadrado con «F» del sitio actual, con una variante para fondo oscuro.
  - Sin bandera, estrellas, escudo, colores institucionales ni sellos que sugieran algo oficial. Sin «SAR»
    en el logotipo, el título ni la descripción.

### 5.5 Sitios de referencia

| Sitio | URL | Qué tomar | Qué no tomar |
|---|---|---|---|
| **Stripe API Reference** | https://docs.stripe.com/api | Cómo ordenar una referencia: URL base, autenticación, errores, **solicitudes idempotentes** y versiones antes de los endpoints. Esto encaja con `Idempotency-Key`, el 422 y los webhooks firmados. También ofrece la versión Markdown de cada página para agentes | Las dos columnas con código en vivo en varios lenguajes: es mucho más de lo que un proyecto de una persona puede mantener |
| **Biome** | https://biomejs.dev | Landing de una herramienta para desarrolladores hecha con Astro: hero con instalación en pestañas, ejemplos de código con antes y después, tarjetas de funciones breves y selector de idioma con español. Se confirmó que usa Astro, no que use Starlight | Las cifras de rendimiento y las paredes de logos, mientras no haya datos propios |
| **Afip SDK** | https://afipsdk.com | La referencia del responsable en la región: «Comenzar» y «Ver documentación» como llamadas, barra de avisos sobre cambios normativos (allí, una Resolución General de ARCA) y un aviso claro de que no está afiliado a organismos oficiales | Los logos de clientes y las cifras de descargas (aquí no existen) y una landing sin código: factura-hn debe mostrar código en el hero |

## 6. Mapa del sitio

Las URLs llevan el prefijo `/factura-hn/` en GitHub Pages.

```
/                         Landing (splash)                      sitio/src/content/docs/index.mdx
/empezar/                 Elige: SDK, API o MCP + primer paso   nuevo (MDX corto, basado en inicio.md)
/playground/              Playground incrustado                 sitio-fuente/playground.md → MDX
/guias/
  sdk/                    Guía rápida del SDK                   docs/guia-sdk.md
  persistencia/           Almacenes y almacén propio            docs/persistencia.md        (nueva en el sitio)
  api/                    API REST: roles, idempotencia…        docs/api.md
  autoalojamiento/        Docker en el local del negocio        docs/autoalojamiento.md
  agentes-ia/             Prompts, AGENTS.md, skill             AGENTS.md (+ skills/…/SKILL.md enlazado)
  mcp/                    Servidor MCP                          packages/mcp/README.md
  cliente/                Cliente tipado y webhooks             packages/cliente/README.md
  pdf/                    PDF carta y ticket                    packages/pdf/README.md
  ejemplos/               Básico, POS offline, Express, Next    tabla del README + enlaces a examples/
/referencia/
  sdk/                    Funciones del SDK                     sección «API» del README
  api-rest/               Resumen + autenticación + errores     generado de packages/api/openapi.json
  api-rest/<grupo>/       Una página por tag                    generado
  api-rest/esquemas/      Esquemas                              generado
  api-rest/explorador/    (opcional) Scalar, solo lectura       página Astro
/cumplimiento/
  matriz/                 Matriz de cumplimiento                docs/investigacion.md §1 (recorte actual)
  normativa/              Qué cubre y fuentes                   docs/normativa.md
  consulta-sar/           Preguntas abiertas al SAR             docs/consulta-sar.md
/proyecto/
  cambios/                CHANGELOG                             CHANGELOG.md
  contribuir/             Cómo contribuir                       CONTRIBUTING.md
  seguridad/              Política de seguridad                 SECURITY.md
/todo/                    Toda la documentación en una página   página Astro
/llms.txt  /llms-full.txt  /<ruta>.md                           generados
/404
```

**Fuera del sitio** (son internos y quedan solo en GitHub): `docs/decisiones.md`, `docs/avance.md`,
`docs/lanzamiento.md`, `docs/modelo-de-negocio.md`, y las secciones 2 a 6 de `investigacion.md`. El
generador ya enlaza a GitHub los Markdown que no tienen página: se mantiene igual.

**Redirecciones:** las URLs del sitio actual (`guia-sdk.html`, `api.html`, `cumplimiento.html`…) no se han
publicado todavía, porque Pages sigue apagado (DEC-042). Si el sitio nuevo sale antes que el viejo, no hacen
falta.

## 7. Plan de migración

### Qué se conserva de `scripts/sitio.mjs`

| Pieza actual | Destino |
|---|---|
| Lista `PAGINAS` (fuente → página → menú) | Se mantiene como tabla única en el script de sincronización. De ella salen las rutas, la barra lateral y el `llms.txt` |
| `resolverEnlace()` (enlace relativo `.md` → página o GitHub `blob`/`tree`) | Se mantiene y se adapta a las rutas nuevas con la `base`. Resuelve lo que Starlight no hace solo |
| `slug()` y los ids de los encabezados | Hay que comprobar que coincidan con los de Starlight, que usa `github-slugger`, para no romper anclas como `#2-abre-el-almacen-fiscal`. El verificador final lo detecta |
| `recorte` de `investigacion.md` | Igual |
| `referenciaApi()` | Se porta para que escriba páginas (`.md` con HTML en línea o `.mdx`) en el contenido generado |
| `<!-- playground -->` → iframe | Igual. El playground se copia a `sitio/public/playground/` |
| Verificación de enlaces, anclas y archivos del repositorio | **Se conserva como paso posterior al build sobre el HTML final** (`sitio/dist`), con la `base` en cuenta. Es independiente del framework y además comprueba que los `blob`/`tree` de GitHub existan, algo que ningún plugin hace. `starlight-links-validator` puede sumarse, pero no lo sustituye |
| Pie con aviso legal y «Fuente de esta página» | Componente `Footer` sobrescrito; `editLink` de Starlight apunta al archivo fuente (que no es `src/content/docs/…`, por eso va personalizado) |

### Pasos

1. **Decisión.** Registrar la nueva DEC (Starlight reemplaza a DEC-043) en `docs/decisiones.md`, con la
   alternativa descartada. No cambia ninguna interpretación fiscal, así que no lleva [REVISAR].
2. **Paquete `sitio/`.** Pedir permiso antes de instalar, según las reglas del proyecto.
   - Crear el paquete privado `@factura-hn/sitio` con `astro` y `@astrojs/starlight` en versiones exactas.
   - Agregar `sitio` a `pnpm-workspace.yaml`.
   - Configuración: `site: 'https://augustomelara-dev.github.io'`, `base: '/factura-hn'`, `locales.root` con
     `lang: 'es'`, título `factura-hn`, enlace social a GitHub, `customCss`.
   - **Ajustar `.gitignore`:** hoy ignora todo `sitio/` (la salida actual) y además `*.html` y `*.txt`. Hay que
     ignorar solo `sitio/dist`, `sitio/.astro`, `sitio/src/content/docs/_gen*` y `sitio/public/playground`, y
     añadir excepciones si algún `.html` o `.txt` del sitio se versiona.
   - **Revisar `allowBuilds`** de pnpm: hoy solo permite `esbuild`. Si Astro pide `sharp`, permitirlo o usar el
     servicio de imágenes sin procesamiento, porque el sitio casi no tiene imágenes.
   - Astro pide Node 22 o superior (su guía indica 22.23.4+). El flujo de Pages ya usa Node 24.
3. **Script de sincronización** (`scripts/sitio-contenido.mjs`, sale de `sitio.mjs`). Al construir:
   - lee cada fuente;
   - saca el H1 a `title` del frontmatter (Starlight lo exige y lo pinta él) y añade `description`;
   - reescribe los enlaces;
   - aplica el recorte y el reemplazo del playground;
   - escribe la referencia de la API;
   - copia el Markdown limpio de cada página a `public/<ruta>.md`;
   - genera `llms.txt` (desde el de la raíz) y `llms-full.txt`.

   El contenido generado no se versiona. `sitio-fuente/` desaparece: la landing y la página del playground
   pasan a `sitio/src/content/docs/` como MDX propios del sitio, porque no son documentación del repositorio.
4. **Landing, `/empezar/`, `/todo/` y estilos** según las secciones 2 y 5. El ejemplo de código queda cubierto
   por `readme.test.ts`.
5. **Verificación.** Portar la sección «Verificar enlaces internos» a `scripts/verificar-sitio.mjs` sobre
   `sitio/dist`, con la `base`. Agregar una revisión de accesibilidad (por ejemplo, contraste y nombres
   accesibles) cuando se decida la herramienta; esto no está incluido en la propuesta.
6. **Scripts y flujos:**
   - `pnpm sitio` pasa a ser `pnpm playground && node scripts/sitio-contenido.mjs && pnpm --filter
     @factura-hn/sitio build && node scripts/verificar-sitio.mjs`.
   - `pnpm ci` no cambia: ya llama a `pnpm sitio`.
   - En `.github/workflows/pages.yml` solo cambia `path: sitio` por `path: sitio/dist`. Se mantienen
     `PUBLICAR_SITIO`, las acciones fijadas por SHA y los permisos mínimos. No hace falta `withastro/action`.
7. **Retirar** `scripts/sitio.mjs`, `marked` (si nada más lo usa) y `sitio-fuente/`. Actualizar la línea de
   `pnpm sitio` en el README y `docs/lanzamiento.md` si cambia algo.
8. **Marca:** corregir el título y la descripción (sección 2.3). Ofrecer al responsable el cambio del lema del
   README.

### Riesgos

- **Starlight es 0.x** y rompe en versiones menores: se fijan versiones y se actualiza leyendo el changelog.
- **Los ids de los encabezados pueden cambiar** al pasar de `slug()` a `github-slugger`. El verificador del
  paso 5 detecta las anclas rotas.
- **El tema del sitio no llega al iframe del playground** si el visitante fuerza el tema en el selector. Se
  resuelve con un parámetro o un mensaje entre ventanas.
- **Scalar**, si se añade, carga un bundle de JavaScript del CDN y su contenido no entra en el buscador. Por
  eso es solo un complemento.

## 8. Fuentes

Consultadas el 19-11-2026, solo lectura.

**Proyecto:** `scripts/sitio.mjs`, `.github/workflows/pages.yml`, `examples/playground/` (README e
`index.html`), `sitio-fuente/inicio.md`, `sitio-fuente/playground.md`, `README.md`, `llms.txt`,
`docs/normativa.md`, `docs/api.md`, `docs/guia-sdk.md`, `docs/investigacion.md`, `docs/decisiones.md`
(DEC-041 a DEC-044), `docs/avance.md`, `.gitignore`, `pnpm-workspace.yaml`, `package.json`,
`packages/api/package.json`, `packages/api/openapi.json` (OpenAPI 3.1.0, 17 rutas, 19 esquemas).

**Starlight y Astro**
- https://starlight.astro.build/getting-started/
- https://starlight.astro.build/guides/site-search/
- https://starlight.astro.build/guides/i18n/
- https://starlight.astro.build/guides/customization/
- https://starlight.astro.build/guides/css-and-tailwind/
- https://starlight.astro.build/guides/components/
- https://starlight.astro.build/guides/authoring-content/
- https://starlight.astro.build/reference/frontmatter/
- https://starlight.astro.build/reference/configuration/
- https://starlight.astro.build/manual-setup/
- https://starlight.astro.build/resources/plugins/
- https://starlight.astro.build/resources/showcase/
- https://github.com/withastro/starlight/releases
- https://registry.npmjs.org/@astrojs/starlight/latest
- https://docs.astro.build/en/guides/deploy/github/
- https://docs.astro.build/en/install-and-setup/

**Plugins de Starlight**
- https://github.com/HiDeoo/starlight-openapi
- https://starlight-openapi.vercel.app/getting-started/
- https://starlight-openapi.vercel.app/configuration/
- https://raw.githubusercontent.com/HiDeoo/starlight-openapi/main/packages/starlight-openapi/index.ts
- https://raw.githubusercontent.com/HiDeoo/starlight-openapi/main/packages/starlight-openapi/components/RequestBody.astro
- https://registry.npmjs.org/starlight-openapi/latest
- https://github.com/delucis/starlight-llms-txt
- https://delucis.github.io/starlight-llms-txt/
- https://registry.npmjs.org/starlight-llms-txt/latest
- https://starlight-links-validator.vercel.app/getting-started/
- https://www.npmjs.com/package/astro-rehype-relative-markdown-links (enlaces relativos `.md` en Astro)

**VitePress**
- https://vitepress.dev/guide/what-is-vitepress
- https://vitepress.dev/reference/default-theme-search
- https://vitepress.dev/guide/i18n
- https://vitepress.dev/reference/default-theme-config
- https://vitepress.dev/guide/deploy
- https://registry.npmjs.org/vitepress/latest
- https://github.com/enzonotario/vitepress-openapi
- https://vitepress-openapi.vercel.app/
- https://github.com/okineadev/vitepress-plugin-llms

**Fumadocs y Next.js**
- https://www.fumadocs.dev/docs
- https://www.fumadocs.dev/docs/deploying/static
- https://www.fumadocs.dev/docs/integrations/openapi
- https://www.fumadocs.dev/docs/integrations/openapi/api-page
- https://www.fumadocs.dev/docs/integrations/llms
- https://www.fumadocs.dev/docs/internationalization
- https://www.fumadocs.dev/docs/headless/search/orama
- https://github.com/fuma-nama/fumadocs/releases
- https://registry.npmjs.org/fumadocs-core/latest
- https://registry.npmjs.org/fumadocs-ui/latest
- https://nextjs.org/docs/app/guides/static-exports

**Referencia de la API**
- https://github.com/scalar/scalar
- https://scalar.com/products/api-references/configuration
- https://scalar.com/products/api-references/localization
- https://redocly.com/docs/redoc
- https://github.com/Redocly/redoc/releases
- https://registry.npmjs.org/redoc
- https://github.com/stoplightio/elements
- https://github.com/stoplightio/elements/releases
- https://github.com/stoplightio/elements/commits/main
- https://registry.npmjs.org/@stoplight/elements

**Buscador y llms.txt**
- https://pagefind.app/docs/
- https://pagefind.app/docs/multilingual/
- https://llmstxt.org/

**Sitios de referencia**
- https://docs.stripe.com/api
- https://biomejs.dev/
- https://afipsdk.com/
- https://resend.com/ (solo se obtuvo su índice para agentes, no el diseño visual)

**No verificado** (se indica en el texto): si `starlight-links-validator` hace fallar el build, si Plex Sans
trae `tnum`, los nombres exactos de las variables `--sl-color-*`, cómo envía las peticiones el playground de
`fumadocs-openapi` en modo estático, si existe un paquete oficial de Fumadocs en español, y el número de
dependencias transitivas de cada stack (requiere instalar).
