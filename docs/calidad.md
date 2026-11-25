# Calidad medida

Qué se mide en factura-hn además de las pruebas de siempre, con qué resultado y cómo repetirlo. Cada tema tiene su
informe en `docs/calidad/`, con el detalle, los hallazgos y la fecha de la medición (25-11-2026).

| Tema | Resultado | Dónde corre | Informe |
|---|---|---|---|
| Propiedades del núcleo (fast-check) | 60 propiedades, 12 620 casos en el CI y 1 262 000 de noche, 0 fallos. Cada propiedad fiscal cita su artículo. | CI y nocturno | [propiedades.md](calidad/propiedades.md) |
| Contrato OpenAPI | Cada respuesta de las pruebas de la API se valida contra `openapi.json` (estado, cuerpo y cabeceras): 2 760 respuestas, 0 fuera del contrato. 28 de 28 operaciones y 137 de 229 combinaciones operación + estado. | CI | [propiedades.md](calidad/propiedades.md) |
| Fuzzing | 300 solicitudes generadas desde la especificación en el CI y 20 000 de noche, ninguna 500. Los analizadores del núcleo solo lanzan sus propios errores. | CI y nocturno | [propiedades.md](calidad/propiedades.md) |
| Mutación (Stryker) | 98,98 % en total tras el Lote 6 (99,11 % en el Lote 5; antes 67,94 %). Cálculo 97,90 %, dinero 97,30 %, numeración 100 %, validación (documento 99,37 %, autorización 98,99 %, identificación 100 %), letras 100 %, modo 100 %. Falla si un módulo baja de 85 %. | Nocturno (unos 15 min) | [mutacion.md](calidad/mutacion.md) |
| Carga | A 30 emisiones/s: p50 19 ms, p95 37 ms, p99 56 ms. Saturación: unos 130 documentos/s. 0 números repetidos, 0 huecos, una emisión por `Idempotency-Key`. | CI (corta) y nocturno (5 min) | [carga.md](calidad/carga.md) |
| Resiliencia | PostgreSQL reiniciado o caído en medio de la emisión: 0 huecos, 0 repetidos, 503 `BASE_NO_DISPONIBLE` con `Retry-After` y la API se recupera sola. Un commit incierto se reintenta sin emitir dos veces. Webhooks caídos: nada se pierde y la emisión no se frena. | CI (corta) y nocturno | [resiliencia.md](calidad/resiliencia.md) |
| OWASP API Security Top 10 (2023) | 10 de 10 riesgos con pruebas que intentan explotarlos: 55 pruebas, todas pasan, ninguna omitida. | CI | [owasp.md](calidad/owasp.md) |

Los números de latencia y de tiempo salen de un equipo de desarrollo (Windows 11, 20 núcleos). El CI corre las
mismas comprobaciones en un runner de GitHub de 4 vCPU, con umbrales más holgados (perfil `ci` de
`packages/api/carga/perfiles.json`). Lo que no depende de la velocidad se exige igual en todas partes: ningún
número repetido ni perdido, ninguna 500 y ninguna respuesta fuera del contrato.

## Cómo repetirlo

Con el PostgreSQL de desarrollo en marcha (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db`, en
`127.0.0.1:54329`):

```bash
export FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn_pruebas
pnpm calidad:propiedades   # propiedades, contrato y fuzz (unos 2 min)
pnpm calidad:owasp         # OWASP API Top 10 (unos 60 s)
pnpm carga ci              # carga corta; también `local` y `nocturno`
pnpm resiliencia           # reinicios y caídas de PostgreSQL (necesita los binarios de PostgreSQL)
pnpm mutacion              # pruebas de mutación del núcleo (unos 15 min; no necesita la base)
```

`FHN_PROP_SEMILLA=<semilla>` repite un fallo de las propiedades o del fuzz. `pnpm resiliencia --larga` y
`FHN_PROP_CORRIDAS=20000 FHN_FUZZ_CASOS=20000 pnpm calidad:propiedades` son las versiones nocturnas.

## El flujo nocturno

`.github/workflows/nocturno.yml` corre cada día a las 07:00 UTC (01:00 en Honduras) y a mano desde la pestaña
Actions. Tiene tres trabajos:
- propiedades, contrato y fuzz con 20 000 casos y una semilla distinta cada noche;
- carga larga y resiliencia larga;
- mutación, con el informe de Stryker como artefacto.

Lo que tarda menos de unos 2 minutos corre además en cada push, en `ci.yml`.

## Errores que encontraron estas mediciones

Todos tienen su prueba. Ninguno cambió una regla fiscal.
- Un total de más de 15 cifras, un CAI con NUL en la ruta, una fecha de período que no existe y un NUL en el nombre
  de una llave o en la URL de un webhook daban 500. Ahora dan 400, 404 o 422 con su código.
- Con PostgreSQL caído la API respondía 500. Ahora responde 503 `BASE_NO_DISPONIBLE` con `Retry-After`.
- Los montos desde un billón salían «UN MILLÓN MILLONES»; ahora dicen «UN BILLÓN».
- Una solicitud sin `Content-Type: application/json` recibía un 415 en texto plano. Ahora trae la forma de error de
  la API.
- Los webhooks acumulados se entregaban de a 20 cada 5 s; ahora se vacían en una pasada.
- `GET /v1/documentos` podía armar páginas de decenas de megabytes; ahora corta la página en 8 MiB.
- La especificación no declaraba cabeceras y respuestas que la API ya enviaba (`Idempotency-Replayed`, el 403 de
  `libro-ventas`, los tipos CSV y TXT de la exportación).
