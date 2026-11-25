"""Pone el cliente generado (clientes/python/generado, ver generar.py) al alcance de las pruebas."""

import sys
from pathlib import Path

GENERADO = Path(__file__).resolve().parent / "generado"
if not (GENERADO / "factura_hn_api").is_dir():
    raise RuntimeError("Falta el cliente generado: corre antes `python clientes/python/generar.py`.")
sys.path.insert(0, str(GENERADO))
