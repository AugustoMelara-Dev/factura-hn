"""La primera factura con el cliente de Python generado, contra una API en marcha.

    FHN_API_URL=http://127.0.0.1:8787 FHN_LLAVE=fhn_test_… python -m pytest clientes/python

La llave es una de caja del tenant `demo` (`factura-hn-api demo llave --solo-llave`): CAI ficticio, documentos de
prueba sin validez fiscal. Comprueba el correlativo, el total y la leyenda de prueba de lo que emite.
"""

import json
import os
import re
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from factura_hn_api import AuthenticatedClient
from factura_hn_api.api.documentos import emitir_documento, obtener_documento
from factura_hn_api.api.sesi_ó_n import obtener_sesion
from factura_hn_api.models import DocumentoFiscalModo, RespuestaEmision, RespuestaSesion, SolicitudEmision

RAIZ = Path(__file__).resolve().parent.parent.parent
FACTURA = json.loads((RAIZ / "packages" / "api" / "ejemplos" / "factura.json").read_text(encoding="utf-8"))
LEYENDA_PRUEBA = "DOCUMENTO DE PRUEBA — SIN VALOR FISCAL"


@pytest.fixture(scope="module")
def cliente():
    llave = os.environ.get("FHN_LLAVE")
    if not llave:
        pytest.fail("Falta FHN_LLAVE: una llave de caja del demo (factura-hn-api demo llave --solo-llave).")
    url = os.environ.get("FHN_API_URL", "http://127.0.0.1:8787")
    with AuthenticatedClient(base_url=url, token=llave, raise_on_unexpected_status=True) as c:
        yield c


def emitir(cliente, clave, repetida=False):
    """Emite factura.json con la clave dada. `repetida`: la clave ya se usó y la API devuelve la respuesta guardada."""
    r = emitir_documento.sync_detailed(client=cliente, body=SolicitudEmision.from_dict(FACTURA), idempotency_key=clave)
    assert r.status_code == 201, r.content.decode("utf-8", "replace")
    assert isinstance(r.parsed, RespuestaEmision)
    assert (r.headers.get("idempotency-replayed") == "true") == repetida, dict(r.headers)
    return r.parsed


def centavos(monto):
    """Un monto de la respuesta (número en lempiras) en centavos enteros, como pide la descripción de la API."""
    return int((Decimal(str(monto)) * 100).to_integral_value())


def total_esperado():
    """El total de factura.json: con preciosIncluyenISV, la suma de cantidad × precio de sus líneas."""
    assert FACTURA["documento"]["preciosIncluyenISV"] is True
    return sum(Decimal(l["cantidad"]) * Decimal(l["precioUnitario"]) for l in FACTURA["documento"]["lineas"])


def test_la_llave_es_de_prueba_y_puede_emitir(cliente):
    r = obtener_sesion.sync(client=cliente)
    assert isinstance(r, RespuestaSesion)
    assert r.sesion.modo_tenant == "prueba"
    assert r.sesion.puede_emitir, r.sesion.pendientes


def test_emite_una_factura_de_prueba(cliente):
    clave = f"python-{uuid.uuid4()}"
    primera = emitir(cliente, clave)
    doc = primera.documento

    # Correlativo: el número es establecimiento-punto-tipo-correlativo, con el correlativo de 8 dígitos.
    m = re.fullmatch(r"(\d{3})-(\d{3})-01-(\d{8})", doc.numero)
    assert m, doc.numero
    assert int(m.group(3)) == doc.correlativo
    assert doc.tipo_documento == "01"

    # La misma clave devuelve la misma factura, sin consumir otro número.
    repetida = emitir(cliente, clave, repetida=True)
    assert repetida.documento.numero == doc.numero

    # Otra venta (otra clave) toma el correlativo siguiente, sin huecos.
    siguiente = emitir(cliente, f"python-{uuid.uuid4()}").documento
    assert siguiente.correlativo == doc.correlativo + 1

    # Total: 2 × 57.50 con ISV incluido.
    assert centavos(doc.totales.total) == centavos(total_esperado())

    # Desglose del ISV a la tasa del 15 %: con el precio con ISV incluido, el gravado es total / 1.15 y el
    # ISV, la diferencia. Aquí 115.00 = 100.00 gravado al 15 % + 15.00 de ISV, en centavos.
    gravado15 = centavos(doc.totales.additional_properties["importeGravado15"])
    isv15 = centavos(doc.totales.isv15)
    assert gravado15 == centavos(total_esperado() * 100 / 115) == 10000
    assert isv15 == centavos(total_esperado()) - gravado15 == 1500
    assert centavos(doc.totales.isv18) == 0
    assert gravado15 + isv15 == centavos(doc.totales.total)

    # Leyenda de prueba: el documento es de prueba y su representación impresa lo dice.
    assert doc.modo == DocumentoFiscalModo.PRUEBA
    archivo_txt = primera.enlaces.txt.rsplit("/", 1)[-1]
    texto = cliente.get_httpx_client().get(f"/v1/documentos/{archivo_txt}")
    assert texto.status_code == 200
    assert LEYENDA_PRUEBA in texto.text

    # El PDF del enlace.
    pdf = cliente.get_httpx_client().get(primera.enlaces.pdf)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")

    # Y el documento en JSON, con el mismo número.
    guardado = obtener_documento.sync(doc.numero, client=cliente)
    assert guardado.documento.numero == doc.numero
