# Consulta al Servicio de Administración de Rentas (SAR)

**Asunto:** Consultas sobre el Reglamento del Régimen de Facturación (Acuerdo 481-2017 y reformas) aplicadas a
un software de facturación para autoimpresores por sistema computarizado.

**Fecha:** 18 de noviembre de 2026

Estimados señores:

Desarrollamos factura-hn, un software de facturación de código abierto para obligados tributarios que se
inscriban como autoimpresores por sistema computarizado (Art. 47). Hoy se ofrece como biblioteca y servidor que
el negocio instala en sus propios equipos. También podríamos ofrecerlo como servicio en la nube, pero no lo
haremos sin su respuesta a la consulta 1. Para cumplir el Reglamento sin
interpretarlo por nuestra cuenta, les agradeceremos que respondan las consultas siguientes. En cada una
indicamos la lectura que aplicamos mientras tanto.

Las citas «C L.n» remiten a la línea del texto consolidado del Acuerdo 481-2017 con el que trabajamos; con gusto
lo facilitamos.

---

## 1. Sistema alojado en la nube por un tercero (P-02)

**Contexto.** El Art. 47 pide registrar el sistema, el software y «el establecimiento donde se encuentre el
servidor». En un servicio en la nube, el servidor lo opera un tercero, fuera del establecimiento del negocio, y
atiende a varios negocios.

**Pregunta.**
- ¿Qué establecimiento declara el obligado tributario cuando el servidor está en la nube de un tercero?
- ¿Se considera un «sistema en red» (Art. 4 num. 42)?
- Para el Art. 61, ¿el servicio cuenta como un «Sistema» distinto por cada negocio que lo usa?

**Artículos.** Arts. 4 num. 41-42, 47 (C L.2047-2080) y 61 (C L.2279-2295); Código Tributario, Art. 63
num. 3.

**Lectura provisional.** Recomendamos instalar el sistema en el establecimiento del negocio, con su propio
servidor y su propia base de datos. No ofrecemos el servicio en la nube hasta recibir esta respuesta.

## 2. Plazo de conservación de los documentos (P-06)

**Contexto.** El Art. 43 remite al Código Tributario para el plazo de custodia. Aplicamos 5 años, según los
Arts. 58 num. 4, 63 num. 3, 144 y 145 del Código Tributario, en la compilación de 2024.

**Pregunta.** ¿Sigue vigente ese plazo de 5 años para conservar los documentos fiscales, o hubo reformas
posteriores que lo cambien?

**Artículos.** Reglamento Art. 43 (C L.1992-1996); Código Tributario Arts. 58, 63, 144 y 145.

**Lectura provisional.** Conservamos los documentos al menos 5 años desde la declaración del período. No se
borran: los documentos fiscales del sistema son inmutables.

## 3. Adquirente exonerado del sector agroindustrial (P-08)

**Contexto.** El Art. 11 num. 4 pide consignar la Orden de Compra Exenta y la Constancia del Registro de
Exonerados «… o, el Número identificativo del Registro Único de Productores…», según corresponda.

**Pregunta.** Cuando el adquirente presenta su registro en el RUPNSA/SAG, ¿basta ese número sin la Orden de
Compra Exenta ni la Constancia del Registro de Exonerados?

**Artículos.** Arts. 10 num. 8 y 11 num. 4 (C L.635-640, L.739-749).

**Lectura provisional.** Con el registro SAG/RUPNSA no exigimos los otros dos documentos. Sin él, exigimos la
Orden de Compra Exenta **y** la Constancia.

## 4. Tasa del 18 % del ISV (P-11)

**Contexto.** No contamos con el texto oficial del Decreto 278-2013, Art. 16, que fija la tasa del 18 %. La
copia de la Ley del ISV que tenemos aún muestra las tasas anteriores.

**Pregunta.** ¿Pueden indicarnos el texto vigente y la lista oficial de bienes y servicios gravados al 18 %?
En particular, ¿sigue incluyendo los boletos aéreos en primera clase o clase ejecutiva?

**Artículos.** Ley del Impuesto Sobre Ventas Art. 6, reformado por el Decreto 278-2013 Art. 16.

**Lectura provisional.** El software no decide qué producto va al 18 %. Lo indica el negocio en cada producto.

## 5. Fecha mínima para la primera emisión de una serie (P-13)

**Contexto.** El sistema impide emitir con una fecha anterior a la del último documento válido de la serie
(orden cronológico, Art. 43). En la primera emisión de una serie no hay documento previo con el cual
comparar.

**Pregunta.** ¿Puede emitirse un documento con fecha anterior a la de la resolución que otorga el CAI? Si la
respuesta es no, ¿esa fecha de resolución es el límite inferior válido?

**Artículos.** Arts. 14, 43 (C L.1992-1996) y 62 (C L.2297-2303).

**Lectura provisional.** La fecha de emisión es siempre la del día, en hora de Honduras. Si se registra la
fecha de la resolución, solo la usamos para avisar si la vigencia supera un año (Art. 62).

## 6. Formato del archivo de texto para el SAR (P-14)

**Contexto.** El Art. 53 num. 5 exige que el sistema genere «archivos tipo texto para su almacenamiento y
traslado hacia la Administración Tributaria». No encontramos un formato publicado para autoimpresores.

**Pregunta.** ¿El SAR publicó un formato (estructura de campos, separador, codificación) o un servicio web
para ese traslado? Si existe, ¿dónde podemos consultarlo?

**Artículos.** Art. 53 num. 5 (C L.2161-2188).

**Lectura provisional.** El sistema exporta tres formatos abiertos y documentados: JSON por línea, CSV y texto
con separador «|». Cuando el SAR publique un formato oficial, lo agregaremos.

---

Quedamos atentos a su respuesta.

Atentamente,

_______________________
[Nombre y RTN del solicitante]
[Correo y teléfono de contacto]
