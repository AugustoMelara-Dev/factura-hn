# Análisis: confianza

> Informe de análisis del 19-11-2026, sobre el repositorio en su estado local (0.2.0 sin publicar). No
> modifica nada del proyecto. Los textos de la sección 5 son **borradores para revisión legal**: no se deben
> publicar sin esa revisión.

Pregunta: ¿qué necesitan ver un desarrollador y un contador hondureño para confiar en factura-hn y tomarlo
como la referencia para facturar conforme al Acuerdo 481-2017?

---

## 1. Resumen

- **La base es sólida y poco común:** cada regla cita su artículo con la línea del texto consolidado
  (`docs/investigacion.md`), tiene prueba con nombre y las interpretaciones están registradas en
  `docs/decisiones.md`. Pocos proyectos de facturación, abiertos o comerciales, muestran algo así.
- **El problema es la presentación, no el contenido.** La matriz es una tabla de 7 columnas escrita a mano,
  pensada para desarrolladores. El vínculo requisito → prueba no se comprueba solo. Además, el contador no
  tiene una página escrita para él.
- **Hay afirmaciones que hoy dicen más de lo que el repo respalda:**
  - el badge «procedencia firmada», cuando la 0.2.0 se publicará sin procedencia (DEC-042);
  - la consulta al SAR aparece en el sitio sin decir que **aún no se envió**;
  - «revisión independiente» no dice quién revisó;
  - «[APROBADA]» significa que la aprobó el responsable, no un contador ni un abogado.
- **Falta lo básico de un proyecto «de referencia»:**
  - una página de aviso legal única y coherente;
  - una política de versiones que diga qué pasa cuando cambia la norma;
  - quién está detrás y cómo contactarlo fuera de GitHub;
  - SBOM, cobertura y la «Ficha técnica Art. 53» que ya propone `docs/investigacion.md`. Esa ficha es lo que
    más necesita el contador del emisor para firmar la Declaración Jurada.
- **Prioridad:** primero corregir lo que exagera y unificar el aviso (horas). Después, la matriz generada
  desde las pruebas, la política de versiones y la ficha técnica (días). Al final, la revisión profesional
  documentada, sin llamarla «certificación» (semanas, y depende de terceros).

---

## 2. Qué existe hoy

### Cumplimiento y trazabilidad

| Elemento | Dónde | Valoración |
|---|---|---|
| Matriz de cumplimiento con fuente (línea del texto consolidado), estado, prueba y comparación con invoicehn | `docs/investigacion.md` §1 (≈60 filas: Reglamento y Ley del ISV) | Muy buena en contenido. La escribe una persona, es densa y mezcla el diagnóstico de la 0.1 («Brecha (0.1)») con el estado actual |
| Pruebas de la matriz | `packages/core/test/matriz.test.ts` (`describe` con el número de artículo) y archivos por brecha (`art41-anulacion`, `art9-redondeo`, `paso7-requisitos`…) | Buena convención, pero el vínculo con la tabla es solo textual: si cambia el título de una prueba, la tabla no se entera |
| Segunda tabla de requisitos | `docs/normativa.md` «Mapa de requisitos → librería» | Duplica la matriz sin la columna de prueba. Además está desactualizada: su título «Fuera de alcance en v0.1» no corresponde a la 0.2 |
| Página pública de la matriz | `scripts/sitio.mjs` genera `sitio/cumplimiento.html` desde `docs/investigacion.md` §1 | Existe, pero el sitio aún no está publicado (`PUBLICAR_SITIO`) |
| Fuentes y sus límites | `docs/investigacion.md` «Fuentes y cómo se citan» | Excelente: admite que la Ley del ISV disponible no sirve para citar las tasas vigentes y que el Código Tributario citado es una compilación del CEDIJ, no La Gaceta |
| Preguntas abiertas | `docs/investigacion.md` P-01 a P-14 | Completas. Ver «Consulta al regulador» |

### Interpretaciones ([REVISAR])

- Hoy **ninguna** entrada de `docs/decisiones.md` lleva [REVISAR].
- Llevan [APROBADA 2026-11-18] estas decisiones: DEC-001 a DEC-004, DEC-009, DEC-013, DEC-016 a DEC-024 y
  DEC-031.
- No llevan etiqueta varias decisiones con efecto fiscal u operativo:
  - DEC-008 (`ultimoEmitidoAntes`);
  - DEC-010 (sin feriados en el plazo del Art. 42);
  - DEC-011 (formatos de exportación propios, Art. 53 num. 5);
  - DEC-012 (libro contable en la transacción, Art. 53 num. 1);
  - DEC-025 (aviso de renovación, Art. 59).
- Las demás sin etiqueta son técnicas (Postgres, API, publicación).
- Según la cabecera del archivo, «[APROBADA]» significa aprobada **por el responsable del proyecto**. Eso es
  correcto, pero un lector externo puede entender «aprobada por el SAR» o «por un profesional».

### Consulta al regulador

- `docs/consulta-sar.md` está fechada el 18-11-2026 y es formal y clara. Cada pregunta trae su artículo y la
  lectura provisional.
- **No se ha enviado.** `docs/avance.md` «Sigue», punto 2, la tiene como pendiente, y el documento termina
  con los datos del solicitante en blanco.
- **No tiene estado visible.** No dice si es borrador o si se envió, ni la fecha, el número de expediente o
  la respuesta. El sitio la publica como «Consulta al SAR», y un visitante puede creer que está en trámite.
- **Solo incluye 6 de las 14 preguntas** (P-02, P-06, P-08, P-11, P-13 y P-14). Faltan dos grupos que
  importan para la confianza:
  - **P-01**, si existe un registro o certificación de proveedores de software. Es la pregunta que responde
    «¿está aprobado por el SAR?»;
  - **P-09** (exportaciones: «gravado 0 %» o «exento») y **P-10** (ISV por línea o por grupo de tasa).
    Afectan el cálculo impreso.

### Avisos legales

| Dónde | Texto actual (resumen) |
|---|---|
| `README.md` y `packages/core/README.md` | Ayuda con formato y cálculo; no sustituye la inscripción como autoimpresor ni la revisión de un contador |
| `docs/normativa.md` | No sustituye la autorización del SAR ni la asesoría; hay que inscribirse y obtener CAI; la normativa cambia |
| `sitio-fuente/inicio.md` | No es asesoría fiscal ni un sistema autorizado por el SAR; el emisor es responsable |
| `LICENSE` (MIT) | Sin garantía, en inglés |
| `AGENTS.md`, README de API/MCP/adaptadores, descripción de `openapi.json` | **Sin aviso**. Precisamente son lo que leen los agentes de IA y los integradores de la API |

Son tres redacciones distintas, ninguna completa. Ninguna dice explícitamente «no afiliado al SAR» ni
«no certificado ni homologado», y ninguna enlaza la lista de lo que no cubre.

### Versiones y cambios

- `CHANGELOG.md` está bien escrito, en español y orientado al usuario. Separa «Cambios incompatibles»,
  «Agregado» y «Cambiado», y cita la brecha o decisión (B-xx, DEC-xxx).
- Regla escrita: «mientras sea 0.x, los cambios incompatibles van en versión menor (SemVer §4)». La repiten
  CHANGELOG, CONTRIBUTING, `.changeset/README.md` y la decisión D-02.
- Los seis paquetes publicables comparten versión (`fixed` en `.changeset/config.json`). Eso facilita decir
  «la matriz vale para la versión X».
- **Falta** una política que diga qué cuenta como cambio incompatible **cuando cambia la norma** o cuando se
  corrige un error de cumplimiento. También falta cuánto tiempo se mantiene una versión.
  `docs/modelo-de-negocio.md` promete que «una corrección de cumplimiento llega a todas las versiones con
  soporte», pero `SECURITY.md` solo soporta la 0.2.x y no hay política de soporte.

### Seguridad y cadena de suministro

| Elemento | Estado |
|---|---|
| `SECURITY.md` | Bien enfocado: reporte privado por GitHub, plazos (3 y 10 días hábiles), GHSA y alcance que nombra los riesgos fiscales (correlativos, inmutabilidad). Solo tiene GitHub como canal |
| Publicación sin tokens (OIDC), entorno `npm` con revisor, acciones fijadas por SHA, `persist-credentials: false`, permisos mínimos | Muy bueno (`.github/workflows/release.yml`, `ci.yml`, DEC-042) |
| Procedencia firmada | **Desde la segunda versión publicada.** La 0.2.0 sale de la máquina del responsable sin procedencia (DEC-042, `docs/lanzamiento.md` paso 4), pero el README ya muestra el badge «procedencia firmada» |
| Revisiones de seguridad | DEC-035 y DEC-039 resumen revisiones «independientes» con conteo de hallazgos. No dicen quién las hizo ni hay un informe |
| SBOM | No existe |
| Dependabot o Renovate, CodeQL, OpenSSF Scorecard, `npm audit` en el CI | No existen |
| Núcleo sin dependencias | Sí (`factura-hn`). Es un argumento de confianza fuerte y está en el README |
| Datos ficticios verificados (`pnpm auditar:datos`) | Sí, en el CI. Es un buen argumento para el contador: el repo no expone contribuyentes reales |

### Licencia y autoría

- Licencia MIT en la raíz y dentro de cada paquete, con copyright de «Augusto Melara (VitoCode Technologies)».
  Es adecuada: el modelo de negocio promete que el cumplimiento nunca se cobra.
- Autoría visible: el nombre en LICENSE, README y `package.json`, y el repositorio en una cuenta personal
  (DEC-041).
- **No hay** página «quiénes somos», correo de contacto, sitio de VitoCode, país ni forma de verificar que
  se trata de una persona o empresa hondureña. Tampoco hay `CODEOWNERS` ni lista de mantenedores.
  `CODE_OF_CONDUCT.md` usa el reporte de seguridad de GitHub como canal de denuncias.

### Pruebas y cobertura

- ≈249 casos `it`/`test`, contados con grep:
  - núcleo: 163;
  - API: 41;
  - PDF: 8;
  - MCP: 7;
  - cliente: 5;
  - SQLite y Postgres: 5 cada uno, más la batería de contrato que corre en los tres almacenes;
  - ejemplos: 15.
- También hay pruebas estructurales:
  - `sin-flotante.test.ts` prohíbe el punto flotante en la ruta del dinero;
  - `art9-redondeo` hace un barrido de 0.01 a 1,000.00;
  - una prueba emite 50 veces en paralelo desde 5 cajas;
  - el contrato de almacén es reutilizable y se publica como `factura-hn/pruebas`.
- El CI corre en Node 22 y 24, con Postgres como servicio y la imagen Docker. El badge del CI está en el README.
- **No hay medición de cobertura** (los `vitest.config.ts` no la configuran) ni un número de pruebas visible.

### Revisión profesional

- No hay constancia de revisión por un contador o abogado. `docs/modelo-de-negocio.md` la pide antes de
  cobrar por el alojamiento («Asesoría legal y contable en Honduras»).
- El README invita a contribuir a «contadores y desarrolladores con sistemas ya autorizados».
- La plantilla de issue «Regla fiscal» ya pregunta el origen de la interpretación, con opciones como «Texto
  de la norma», «Respuesta escrita del SAR» y «Criterio de un contador». Es una buena base para registrar
  revisiones.

### Inconsistencias que restan confianza

1. Badge «procedencia firmada» antes de tener procedencia (ver arriba).
2. `docs/investigacion.md` dice «Versión evaluada: factura-hn 0.1.0», pero sus columnas describen la 0.2.
3. `docs/investigacion.md` («Modos de despliegue», punto 2) dice que la API alojada «se ofrece documentando
   que su encaje con el Art. 47 es una pregunta abierta». En cambio, `docs/modelo-de-negocio.md` y
   `docs/consulta-sar.md` dicen que **no se ofrece** hasta la respuesta a P-02.
4. `docs/normativa.md` mantiene «Fuera de alcance en v0.1», con una lista que ya no coincide con la del README.
5. Hay tres versiones mínimas de Node: `engines >=18` en `package.json`, «Node 22.13 o más reciente» en
   CONTRIBUTING y «Node 20+» en el cliente (DEC-036).
6. La tabla «Desarrollo» del README marca cinco paquetes como «npm» antes de publicarse (el núcleo dice
   «0.2.0 al publicar») y `SECURITY.md` da soporte a la «0.2.x (la más reciente)».

---

## 3. Qué falta, por público

### Desarrollador (integrador, equipo de un POS o ERP, agente de IA)

| Necesita ver | Hoy | Falta |
|---|---|---|
| Que cada regla tiene prueba y que la prueba pasa en la versión que instala | Tabla manual + CI | Matriz **generada** desde las pruebas, con versión y commit, y que el CI falle si una fila ✅ pierde su prueba |
| Qué no cubre | Disperso en README («Lo que esta librería no va a emitir»), `normativa.md` e `investigacion.md` | Una sola lista «No cubre», enlazada desde cada aviso |
| Qué pasa cuando cambia la norma | Nada | Política de versiones con categorías normativas (sección 5.4) |
| Estabilidad | «0.x: puede romper en menores» | Plan hacia 1.0 y ventana de soporte: cuántas menores reciben correcciones de cumplimiento |
| Cadena de suministro | Procedencia (desde la 0.2.1 en adelante), OIDC, SHA fijados | SBOM por versión; instrucciones para `npm audit signatures`; badge de procedencia condicionado a que sea cierto |
| Cobertura | No hay | Cobertura por paquete, sobre todo de `packages/core/src`; más útil todavía: «requisitos con prueba / total» |
| Seguridad de la API y el MCP | `SECURITY.md`, DEC-035, DEC-039 | Informe de las revisiones (aunque sea un resumen) y quién las hizo; Dependabot o Renovate |
| Aviso para agentes de IA | AGENTS.md y OpenAPI sin aviso | Un párrafo fijo en AGENTS.md, `llms.txt`, la skill y la descripción de `openapi.json`, para que el agente lo repita al usuario final |

### Contador hondureño (o el dueño del negocio que lo consulta)

El contador no lee TypeScript. Necesita saber: (a) si puede recomendarlo sin arriesgar a su cliente, (b) qué
tiene que hacer el cliente ante el SAR y (c) qué afirma el software y con qué respaldo.

| Necesita ver | Hoy | Falta |
|---|---|---|
| Que no es oficial ni está «aprobado», dicho sin rodeos | Implícito, en tres redacciones distintas | Aviso único con «no afiliado al SAR; no certificado ni homologado; P-01 abierta» |
| Qué debe hacer su cliente ante el SAR | Muy completo en `docs/investigacion.md` §3 a), en una tabla para desarrolladores | Página «Para contadores» en lenguaje llano: los 13 pasos, quién los hace y con qué artículo |
| Modelo de responsabilidad compartida | Disperso | Tabla «factura-hn hace / el emisor hace / el integrador hace» (como la guía PCI de Stripe; sección 5.3) |
| Material para la Declaración Jurada del Art. 53 | Propuesta en `docs/investigacion.md` §3 b) («Ficha técnica Art. 53») | La ficha: cómo cumple la versión X cada numeral del Art. 53, qué depende de la instalación (servidor, respaldos) y qué depende del emisor |
| Las interpretaciones, en una lista corta | `docs/decisiones.md` (44 entradas mezcladas con decisiones técnicas) | Lista filtrada de «decisiones fiscales» con su estado y quién las aprobó, por ejemplo: «aprobada por el responsable; sin revisión profesional» |
| Estado ante el SAR | Consulta sin estado | Estado de la consulta (sección 5.5) y de cada P-xx |
| Muestras | `pnpm example` genera HTML y ticket | Facturas, notas y ticket de muestra en PDF, en el sitio, con datos ficticios marcados como tales; un contador revisa una factura impresa, no código |
| Quién responde | Un nombre en LICENSE | Persona o empresa, país, correo y canal para dudas fiscales |
| Revisión por un colega | No hay | Revisión de un contador o abogado tributario, publicada con su alcance (ver 5.6) |

---

## 4. Propuesta de matriz de cumplimiento

### 4.1 Columnas

Una fila por requisito verificable, con estas columnas:

| Columna | Contenido |
|---|---|
| **ID** | Estable y legible: `R-10.1` (Reglamento, art. y numeral), `ISV-9`, `CT-63.3` |
| **Requisito** | En una frase, sin jerga de código |
| **Fuente** | Norma, artículo y localizador (`C L.584-595`) |
| **Base** | `Literal` (lo dice la norma) · `Interpretación DEC-xxx` · `Por confirmar con fuente oficial` (sin texto primario en el repo) |
| **Cómo se cumple** | Función o código de error |
| **Prueba** | Archivo › título, **generado** a partir del resultado de las pruebas |
| **Estado** | ✅ cubierto y probado · 🟡 parcial · 📄 documental · ➖ del emisor o fuera del SDK · ❌ ausente |
| **Pendiente** | P-xx y si está incluida en la consulta enviada |
| **Revisión profesional** | «Ninguna» hasta que exista; después, un enlace a la revisión (sección 5.6) |

La matriz pública muestra la versión, el commit y la fecha en que se generó. El diagnóstico de la 0.1
(«Brecha (0.1)») y la comparación con invoicehn se mueven a un anexo histórico.

### 4.2 Ejemplo con filas reales del repo

Fuentes: `docs/investigacion.md` §1, `docs/decisiones.md` y los títulos de prueba citados allí.

| ID | Requisito | Fuente | Base | Prueba | Estado | Pendiente | Revisión prof. |
|---|---|---|---|---|---|---|---|
| R-10.1 | Datos del emisor: RTN, razón social, nombre comercial, dirección de casa matriz y del establecimiento, teléfono y correo | Reglamento Art. 10 num. 1, C L.584-595 | Literal; formato del correo DEC-023; longitudes de RTN y DNI DEC-024 | `paso7-requisitos.test.ts` «B-05 …»; `matriz.test.ts` «Art. 10 num. 1: datos del emisor impresos» | ✅ | — | Ninguna |
| R-10.7 | Número `NNN-NNN-NN-NNNNNNNN`; la serie se reinicia tras 99999999 | Art. 10 num. 7, C L.613-633 | Literal; **no se modela el reinicio** (D-07): un rango que lo cruce se rechaza | `matriz.test.ts` «Art. 10 num. 7 …» | 🟡 | — | Ninguna |
| R-11.3 | En ventas mixtas, el crédito fiscal solo reconoce lo gravado | Art. 11 num. 3, C L.736-737 | Literal; la base excluye el gravado 0 % (DEC-020) | `paso7-requisitos.test.ts` «B-02 …» | ✅ | — | Ninguna |
| R-11.4 | Adquirente exonerado: OCE y constancia, o registro SAG/RUPNSA | Art. 11 num. 4, C L.739-749 | Interpretación DEC-021 | `paso7-requisitos.test.ts` «B-12 …» | ✅ (según la interpretación) | P-08, incluida en la consulta (no enviada) | Ninguna |
| R-12 | Exportaciones con tasa cero | Art. 12, C L.752-754; en conflicto con la Ley del ISV, L.165 y L.189 | Interpretación: prevalece el Reglamento («gravado 0 %») | `paso7-requisitos.test.ts` «B-01 …» | ✅ (según la interpretación) | **P-09, no incluida en la consulta** | Ninguna |
| R-41 | Documento con error: leyenda ANULADA; se conservan número, original y copia | Art. 41, C L.1943-1955 | Literal; motivo obligatorio DEC-001 | `art41-anulacion.test.ts`; contrato «anula conservando el número …»; `pdf.test.ts` «Art. 41» | ✅ | — | Ninguna |
| R-42 | Comunicar los no utilizados dentro de los 10 días hábiles del mes siguiente | Art. 42, C L.1958-1990 | Literal; fecha del acontecimiento DEC-009; **feriados a cargo del integrador** (DEC-010) | `paso8-no-utilizados.test.ts` «B-07 …» | ✅ | — | Ninguna |
| R-43 | Custodia ordenada y cronológica por el plazo del Código Tributario | Art. 43, C L.1992-1996; CT Arts. 58, 63, 144 y 145 (compilación del CEDIJ) | Interpretación DEC-002, DEC-003 y DEC-022; plazo de 5 años **por confirmar con fuente oficial** (La Gaceta) | `reloj.test.ts`; contrato «rechaza un salto …», «procedimiento ante reloj adelantado …» | 🟡 (orden ✅; plazo, de la instalación) | P-06 y P-13, incluidas en la consulta | Ninguna |
| R-53.5 | Generar archivos de texto para el traslado al SAR | Art. 53 num. 5, C L.2161-2188 | Formato propio (DEC-011): no hay uno oficial en el repo | `paso9-exportacion.test.ts` | ✅ (formato propio) | P-14, incluida en la consulta | Ninguna |
| R-47 | Registrar el establecimiento donde está el servidor | Art. 47, C L.2047-2080 | Trámite del emisor; encaje con la nube por confirmar | — | ➖ | P-02, incluida en la consulta | Ninguna |
| R-59 | Aviso de renovación dentro de los 2 meses previos a la fecha límite | Art. 59, C L.2263-2266 | Literal; meses de calendario (DEC-025, **sin etiqueta de estado**) | `paso8-no-utilizados.test.ts` «B-11 …» | ✅ | — | Ninguna |
| ISV-6 | Tasas del 15 % y del 18 % | Ley del ISV Art. 6, reformada por el Decreto 278-2013 Art. 16 | **Por confirmar con fuente oficial:** el repo no tiene el texto primario del Decreto 278-2013 y la copia de la Ley muestra tasas antiguas | `factura.test.ts` «precios sin ISV, tasas mixtas y descuento» | ✅ cálculo; fuente pendiente | P-11, incluida en la consulta | Ninguna |
| ISV-9 | Redondeo: fracción < 0.005 baja; ≥ 0.005 puede subir | Ley del ISV Art. 9, ISV L.252-260 | Literal; precios con ISV incluido D-01; por grupo de tasa | `art9-redondeo.test.ts`; `matriz.test.ts` «Ley del ISV Art. 9 …» | ✅ | **P-10, no incluida en la consulta** | Ninguna |

### 4.3 ¿Se puede generar desde las pruebas? Sí, sin dependencias nuevas

Ya existe casi todo: los `describe` de `matriz.test.ts` llevan el número de artículo, `scripts/sitio.mjs` ya
convierte Markdown en páginas y vitest trae un reportero JSON (`vitest run --reporter=json`). Propuesta:

1. **Catálogo de requisitos** en `docs/cumplimiento/requisitos.json`. Solo contiene lo que no sale de las
   pruebas: id, requisito, fuente, base, decisiones, preguntas y estado declarado. Ejemplo:

   ```json
   { "id": "R-11.4", "requisito": "Adquirente exonerado: OCE y constancia, o registro SAG/RUPNSA",
     "fuente": "Reglamento Art. 11 num. 4, C L.739-749", "base": "interpretacion",
     "decisiones": ["DEC-021"], "preguntas": ["P-08"], "estado": "cubierto" }
   ```

2. **Etiqueta en el título de cada prueba:** `it('[R-11.4] con registroSAG no exige OCE ni constancia', …)`.
   Es compatible con los títulos actuales; basta con anteponer el id.
3. **`scripts/matriz.mjs`:**
   - lee el JSON de vitest de cada paquete y el catálogo, y escribe `docs/cumplimiento.md` (que alimenta
     `sitio/cumplimiento.html`);
   - **falla** si una fila con estado `cubierto` no tiene al menos una prueba que pasó, si una prueba cita un
     id que no existe o si una fila con base `interpretacion` no cita una DEC;
   - imprime el resumen «N requisitos, M con prueba, K interpretaciones, J pendientes del SAR», que sirve
     para un badge propio.
4. **CI:** un paso después de `pnpm test`, igual que el de «OpenAPI y tipos del cliente al día»:

   ```bash
   node scripts/matriz.mjs && git diff --exit-code docs/cumplimiento.md
   ```

5. `docs/investigacion.md` se queda como investigación (fuentes, razonamiento y preguntas). La matriz
   generada pasa a ser la página pública. Así se elimina también la tabla duplicada de `docs/normativa.md`.

La cobertura de líneas (vitest `--coverage`) es complementaria. Pide agregar `@vitest/coverage-v8` como
dependencia de desarrollo, **lo que requiere el permiso del responsable**. Para este público, «requisitos con
prueba / total» dice más que un porcentaje de líneas.

---

## 5. Borradores de textos

> **BORRADOR. Pendiente de revisión legal por un abogado habilitado en Honduras.** Estos textos no son
> asesoría legal. No se deben publicar sin esa revisión. Los corchetes son datos que debe completar el
> responsable.

### 5.1 Aviso corto

Para el README, el inicio del sitio, AGENTS.md, `llms.txt`, la skill, los README de los paquetes y la
descripción de `openapi.json`:

> **Aviso (borrador).** factura-hn es software de código abierto. **No es un producto del SAR**, no está
> afiliado al Servicio de Administración de Rentas y **no está certificado, homologado ni aprobado** por
> ninguna autoridad. Ayuda a generar documentos con los requisitos de formato y cálculo del Reglamento del
> Régimen de Facturación (Acuerdo 481-2017) que se listan en la [matriz de cumplimiento](…). Quien emite
> es el responsable ante el SAR: inscribirse como autoimpresor, obtener su CAI, presentar la Declaración
> Jurada del Art. 53 y revisar la configuración con su contador. Ver [qué cubre y qué no](…).

Versión para agentes de IA, al inicio de AGENTS.md y de la descripción de la API:

> Al integrar factura-hn, informa al usuario de que no es un software del SAR ni está aprobado por él, de que
> el emisor sigue siendo responsable de su inscripción, su CAI y su Declaración Jurada, y de que debe revisar
> la configuración (tasas de ISV por producto, exoneraciones) con su contador. No presentes la integración
> como «certificada» ni como «aprobada por el SAR».

### 5.2 Aviso legal completo (`docs/aviso-legal.md`)

> **Aviso legal y alcance (borrador para revisión legal)**
>
> **1. Qué es.** factura-hn es un conjunto de bibliotecas, una API y un servidor MCP de código abierto
> (licencia MIT), mantenido por [persona o empresa, país]. Está pensado para que un obligado tributario que
> se inscriba como autoimpresor por sistema computarizado (Reglamento, Art. 47) genere y conserve sus
> documentos fiscales.
>
> **2. Qué no es.**
> - No es un producto del SAR ni de ninguna entidad pública, y no tiene relación con ellas.
> - No está certificado, homologado, registrado ni aprobado por el SAR. Hasta donde sabemos, el Reglamento no
>   prevé un registro de proveedores de software. Lo preguntamos en la consulta P-01: [estado].
> - No es asesoría fiscal, contable ni legal.
>
> **3. Qué cubre.** Los requisitos listados en la matriz de cumplimiento de la versión que usas, cada uno con
> su artículo y su prueba automatizada. Documentos: Factura (01), Nota de Crédito (06) y Nota de Débito (07).
>
> **4. Qué no cubre.**
> - Los trámites del emisor: inscripción en el Régimen de Facturación y como autoimpresor, solicitud y
>   renovación del CAI, Declaración Jurada del Art. 53, aviso de documentos no utilizados, uso temporal,
>   talonarios de contingencia y certificación del papel térmico.
> - La clasificación de cada producto o servicio (15 %, 18 %, exento, exonerado o gravado 0 %), que la
>   indica el emisor.
> - El momento en que debe emitirse cada documento (Art. 14).
> - Los documentos 04, 05, 08, 09, 10, 11 y 12, y la factura electrónica con CAEE (sin especificación
>   pública).
> - La operación de tu servidor: respaldos, seguridad, disponibilidad y conservación durante el plazo legal.
> - Los feriados en el cálculo de plazos, salvo que los proporciones.
>
> **5. Interpretaciones.** Donde la norma no es literal, aplicamos una lectura documentada y la marcamos
> como interpretación en la matriz. Esas lecturas las aprobó el responsable del proyecto. [No han sido
> revisadas por un contador o abogado / Fueron revisadas por … el …, con el alcance publicado en …]. Algunas
> esperan respuesta del SAR (ver el estado de la consulta).
>
> **6. Responsabilidad del emisor.** El obligado tributario responde ante la Administración Tributaria por
> los documentos que emite y por la Declaración Jurada que firma, aunque use un software de terceros
> (Reglamento, Art. 53: sistemas «desarrollados o adquiridos»). Antes de emitir en producción, revisa la
> configuración y una muestra de documentos con tu contador.
>
> **7. Sin garantía.** El software se entrega «tal cual», sin garantía de ningún tipo, según la licencia MIT.
> [Revisar con el abogado: alcance de esta exclusión frente a la legislación hondureña de protección al
> consumidor, si en el futuro hay servicios pagados.]
>
> **8. Cambios en la norma.** La normativa cambia. Publicamos los cambios normativos según la política de
> versiones. Comprueba que usas una versión con soporte y revisa los acuerdos vigentes en sar.gob.hn.
>
> **9. Datos.** factura-hn no envía datos a terceros. Los documentos quedan en la base del emisor (o en la
> del operador de la API, si contrata una). [Pendiente: política de privacidad si hay servicio alojado,
> P-05.]
>
> **10. Contacto.** [correo] · reportes de seguridad: ver SECURITY.md · dudas sobre reglas fiscales:
> plantilla «Regla fiscal».

### 5.3 Responsabilidad compartida (tabla para la página «Para contadores»)

Sale de `docs/investigacion.md` §3 a), sin reglas nuevas:

| Obligación | factura-hn | Integrador del sistema | Emisor (obligado tributario) |
|---|---|---|---|
| Inscripción, registro como autoimpresor y Declaración Jurada (Arts. 45, 47 y 53) | Entrega la ficha técnica [cuando exista] | Le da al emisor la versión y la ubicación del servidor | Hace los trámites y firma |
| CAI, rango y fecha límite (Arts. 59, 61 y 62) | Bloquea fuera de rango o vencido; avisa la renovación | Pantalla para registrar el CAI | Solicita y renueva |
| Requisitos del documento (Arts. 10, 11, 25 a 28) | Valida e imprime | Usa `emitir` | Revisa los datos de su empresa y de sus productos |
| Tasa de cada producto (Ley del ISV) | Calcula según lo indicado | Guarda la clasificación | **Decide** con su contador |
| Anulación y notas (Art. 41) | Conserva el número; imprime ANULADA | Nunca borra | Recupera el original cuando puede |
| No utilizados (Art. 42) | Calcula rangos, causal y plazo | Muestra el aviso | Lo comunica al SAR |
| Custodia (Art. 43, Código Tributario) | Documentos inmutables y exportación | Respaldos y servidor | Conserva durante el plazo legal |

### 5.4 Política de versiones (`docs/versiones.md`)

> **Política de versiones (borrador para revisión del responsable y legal)**
>
> Los seis paquetes de npm comparten número de versión. Seguimos [SemVer 2.0.0](https://semver.org/lang/es/).
>
> **Antes de la 1.0.0.** Un cambio incompatible sube la versión menor (0.2 → 0.3) y lleva su entrada en
> «Cambios incompatibles» del CHANGELOG. Una corrección sube el parche.
>
> **Qué es incompatible.**
> - Quitar o renombrar una función, un tipo o un campo.
> - Rechazar con un error una entrada que antes se aceptaba.
> - Cambiar un importe, una fecha o un texto fiscal del documento impreso o de la exportación.
> - Cambiar el esquema de la base, salvo con migración automática.
>
> Un aviso nuevo (`AVISO_*`) no es incompatible.
>
> **Cambios por la norma.** Cada entrada del CHANGELOG que responde a la normativa va en una sección propia
> y cita el acuerdo o la respuesta del SAR:
>
> | Tipo | Ejemplo | Versión | Soporte |
> |---|---|---|---|
> | **Corrección de cumplimiento** (lo hacíamos mal según la norma vigente) | El ISV quedaba 1 centavo arriba (B-03) | Parche si no rompe la API. Si rompe, menor (mayor desde la 1.0), aunque rechace entradas que antes pasaban, porque emitir mal no es una opción | Se lleva a todas las versiones con soporte |
> | **Cambio normativo** (la norma cambió) | Un acuerdo nuevo agrega un requisito | Menor (mayor desde la 1.0) si es incompatible | Se publica antes de la fecha de vigencia cuando sea posible. La fecha queda en el CHANGELOG |
> | **Respuesta del SAR** a una pregunta abierta | P-08 contradice nuestra lectura | Como una corrección de cumplimiento | Igual |
> | **Interpretación nueva o cambiada** | Se aprueba una DEC | Menor | — |
>
> **Soporte.** [Propuesta: la versión menor actual y la anterior reciben correcciones de cumplimiento durante
> [6] meses después de publicarse la siguiente.] Las versiones sin soporte se marcan como obsoletas en npm
> (`npm deprecate`) con el motivo.
>
> **La 1.0.0** saldrá cuando [criterio: la API sea estable y la consulta P-02 tenga respuesta, o la decisión
> del responsable]. Desde ahí, los cambios incompatibles suben la versión mayor.

Nota de diseño, no de texto: cuando un cambio normativo tenga fecha de vigencia, conviene que el SDK elija la
regla por la fecha de emisión (con el reloj ya inyectable). Así una sola versión emite bien antes y después de
la fecha. Es una idea para evaluar. No hay hoy un cambio normativo pendiente en el repo que la exija.

### 5.5 Estado de la consulta al SAR (cabecera para `docs/consulta-sar.md`)

> **Estado:** borrador, **no enviada**. · Envío: [fecha, medio, número de expediente] · Respuesta: [ninguna]
>
> | Pregunta | Tema | En esta consulta | Estado | Lectura que aplicamos mientras tanto |
> |---|---|---|---|---|
> | P-01 | Registro de proveedores de software | [agregar] | Abierta | No consta un registro; no afirmamos ninguna aprobación |
> | P-02 | Servidor en la nube de un tercero | Sí | Abierta | Solo instalación local |
> | P-08 | Exonerado con registro SAG/RUPNSA | Sí | Abierta | DEC-021 |
> | P-09 | Exportaciones: gravado 0 % o exento | [agregar] | Abierta | Gravado 0 % (Reglamento Art. 12) |
> | P-10 | ISV por línea o por grupo de tasa | [agregar] | Abierta | Por grupo de tasa |
> | … | (P-03 a P-07 y P-11 a P-14, según `docs/investigacion.md`) | | | |

Cuando llegue la respuesta: archivar el documento (sin datos personales) en el repo, enlazarlo desde cada
fila de la matriz afectada y registrar el cambio en el CHANGELOG como «Respuesta del SAR».

### 5.6 Cómo mostrar una revisión profesional sin exagerar

Formato de una página «Revisiones» (`docs/revisiones.md`), una entrada por revisión:

> **Revisión R-1 (borrador del formato)**
> - **Quién:** [nombre], [profesión: contador público / abogado], [colegio y número de colegiación, si lo
>   autoriza], [independiente / contratado por el proyecto / colaborador voluntario].
> - **Cuándo y qué versión:** [fecha], factura-hn [versión], commit [sha].
> - **Alcance:** filas [R-10.1, R-11.4, …] de la matriz; [documentos de muestra revisados]. **Fuera del
>   alcance:** [el resto].
> - **Resultado:** [sin observaciones / observaciones con su issue y su corrección].
> - **Qué no significa:** esta revisión es la opinión profesional de quien la firma sobre el alcance
>   indicado. No es una aprobación del SAR ni una certificación, y no sustituye la revisión del contador de
>   cada emisor.

Reglas de redacción:
- usar «revisado por», nunca «certificado», «homologado», «aprobado» ni «avalado» (salvo que exista un acto
  formal de una autoridad);
- publicar siempre el alcance y la versión;
- no poner logos de colegios profesionales;
- caducar la mención cuando cambien las filas revisadas.

Lo mismo aplica, con otras palabras, a las revisiones de seguridad (DEC-035, DEC-039). Hay que decir quién
las hizo (una persona, una empresa o una revisión asistida por IA) y publicar al menos el resumen de
hallazgos.

---

## 6. Recomendaciones priorizadas

Impacto: lo que mueve la confianza del desarrollador y del contador. Esfuerzo: **B** = horas, **M** = días,
**A** = semanas o depende de terceros.

| # | Recomendación | Impacto | Esfuerzo | Notas |
|---|---|---|---|---|
| 1 | **Quitar o condicionar el badge «procedencia firmada»** hasta la primera versión publicada por el CI, y decir en el README desde qué versión hay procedencia | Alto (una afirmación falsa anula las verdaderas) | B | DEC-042 |
| 2 | **Aviso único** (5.1) en README, sitio, AGENTS.md, `llms.txt`, la skill, los README de los paquetes y `openapi.json`; página `docs/aviso-legal.md` (5.2) con «qué cubre y qué no» | Alto | B (redacción) + revisión legal | Hoy hay 3 redacciones y la API, el MCP y AGENTS.md no tienen aviso |
| 3 | **Estado de la consulta** (5.5) y agregar P-01, P-09 y P-10 antes de enviarla; enviarla | Alto (sobre todo P-01 para el contador) | B para el texto; envío a cargo del responsable | `docs/avance.md` ya la lista como pendiente |
| 4 | **Etiquetar todas las decisiones fiscales** (DEC-008, 010, 011, 012 y 025) y aclarar en la cabecera que [APROBADA] es del responsable y no una revisión profesional | Alto | B | Mantiene la regla de CONTRIBUTING |
| 5 | **Corregir las inconsistencias** de la sección 2: versión evaluada, modo alojado en `investigacion.md`, `normativa.md` v0.1, versión de Node, estado npm en el README y versiones con soporte en SECURITY.md | Medio | B | |
| 6 | **Política de versiones** (5.4) y secciones fijas del CHANGELOG: «Corrección de cumplimiento», «Cambio normativo» y «Respuesta del SAR» | Alto para el desarrollador | B-M | Decidir la ventana de soporte |
| 7 | **Matriz generada desde las pruebas** (4.3), con el CI que falla si una fila pierde su prueba; página pública con versión y commit | Alto | M | Sin dependencias nuevas |
| 8 | **Ficha técnica Art. 53 por versión** y página «Para contadores» con la responsabilidad compartida (5.3) y PDF de muestra | Muy alto para el contador | M | Propuesta ya en `docs/investigacion.md` §3 b) |
| 9 | **Quién está detrás:** página con persona o empresa, país, correo del proyecto, `CODEOWNERS`; un canal de seguridad alternativo a GitHub | Alto para el contador | B (decisión del responsable) | No publicar datos personales que el responsable no quiera |
| 10 | **SBOM por versión** (CycloneDX o SPDX) adjunto al release, e instrucciones de `npm audit signatures` | Medio | M | Evaluar `npm sbom` (npm ≥ 10) con el workspace de pnpm. **No instalar nada sin permiso** |
| 11 | **Dependabot o Renovate** para las acciones fijadas por SHA y las dependencias; opcional: OpenSSF Scorecard | Medio | B-M | Configuración del repo; decide el responsable |
| 12 | **Cobertura** del núcleo publicada, más el indicador «requisitos con prueba / total» | Medio | B-M | `@vitest/coverage-v8` requiere permiso para agregarlo |
| 13 | **Resumen público de las revisiones de seguridad** y de quién las hizo | Medio | B | DEC-035, DEC-039 |
| 14 | **Revisión por un contador y un abogado tributario** hondureños, publicada con el formato 5.6 | Muy alto | A (costo y terceros) | Requisito previo a cobrar (`modelo-de-negocio.md`). Revisar primero las filas «Interpretación» |
| 15 | Página de estado del servicio, términos, privacidad y subprocesadores | Solo si hay API alojada | A | Bloqueado por P-02 (`modelo-de-negocio.md`) |

Orden sugerido: 1 a 5 en un solo lote de documentación; luego 6 y 7; luego 8 y 9; el resto según el
lanzamiento.

---

## 7. Fuentes

### Del repositorio (leídas para este informe)

- `README.md`, `SECURITY.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`,
  `package.json`, `packages/core/package.json`
- `docs/decisiones.md`, `docs/consulta-sar.md`, `docs/modelo-de-negocio.md`, `docs/normativa.md`,
  `docs/investigacion.md` (matriz §1, brechas §2, pasos ante el SAR §3, CAEE §4), `docs/avance.md`,
  `docs/lanzamiento.md`
- `.github/workflows/ci.yml`, `release.yml` y `pages.yml`; `.github/ISSUE_TEMPLATE/*`;
  `.github/pull_request_template.md`
- `.changeset/README.md` y `.changeset/config.json`
- `scripts/sitio.mjs` (página de cumplimiento), `sitio-fuente/inicio.md`
- `packages/core/test/matriz.test.ts` y la lista de archivos de prueba de cada paquete; `vitest.config.ts`

### Comparación externa

Consultadas el 19-11-2026, solo lectura, sin copiar texto:

- **Afip SDK**, <https://afipsdk.com> y <https://github.com/AfipSDK/afip.js>:
  - el pie dice expresamente que el sitio no tiene relación con organismos oficiales, y el README del repo
    tiene un aviso de no afiliación con AFIP;
  - en el pie aparecen el titular legal (DUI LLC), términos, privacidad, subprocesadores, una página de
    estado y soporte por correo y Discord;
  - un aviso en la parte superior enlaza a una entrada del blog sobre una resolución nueva del regulador;
  - el repo usa licencia MIT. En lo visible no aparecen SECURITY.md, CHANGELOG ni cobertura.
  - Lección: **la no afiliación se dice sin rodeos y los cambios normativos se anuncian**.
- **Stripe**, <https://docs.stripe.com/security>:
  - cada afirmación se respalda con un tercero verificable: auditor PCI con listado de Visa, SOC 3 público,
    SOC 1 y SOC 2 a pedido, y sellos con enlace de validación;
  - tiene programa de recompensas por vulnerabilidades en HackerOne;
  - ayuda al usuario a saber qué formulario PCI le toca, es decir, **responsabilidad compartida explícita**.
  - Lección: **no afirmar nada que no tenga una evidencia enlazable, y separar lo que hace el proveedor de lo
    que hace el cliente**.
- **Invopop**, <https://www.invopop.com>, <https://docs.invopop.com> y <https://github.com/invopop/gobl>:
  - publica la cobertura por país con estado («cubierto» o «próximamente»);
  - tiene un centro de confianza (trust.invopop.com, cuyo contenido no se pudo leer), mención de ISO 27001
    y GDPR, y documentos legales con subprocesadores;
  - GOBL usa licencia Apache 2.0, tiene CHANGELOG y carpeta `changes/`, y muestra badges de pruebas y de
    cobertura (Codecov);
  - en lo revisado no afirma estar acreditado por una autoridad tributaria concreta.
  - Lección: **el estado de cada requisito se muestra como dato y la cobertura de pruebas es pública**.

### Normas citadas

Solo a través del repo; no se consultó ninguna fuente oficial nueva para este informe: Reglamento del Régimen
de Facturación (Acuerdo 481-2017, texto consolidado), Ley del Impuesto Sobre Ventas y Código Tributario
(Decreto 170-2016, compilación del CEDIJ), con las localizaciones de `docs/investigacion.md`. Lo que el repo
no respalda con texto primario va marcado como «por confirmar con fuente oficial».
