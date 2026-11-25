# Desplegar la demostración pública (Fly.io + Supabase)

Lista de pasos para poner en línea la demostración pública de factura-hn: la API en modo demo y el MCP remoto en
Fly.io (región `iad`, Virginia), la base en Supabase (`us-east-1`), la vigilancia en UptimeRobot y el sitio en GitHub
Pages. Qué hace la demostración, sus variables y sus límites: [docs/demo.md](demo.md).

```
visitante ──https──► API (Fly, factura-hn-demo-api) ──TLS──► Postgres (Supabase, us-east-1)
    │                     ▲
    │                     │ red privada de Fly (IPv6, <app>.internal)
    └──https──► MCP remoto (Fly, factura-hn-demo-mcp)
```

Todo lo que sigue se hace desde tu equipo, en la raíz del repositorio, con `flyctl` instalado y con la sesión
iniciada (`fly auth login`). Los valores entre `<…>` son tuyos. Si cambias el nombre de una aplicación, cámbialo
también en `fly.api.toml` (`app`, `FHN_DEMO_URL_API`, `FHN_DEMO_URL_MCP`) y en `fly.mcp.toml` (`app`, `FHN_API_URL`).

## 1. Supabase

1. Crea un proyecto **solo para la demostración**, en la región **East US (North Virginia)**, `us-east-1`. Guarda la
   contraseña de la base (la del usuario `postgres`) en tu gestor de contraseñas.
2. **Apaga la API de datos.** En **Project Settings > Data API**, desactiva la API de datos (o, si la necesitas para
   otra cosa, quita `public` de **Exposed schemas**). Por qué: Supabase publica por HTTP los esquemas expuestos con
   los roles `anon` y `authenticated`, y la llave `anon` es pública por diseño. Las tablas de factura-hn están en
   `public`. La migración ya les quita a esos roles todo permiso sobre las tablas y funciones de factura-hn, pero la
   API de la demostración no debe tener una segunda puerta: nada de la base se usa por HTTP.
3. **Rol de la API.** En el **SQL Editor**, como `postgres`, crea el rol con el que atiende la API. No tiene ningún
   permiso propio: la migración le concede el rol de la aplicación (`fhn_app`), al que solo puede pasar con
   `SET ROLE`, sujeto a las políticas de fila. Genera su contraseña con `openssl rand -hex 32` (en hexadecimal no
   hay que escapar nada en la URL).

   ```sql
   CREATE ROLE fhn_api LOGIN PASSWORD '<CONTRASEÑA_FHN_API>'
     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
   ```

   El usuario `postgres` de Supabase puede crear roles pero no es superusuario. Alcanza: la migración, la revisión
   de arranque del modo demo y la limpieza corren con un dueño así (las pruebas cubren ese caso).
4. **Certificado.** En **Project Settings > Database > SSL Configuration**, descarga el certificado
   (`prod-ca-2021.crt`). Node no conoce esa autoridad: sin el certificado, la conexión no se puede verificar.
5. **Las dos URL de conexión.** Usa la conexión **directa** (`db.<REF>.supabase.co:5432`). Es solo IPv6, y las
   máquinas de Fly salen por IPv6. `<REF>` es la referencia del proyecto (Project Settings > General).

   ```
   FHN_MIGRAR_URL=postgresql://postgres:<CONTRASEÑA_POSTGRES>@db.<REF>.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/app/supabase-ca.crt
   DATABASE_URL=postgresql://fhn_api:<CONTRASEÑA_FHN_API>@db.<REF>.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/app/supabase-ca.crt
   ```

   Si la contraseña de `postgres` tiene símbolos, escápala para URL (`encodeURIComponent`). Si la conexión directa
   no responde desde Fly (`ENETUNREACH`, `ETIMEDOUT`), usa el **pooler en modo sesión** (Connect > Session pooler):
   `postgresql://postgres.<REF>:…@aws-0-us-east-1.pooler.supabase.com:5432/postgres` y, para la API, el usuario
   `fhn_api.<REF>`. El modo transacción (puerto 6543) también funciona, porque todo lo que la API fija en la
   conexión (`SET LOCAL ROLE`, `set_config(…, true)`) vale solo para su transacción, pero el modo sesión es el que
   se probó.

Supabase pausa los proyectos gratuitos sin actividad durante una semana. La API consulta la base cada minuto (la
limpieza de entornos vencidos) y UptimeRobot llama a `/salud`, que también la consulta, cada 5 minutos. Si aun así
se pausara, reanúdalo desde el panel de Supabase.

## 2. Aplicaciones en Fly.io

Usa una organización de Fly que **no tenga otras aplicaciones** (tu organización personal, si está vacía, o una
nueva). La API cree la dirección del visitante que le manda el MCP remoto solo si la solicitud viene de la red
privada de la organización: cualquier otra máquina de esa organización podría hacerse pasar por el MCP.

```bash
fly apps create factura-hn-demo-api --org <ORGANIZACIÓN>
fly apps create factura-hn-demo-mcp --org <ORGANIZACIÓN>
```

No hacen falta volúmenes (nada se guarda en disco: todo está en Supabase) ni una dirección privada Flycast: el MCP
llama a la API por `factura-hn-demo-api.internal`, la dirección de la red privada que Fly da a cada aplicación.

**Por qué `.internal` y no Flycast.** Con `.internal`, la API ve la dirección privada de la máquina del MCP y cree el
`X-Forwarded-For` que el MCP pone con la dirección de cada visitante (si está en `FHN_PROXIES_DE_CONFIANZA`). Con
Flycast (`fly ips allocate-v6 --private` y `http://<app>.flycast`), la solicitud pasa por el proxy de Fly, que pone su
propio `Fly-Client-IP` con la dirección del MCP: la API contaría todo lo del MCP como una sola dirección. Por eso la
API escucha en `::` (`FHN_HOST` en `fly.api.toml`): la red privada es solo IPv6.

## 3. Secretos

Ningún secreto va en los archivos `fly.*.toml` ni en el repositorio. `--stage` los guarda sin reiniciar nada.

```bash
# API: las dos URL de la base, la clave de las huellas de dirección y el certificado de Supabase.
fly secrets set -a factura-hn-demo-api --stage \
  FHN_MIGRAR_URL='postgresql://postgres:<CONTRASEÑA_POSTGRES>@db.<REF>.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/app/supabase-ca.crt' \
  DATABASE_URL='postgresql://fhn_api:<CONTRASEÑA_FHN_API>@db.<REF>.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/app/supabase-ca.crt' \
  FHN_DEMO_SECRETO="$(openssl rand -hex 32)" \
  SUPABASE_CA="$(base64 -w0 prod-ca-2021.crt)"
```

- `FHN_DEMO_SECRETO`: 64 caracteres hexadecimales (32 bytes al azar). Firma la huella de la dirección de cada
  visitante; si cambia, el cupo de entornos por dirección vuelve a empezar. No hace falta guardarla en otro lado.
- `SUPABASE_CA`: el certificado en base64 (en macOS, `base64 -i prod-ca-2021.crt`). Fly lo escribe en
  `/app/supabase-ca.crt` al arrancar cada máquina (la sección `[[files]]` de `fly.api.toml`). Sin el certificado,
  la alternativa es `sslmode=no-verify` en las dos URL y quitar esa sección: la conexión va cifrada, pero sin
  comprobar que del otro lado está Supabase.
- El MCP remoto no tiene secretos.

## 4. Desplegar: primero la API, luego el MCP

```bash
fly deploy -c fly.api.toml
```

Antes de cambiar la máquina, Fly corre `factura-hn-api migrar` en una máquina aparte (`release_command`): crea las
tablas y el rol `fhn_app`, se lo concede a `fhn_api` y les quita a `anon`, `authenticated` y `service_role` los
permisos sobre lo de factura-hn. Si falla (una URL o una contraseña mal escritas), el despliegue se detiene y lo dice
el log. Al arrancar, la API revisa que la base sea solo de la demostración, que `DATABASE_URL` no tenga permisos de
dueño ni salte las políticas de fila, y borra los entornos vencidos.

```bash
fly deploy -c fly.mcp.toml
fly ips list -a factura-hn-demo-api   # una IPv6 y una IPv4 compartida (el primer despliegue las asigna)
fly ips list -a factura-hn-demo-mcp
```

Si alguna aplicación quedó sin direcciones públicas: `fly ips allocate-v6 -a <app>` y
`fly ips allocate-v4 --shared -a <app>` (la IPv4 compartida es gratis; una dedicada se cobra).

### La red privada en `FHN_PROXIES_DE_CONFIANZA`

La dirección privada de una máquina cambia si la máquina se recrea, así que la API confía en el rango de la red
privada de la organización (una /48), no en una dirección:

```bash
fly ips private -a factura-hn-demo-mcp
# fdaa:0:1a2b:a7b:1f2:3c4d:5e6f:2 → los tres primeros grupos son la red de la organización
fly secrets set -a factura-hn-demo-api FHN_PROXIES_DE_CONFIANZA='fdaa:0:1a2b::/48'
```

Sin este paso todo funciona, pero los intentos con tokens falsos que llegan por el MCP cuentan como de una sola
dirección. Con él, la API cree el `X-Forwarded-For` del MCP (la dirección del visitante) solo si la solicitud viene
de ese rango; las que llegan de internet usan `Fly-Client-IP`, que pone el proxy de Fly.

## 5. Comprobar

```bash
API=https://factura-hn-demo-api.fly.dev
curl -s $API/salud                                   # {"ok":true,"version":"…","modo":"demo"}
curl -s https://factura-hn-demo-mcp.fly.dev/salud    # {"ok":true,"version":"…"}
curl -s -X POST $API/v1/demo/entornos                # 201: llave fhn_test_…, mcp.url y ejemplos
```

La respuesta de `POST /v1/demo/entornos` trae en `ejemplos` el `curl` para emitir una factura. Para comprobarlo todo
de una vez (entorno, factura por la API y herramientas por el MCP), como lo hace el flujo programado:

```bash
FHN_DEMO_API=$API node scripts/humo-demo.mjs
```

Luego define la variable del repositorio que usa la página «Pruébalo ahora» y la prueba programada:

```bash
gh variable set FHN_DEMO_API --body "https://factura-hn-demo-api.fly.dev"
```

y vuelve a publicar el sitio (Actions > el flujo de Pages > Run workflow).

### En Claude

En [claude.ai](https://claude.ai) (web): **Customize > Connectors > + > Add custom connector**, un nombre como
«factura-hn prueba» y la `mcp.url` del entorno, sin OAuth. Guarda y, en una conversación nueva, activa el conector y
pide «emite una factura de prueba por dos cafés de 57.50». El conector agregado en la web aparece también en la
aplicación móvil con la misma cuenta. Detalle para visitantes:
[MCP remoto](https://augustomelara-dev.github.io/factura-hn/ia/mcp-remoto/).

## 6. Operar

La consola del operador corre dentro de la máquina de la API, con sus secretos:

```bash
fly ssh console -a factura-hn-demo-api -C "factura-hn-api demo estado"
fly ssh console -a factura-hn-demo-api -C "factura-hn-api demo pausar --motivo abuso"
fly ssh console -a factura-hn-demo-api -C "factura-hn-api demo reanudar"
```

En pausa no se crean entornos y los que hay reciben 503 `DEMO_PAUSADO` (también por el MCP), en a lo sumo 5
segundos. Si la API no responde, `fly secrets set -a factura-hn-demo-api FHN_DEMO_PAUSADO=1` la reinicia en pausa
(`fly secrets unset … FHN_DEMO_PAUSADO` la quita). Para apagarlo todo y dejar de gastar en máquinas:
`fly scale count 0 -a <app>` en cada aplicación (y `fly scale count 1 -a <app>` para volver).

Logs:

```bash
fly logs -a factura-hn-demo-api
fly logs -a factura-hn-demo-mcp
fly status -a factura-hn-demo-api
```

Ni la API ni el MCP escriben llaves, tokens ni direcciones de visitantes en el log. El proxy de Fly no registra las
rutas de las solicitudes en los logs de la aplicación.

### Limpieza a las 24 horas: el reinicio automático de los datos

Cada entorno vive 24 horas (`FHN_DEMO_HORAS`). A esa hora su llave y su URL del MCP dejan de servir (401
`ENTORNO_VENCIDO`) y, en el minuto siguiente, la API lo borra con todo lo suyo: documentos, series, autorizaciones,
llaves, bitácora y uso. No hay otro reinicio de datos: la base solo tiene entornos de prueba, y cada uno se borra
solo.

**No hace falta una máquina programada** que corra `factura-hn-api demo limpiar`. La API limpia al arrancar y cada
minuto; si estuviera caída, nadie podría usar los entornos vencidos (la llave ya no sirve desde la hora de
vencimiento, que se revisa en cada solicitud) y la primera limpieza al volver los borra. Una máquina programada
agregaría otra máquina con las credenciales de dueño de la base, sin cambiar nada de eso. Si la API estuvo detenida
mucho tiempo, `fly ssh console -a factura-hn-demo-api -C "factura-hn-api demo limpiar"` lo hace a mano.

### Actualizar

Desde tu equipo, `fly deploy -c fly.api.toml` y luego `fly deploy -c fly.mcp.toml`, o desde GitHub con el flujo
**Desplegar demostración** (Actions > Desplegar demostración > Run workflow). Para usarlo, una vez:

1. En **Settings > Environments**, crea el entorno `demo` con **Required reviewers**: tu usuario. Cada corrida
   espera tu aprobación.
2. En ese entorno, el secreto `FLY_API_TOKEN`: un token de despliegue por aplicación
   (`fly tokens create deploy -a factura-hn-demo-api` y lo mismo con `-a factura-hn-demo-mcp`), los dos en el mismo
   valor separados por una coma. Así el token no sirve para otras aplicaciones ni para la organización.

## 7. Vigilancia (UptimeRobot) y página de estado

Crea tres monitores, todos del tipo **Keyword**, con intervalo de **5 minutos**, alerta cuando la palabra **no
exista** (Keyword not exists) y como contacto de alerta tu correo:

| Friendly Name | URL | Keyword |
| --- | --- | --- |
| `factura-hn · API de la demostración` | `https://factura-hn-demo-api.fly.dev/salud` | `"modo":"demo"` |
| `factura-hn · MCP remoto` | `https://factura-hn-demo-mcp.fly.dev/salud` | `"ok":true` |
| `factura-hn · sitio` | `https://augustomelara-dev.github.io/factura-hn/` | `factura-hn` |

`/salud` de la API consulta la base: si Supabase no responde, el monitor de la API lo nota (500).

La página de estado pública (**Status Pages > New status page**):

- **Friendly name:** `factura-hn · demostración`
- **Monitors:** los tres de arriba, en ese orden.
- **Homepage / logo link:** `https://augustomelara-dev.github.io/factura-hn/`
- **Custom domain:** ninguno (queda en `stats.uptimerobot.com/…`).

Pon el enlace de la página de estado en la página «Pruébalo ahora» o en el README si quieres que se vea.

Además, el flujo **Demostración en línea** (`.github/workflows/demo-en-linea.yml`) corre cada 6 horas: crea un
entorno, emite una factura y lista las herramientas del MCP. Si algo falla, el flujo queda en rojo y GitHub te avisa
por correo (si tienes activas las notificaciones de Actions). Sin la variable `FHN_DEMO_API`, termina sin probar nada.

## 8. Costo y cómo vigilarlo

Aproximado, con los precios publicados de Fly.io en `iad` (revísalos en <https://fly.io/docs/about/pricing/>):

| Qué | Costo al mes |
| --- | --- |
| API: `shared-cpu-1x`, 512 MB, siempre encendida | ≈ US$ 3.2 |
| MCP remoto: `shared-cpu-1x`, 512 MB, siempre encendida | ≈ US$ 3.2 |
| Tráfico saliente (Norteamérica, ≈ US$ 0.02 por GB) | centavos con los límites por defecto |
| IPv6 e IPv4 compartida | US$ 0 |
| Supabase (plan gratuito), UptimeRobot (gratuito), GitHub Actions en un repositorio público | US$ 0 |

**Por qué 512 MB.** La API genera PDF y atiende hasta 100 solicitudes a la vez con un pool de 20 conexiones; con
256 MB, un pico de PDF puede hacer que el sistema mate el proceso. El MCP remoto guarda hasta 64 MiB de eventos para
reconexión y hasta 100 sesiones (ver «Memoria» en docs/demo.md). La diferencia entre 256 y 512 MB es de cerca de
US$ 1.3 al mes por máquina. `NODE_OPTIONS=--max-old-space-size=384` hace que Node libere memoria antes de llegar al
tope.

Fly.io no tiene tope de gasto. Lo que limita el costo es: una sola máquina por aplicación, sin escalar
(`auto_stop_machines = "off"`, `min_machines_running = 1` y ninguna regla para crear más), y los límites de la
demostración, que acotan el tráfico (entornos por dirección y en total, solicitudes por minuto y por entorno, bytes
por respuesta). Revisa cada semana **Billing** en el panel de Fly (lo acumulado del mes) y
`fly ssh console -a factura-hn-demo-api -C "factura-hn-api demo estado"`. Si el tráfico sube sin razón:
`demo pausar`, y luego baja los límites `FHN_DEMO_*` en `fly.api.toml`.
