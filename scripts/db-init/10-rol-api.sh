#!/bin/sh
# Postgres lo corre una sola vez, al crear la base en un volumen nuevo (docker-entrypoint-initdb.d).
# Con contraseñas (FHN_API_PASSWORD en el servicio db de tu docker-compose.override.yml), crea el rol fhn_api con
# esa contraseña antes de que arranque la API. Sin ella no hace nada: la API crea fhn_api al migrar (trust).
# En una instalación que ya tiene datos, córrelo a mano (también sirve para cambiar la contraseña):
#   docker compose exec -T db sh -c 'sh /docker-entrypoint-initdb.d/10-rol-api.sh'
if [ -z "${FHN_API_PASSWORD:-}" ]; then
  echo "10-rol-api: sin FHN_API_PASSWORD; la API crea fhn_api al arrancar."
else
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-factura_hn}" \
    -v clave="$FHN_API_PASSWORD" <<'SQL' || { echo "10-rol-api: no se pudo crear fhn_api." >&2; exit 1; }
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fhn_api') AS crear \gset
\if :crear
  CREATE ROLE fhn_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
\endif
ALTER ROLE fhn_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD :'clave';
SQL
  echo "10-rol-api: fhn_api tiene la contraseña de FHN_API_PASSWORD."
fi
