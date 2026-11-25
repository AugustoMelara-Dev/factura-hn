"""Genera el cliente de Python de la API de factura-hn desde packages/api/openapi.json.

    python clientes/python/generar.py

Usa openapi-python-client (versión fijada en requirements.txt) y escribe el paquete `factura_hn_api` en
clientes/python/generado/, que no se versiona: se regenera cuando cambia la especificación.
"""

import os
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
ESPECIFICACION = RAIZ / "packages" / "api" / "openapi.json"
SALIDA = AQUI / "generado"


def main() -> int:
    # El generador formatea con ruff, que se instala junto a él en el mismo entorno virtual.
    entorno = dict(os.environ)
    scripts = str(Path(sys.executable).parent)
    entorno["PATH"] = scripts + os.pathsep + entorno.get("PATH", "")
    orden = [
        sys.executable, "-m", "openapi_python_client", "generate",
        "--path", str(ESPECIFICACION),
        "--config", str(AQUI / "config.yml"),
        "--output-path", str(SALIDA),
        "--overwrite",
        "--fail-on-warning",
    ]
    return subprocess.run(orden, env=entorno, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
