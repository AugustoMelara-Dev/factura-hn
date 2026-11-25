# Consulta al Servicio de Administración de Rentas (SAR)

> **Estado: redactada, aún no enviada** (al 19-11-2026). Ninguna de estas preguntas tiene respuesta del SAR.
> Mientras tanto, factura-hn aplica la lectura provisional que se indica en cada una. Cuando se envíe, aquí se
> anotará la fecha y el número de trámite, y luego cada respuesta.

---

**Asunto:** Consultas sobre el Reglamento del Régimen de Facturación (Acuerdo 481-2017 y reformas) aplicadas a
un software de facturación para autoimpresores por sistema computarizado.

**Fecha:** [fecha de envío]

Estimados señores:

Desarrollamos factura-hn, un software de facturación de código abierto para obligados tributarios que se
inscriban como autoimpresores por sistema computarizado (Art. 47). Es un proyecto independiente, no afiliado al
SAR. Hoy se ofrece como biblioteca y servidor que el negocio instala en sus propios equipos. También podríamos
ofrecerlo como servicio en la nube, pero no lo haremos sin su respuesta a la consulta P-02.

Para cumplir el Reglamento sin interpretarlo por nuestra cuenta, les agradeceremos que respondan las 20
consultas siguientes. En cada una indicamos la lectura que aplicamos mientras tanto.

Las citas «C L.n» remiten a la línea del texto consolidado del Acuerdo 481-2017 con el que trabajamos; con gusto
lo facilitamos.

---

## P-01. Registro de proveedores de sistemas de facturación

**Contexto.** El Reglamento regula el Registro Fiscal de Imprentas (Arts. 66-70, C L.2383-2545), que aplica a
quien imprime formatos preimpresos. No encontramos un registro, homologación ni certificación de proveedores o
desarrolladores de software de facturación. El Art. 53 permite usar sistemas «desarrollados o adquiridos»
(C L.2164), y la Declaración Jurada la firma el obligado tributario (C L.2184-2188).

**Pregunta.**
- ¿Existe un registro, homologación o certificación de proveedores o desarrolladores de sistemas de
  facturación?
- ¿Debe registrarse el software, su versión o su proveedor?

**Artículos.** Arts. 47, 53 (C L.2047-2080, L.2161-2188) y 66-70 (C L.2383-2545).

**Lectura provisional.** No realizamos ningún trámite como proveedor. Entregamos al negocio la información que
necesita para su Declaración Jurada: cómo cumple el sistema cada numeral del Art. 53, la versión del software y
dónde está el servidor.

## P-02. Sistema alojado en la nube por un tercero

**Contexto.** El Art. 47 pide registrar el sistema, el software y «el establecimiento donde se encuentre el
servidor». En un servicio en la nube, el servidor lo opera un tercero, fuera del establecimiento del negocio, y
atiende a varios negocios.

**Pregunta.**
- ¿Qué establecimiento declara el obligado tributario cuando el servidor está en la nube de un tercero?
- ¿Se considera un «sistema en red» (Art. 4 num. 42)?
- Para el Art. 61, ¿el servicio cuenta como un «Sistema» distinto por cada negocio que lo usa?
- ¿Y si el sistema es del propio negocio, usado solo por él, pero está instalado en un servidor que el negocio
  contrata en la nube de un tercero? ¿Cuenta como instalado en su establecimiento o domicilio fiscal?

**Artículos.** Arts. 4 num. 41-42 (C L.436-445), 47 (C L.2047-2080) y 61 (C L.2279-2295); Código Tributario,
Art. 63 num. 3.

**Lectura provisional.** Recomendamos instalar el sistema en el establecimiento del negocio, con su propio
servidor y su propia base de datos. No ofrecemos el servicio en la nube hasta recibir esta respuesta.

## P-03. Inscripción como autoimpresor y Declaración Jurada del Art. 53

**Contexto.** Los Arts. 45, 47 y 53 describen la inscripción en el Régimen de Facturación, la inscripción como
autoimpresor por sistema computarizado y la Declaración Jurada de que el sistema cumple el Art. 53. No
encontramos publicados el formulario, el medio ni los anexos técnicos.

**Pregunta.**
- ¿Cuál es el procedimiento vigente para inscribirse como autoimpresor por sistema computarizado?
- ¿Qué formulario, medio (por ejemplo, la Oficina Virtual) y anexos técnicos lleva la Declaración Jurada del
  Art. 53?

**Artículos.** Arts. 45 (C L.2018-2031), 47 (C L.2047-2080) y 53 (C L.2161-2188).

**Lectura provisional.** Remitimos al negocio a los artículos citados y le recomendamos hacer el trámite con su
contador. No describimos un procedimiento que no hemos podido verificar.

## P-04. Formato de los archivos de texto y de la comunicación de no utilizados

**Contexto.** El Art. 53 num. 5 exige generar archivos de texto para su almacenamiento y traslado. El Art. 42
exige comunicar los documentos no utilizados dentro de los 10 días hábiles del mes siguiente. No encontramos
una estructura publicada para ninguno de los dos.

**Pregunta.** ¿Hay una estructura publicada para los archivos del Art. 53 num. 5 y para la comunicación de
documentos no utilizados del Art. 42? Si existe, ¿dónde podemos consultarla?

**Artículos.** Arts. 42 (C L.1958-1990) y 53 num. 5 (C L.2161-2188).

**Lectura provisional.** El sistema exporta formatos abiertos y documentados (JSON por línea, CSV y texto con
separador «|») y calcula los rangos no utilizados con su causal y fecha límite, para que el negocio los
comunique.

## P-05. Datos personales del adquirente guardados por un tercero

**Contexto.** Las facturas llevan datos del adquirente, como el nombre y el RTN o el DNI. El Reglamento obliga
a custodiar los documentos al obligado tributario (Arts. 41 y 43), pero no se refiere a un tercero que los
guarde por cuenta del negocio.

**Pregunta.** Cuando un proveedor del software guarda por contrato los documentos y los datos personales del
adquirente, ¿qué normativa de protección de datos aplica en Honduras y qué obligaciones tiene ese proveedor?

**Artículos.** Arts. 41 (C L.1952-1955) y 43 (C L.1992-1996).

**Lectura provisional.** En el modo recomendado (P-02) los datos quedan en el equipo del negocio, y el proveedor
del software no los guarda.

## P-06. Plazo de conservación de los documentos

**Contexto.** El Art. 43 remite al Código Tributario para el plazo de custodia. Aplicamos 5 años, según los
Arts. 58 num. 4, 63 num. 3, 144 y 145 del Código Tributario, en la compilación de 2024.

**Pregunta.** ¿Sigue vigente ese plazo de 5 años para conservar los documentos fiscales, o hubo reformas
posteriores que lo cambien?

**Artículos.** Reglamento Art. 43 (C L.1992-1996); Código Tributario Arts. 58, 63, 144 y 145.

**Lectura provisional.** Conservamos los documentos al menos 5 años desde la declaración del período. No se
borran: los documentos fiscales del sistema son inmutables.

## P-07. Papel térmico: certificación y resúmenes de ventas

**Contexto.** El Art. 38 pide, para imprimir en papel térmico, la certificación del proveedor del papel de que
la impresión se conserva al menos 5 años, y menciona resúmenes de ventas.

**Pregunta.**
- ¿La certificación del Art. 38 la gestiona y presenta el negocio?
- ¿Qué son los «resúmenes de ventas» y en qué formato y plazo se entregan?

**Artículos.** Art. 38 (C L.1879-1911).

**Lectura provisional.** Avisamos en la documentación que, antes de imprimir tickets en papel térmico, el
negocio debe presentar la certificación del proveedor. El software no gestiona ese trámite.

## P-08. Adquirente exonerado del sector agroindustrial

**Contexto.** El Art. 11 num. 4 pide consignar la Orden de Compra Exenta y la Constancia del Registro de
Exonerados «… o, el Número identificativo del Registro Único de Productores…», según corresponda.

**Pregunta.** Cuando el adquirente presenta su registro en el RUPNSA/SAG, ¿basta ese número sin la Orden de
Compra Exenta ni la Constancia del Registro de Exonerados?

**Artículos.** Arts. 10 num. 8 y 11 num. 4 (C L.635-640, L.739-749).

**Lectura provisional.** Con el registro SAG/RUPNSA no exigimos los otros dos documentos. Sin él, exigimos la
Orden de Compra Exenta **y** la Constancia.

## P-09. Exportaciones: «gravado 0 %» o «exento»

**Contexto.** El Art. 12 del Reglamento pide facturar las exportaciones de mercancías gravadas con tasa cero
(C L.752-754). La Ley del ISV dice que los bienes y servicios que se exporten quedan exentos.

**Pregunta.** En la factura de exportación, ¿el importe se presenta como «gravado 0 %» (Reglamento, Art. 12) o
como «exento» (Ley del ISV, Art. 6)?

**Artículos.** Reglamento Arts. 11 num. 1 g y 12 (C L.675-676, L.752-754); Ley del Impuesto Sobre Ventas,
Art. 6.

**Lectura provisional.** Seguimos el Reglamento: la exportación se presenta como «gravado 0 %», en una columna
separada de lo exento y lo exonerado.

## P-10. Redondeo del ISV: por línea o por tasa

**Contexto.** El Art. 9 de la Ley del ISV fija el redondeo del impuesto «sobre el precio del artículo vendido»,
lo que puede leerse por artículo. El Art. 11 del Reglamento pide subtotales por tarifa. Además, cuando el
precio incluye el ISV, hay totales para los que no existe una base exacta.

**Pregunta.**
- ¿El redondeo del Art. 9 se aplica a cada línea o al subtotal de cada tasa?
- Cuando el precio incluye el ISV y no hay una base que dé exactamente ese total, ¿cuál es el tratamiento
  correcto?

**Artículos.** Ley del Impuesto Sobre Ventas, Art. 9; Reglamento Art. 11 num. 1 h-i (C L.678-680).

**Lectura provisional.** Calculamos el ISV por grupo de tasa, con el redondeo del Art. 9 sobre la base impresa.
Si el precio incluye el ISV y no existe una base exacta, tomamos la mayor base cuyo total no supera el precio:
el cliente paga 1 centavo menos, nunca más, y el documento lo indica.

## P-11. Tasa del 18 % del ISV

**Contexto.** No contamos con el texto oficial del Decreto 278-2013, Art. 16, que fija la tasa del 18 %. La
copia de la Ley del ISV que tenemos aún muestra las tasas anteriores.

**Pregunta.** ¿Pueden indicarnos el texto vigente y la lista oficial de bienes y servicios gravados al 18 %?
En particular, ¿sigue incluyendo los boletos aéreos en primera clase o clase ejecutiva?

**Artículos.** Ley del Impuesto Sobre Ventas Art. 6, reformado por el Decreto 278-2013 Art. 16.

**Lectura provisional.** El software no decide qué producto va al 18 %. Lo indica el negocio en cada producto.

## P-12. Calendario y especificación de la factura electrónica

**Contexto.** El Reglamento define el Código de Autorización de Emisión Electrónica (CAEE, Art. 4 num. 9 y
Art. 54) y prevé su incorporación según un calendario (Art. 57) y una documentación técnica (Art. 58). No
encontramos ninguno de los dos publicado.

**Pregunta.** ¿Hay un calendario para la emisión electrónica y una especificación técnica (esquemas, protocolo,
firma) publicada o prevista? Si existe, ¿dónde podemos consultarla?

**Artículos.** Arts. 4 num. 9 (C L.244-246), 54 (C L.2192-2196), 57 (C L.2219-2225) y 58 (C L.2229-2234).

**Lectura provisional.** Implementamos el régimen vigente de CAI, rango y fecha límite. Agregaremos la emisión
electrónica cuando se publique su documentación técnica.

## P-13. Fecha mínima para la primera emisión de una serie

**Contexto.** El sistema impide emitir con una fecha anterior a la del último documento válido de la serie
(orden cronológico, Art. 43). En la primera emisión de una serie no hay documento previo con el cual
comparar.

**Pregunta.** ¿Puede emitirse un documento con fecha anterior a la de la resolución que otorga el CAI? Si la
respuesta es no, ¿esa fecha de resolución es el límite inferior válido?

**Artículos.** Arts. 14, 43 (C L.1992-1996) y 62 (C L.2297-2303).

**Lectura provisional.** La fecha de emisión es siempre la del día, en hora de Honduras. Si se registra la
fecha de la resolución, solo la usamos para avisar si la vigencia supera un año (Art. 62).

## P-14. Formato del archivo de texto para el SAR

**Contexto.** El Art. 53 num. 5 exige que el sistema genere «archivos tipo texto para su almacenamiento y
traslado hacia la Administración Tributaria». No encontramos un formato publicado para autoimpresores.

**Pregunta.** ¿El SAR publicó un formato (estructura de campos, separador, codificación) o un servicio web
para ese traslado? Si existe, ¿dónde podemos consultarlo?

**Artículos.** Art. 53 num. 5 (C L.2161-2188).

**Lectura provisional.** El sistema exporta tres formatos abiertos y documentados: JSON por línea, CSV y texto
con separador «|». Cuando el SAR publique un formato oficial, lo agregaremos.

## P-15. CAI solicitado para otro sistema o para talonarios

**Contexto.** Un negocio que ya tiene un CAI vigente (solicitado para otro sistema o para talonarios de una
imprenta) puede pasar a emitir con este sistema. El sistema permite registrar ese CAI e indicar el último número
usado fuera de él, para que la serie continúe sin repetir números.

**Pregunta.** ¿Un CAI otorgado para otro sistema o para documentos de imprenta puede seguir usándose al cambiar de
sistema, o el cambio exige solicitar una autorización nueva para el sistema nuevo?

**Artículos.** Art. 61 (C L.2279-2295).

**Lectura provisional.** El sistema no lo impide, y la documentación pide confirmarlo con el contador o con el SAR
antes de registrar un CAI que no se solicitó para este sistema.

## P-16. Tope de la nota de crédito y su tasa

**Contexto.** El Art. 4 num. 32 define la Nota de Crédito como el documento que respalda un ajuste, devolución o
descuento sobre el «correspondiente» comprobante (C L.381-385). No encontramos un artículo que fije un tope
numérico para las notas de crédito sobre un mismo comprobante, ni que diga si deben usar la misma tasa de ISV que
el comprobante ni el mismo tratamiento (exonerado o no).

**Pregunta.**
- ¿La suma de las notas de crédito sobre un comprobante puede superar su total?
- ¿Puede superar, a una tasa (15 % o 18 %), el importe gravado o el ISV que el comprobante tuvo a esa tasa? Por
  ejemplo, sobre una factura de L 100.00 exento y L 100.00 gravado al 15 %, ¿se puede emitir una nota de crédito
  de L 180.00 gravado al 15 % (L 207.00 con ISV), que cabe en el total de L 215.00?
- ¿Puede una nota de crédito llevar ISV a una tasa que el comprobante no tenía, o ISV sobre un comprobante
  exonerado? ¿Debe la nota sobre un comprobante exonerado ser también exonerada?
- Si el comprobante está en moneda extranjera, ¿el tope se compara en lempiras? ¿Con qué conversión?
- ¿Las notas de débito sobre el comprobante amplían ese tope?

**Artículos.** Arts. 4 num. 32 (C L.381-385), 11 num. 4 (C L.739-749), 26 y 28 num. 8.

**Lectura provisional.** Con el comprobante en el sistema, una nota de crédito se rechaza si, sumada a las notas
de crédito vigentes sobre él, supera su total o, a una tasa, su importe gravado o su ISV; también si lleva ISV a una
tasa que el comprobante no tenía o sobre un comprobante exonerado. Si el comprobante es exonerado y la nota no (o
al revés), la nota se emite con un aviso. En moneda extranjera, las líneas del comprobante se convierten a lempiras
como las de la nota: precio por el tipo de cambio del comprobante y el redondeo del Art. 9 de la Ley del ISV. Las
notas de débito no amplían el tope.

## P-17. Libro de ventas en lempiras

**Contexto.** El sistema ofrece un libro de ventas como apoyo para la declaración del ISV, que se declara y se paga
en lempiras. No encontramos una norma que fije el formato del libro ni cómo convertir los documentos emitidos en
moneda extranjera. El Art. 11 (párrafo final, C L.726-727) pide la tasa de cambio vigente a la fecha cuando la
moneda es extranjera.

**Pregunta.**
- ¿Hay un formato establecido para el libro o registro de ventas de un autoimpresor?
- Para un documento en moneda extranjera, ¿cada importe se convierte con el tipo de cambio impreso en el
  documento? ¿Se convierte cada importe (base, ISV, total) por separado, o la base y se recalcula el ISV en
  lempiras?

**Artículos.** Art. 11, párrafo final (C L.726-727); Art. 53 num. 5 (C L.2161-2188); Ley del Impuesto Sobre
Ventas, Art. 9.

**Lectura provisional.** El libro va en lempiras. Cada importe de un documento en moneda extranjera se convierte
por separado con el tipo de cambio impreso en el documento y se redondea al centavo con la regla del Art. 9 de la
Ley del ISV. Por eso la suma de las partes puede diferir del total en un centavo. El libro muestra además la
moneda, el tipo de cambio y el total en la moneda original.

## P-18. Equivalente en lempiras en documentos en moneda extranjera

**Contexto.** El Art. 11 pide la tasa de cambio vigente a la fecha cuando la moneda es extranjera (párrafo final,
C L.726-727), y el Art. 11 num. 1 j habla de «Lempira o símbolo L». No encontramos un texto que exija imprimir el
equivalente en lempiras de los importes.

**Pregunta.**
- En un comprobante en moneda extranjera, ¿debe imprimirse el equivalente en lempiras del ISV y del total?
- Si se imprime, ¿con qué redondeo?

**Artículos.** Art. 11 num. 1 j y párrafo final (C L.726-727); Ley del Impuesto Sobre Ventas, Art. 9.

**Lectura provisional.** El comprobante lleva sus importes en su moneda e imprime, bajo el tipo de cambio, el
equivalente en lempiras del ISV y del total: el importe por el tipo de cambio, redondeado al centavo con la regla
del Art. 9 de la Ley del ISV. Se calcula al emitir y se guarda, así la reimpresión no cambia.

## P-19. Nota con un RTN que el original no tiene

**Contexto.** Los Arts. 26 y 28 piden en las notas de crédito y débito el nombre y el RTN del adquirente. Una
factura a CONSUMIDOR FINAL se emite sin RTN. Si después ese cliente pide una nota (por ejemplo, por una
devolución), la nota necesita un RTN que la factura no tiene, y ese RTN podría dar crédito fiscal a un adquirente
que la factura no identificaba.

**Pregunta.**
- ¿Puede emitirse una nota de crédito o débito sobre una factura emitida a CONSUMIDOR FINAL?
- Si puede, ¿con qué RTN? ¿Basta el que dé el cliente, o hay que hacer otro procedimiento (por ejemplo, anular la
  factura y emitir otra con su RTN)?

**Artículos.** Arts. 26 y 28 num. 1-3; Art. 11 num. 3 (C L.736-737).

**Lectura provisional.** La nota se emite con el nombre y el RTN que indica el cliente, con un aviso que pide
confirmar que corresponde al mismo cliente. Si la factura tenía RTN, la nota debe llevar el mismo.

## P-20. Anulación de un documento con notas vigentes

**Contexto.** El Art. 41 manda anular los comprobantes emitidos con errores (C L.1943-1955). El Art. 4 num. 32 dice
que la nota de crédito respalda un ajuste sobre el «correspondiente» comprobante (C L.381-385). Ya rechazamos una
nota sobre un comprobante anulado. Ningún artículo dice qué pasa al anular un comprobante que ya tiene notas de
crédito o débito vigentes: si se permitiera, las notas quedarían sin comprobante y el libro de ventas mostraría
importes negativos.

**Pregunta.**
- ¿Puede anularse un comprobante que tiene notas de crédito o débito vigentes?
- Si no, ¿el procedimiento es anular primero las notas y después el comprobante? ¿O las notas quedan anuladas
  con él?

**Artículos.** Arts. 4 num. 32 (C L.381-385) y 41 (C L.1943-1955).

**Lectura provisional.** El sistema no anula un comprobante con notas vigentes: indica cuáles son y pide anular
primero las notas, cada una con su motivo. Después se puede anular el comprobante.

---

Quedamos atentos a su respuesta.

Atentamente,

_______________________
[Nombre y RTN del solicitante]
[Correo y teléfono de contacto]
