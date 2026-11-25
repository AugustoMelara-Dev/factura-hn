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
iniciada (`fly auth login`). La API en Fly nunca tiene la URL del dueño de la base: migrar y la consola corren
desde tu equipo o desde un entorno protegido de GitHub. Los valores entre `<…>` son tuyos. Si cambias el nombre de una aplicación, cámbialo
también en `fly.api.toml` (`app`, `FHN_DEMO_URL_API`, `FHN_DEMO_URL_MCP`) y en `fly.mcp.toml` (`app`, `FHN_API_URL`).

## 1. Supabase

1. Crea un proyecto **solo para la demostración**, en la región **East US (North Virginia)**, `us-east-1`. Guarda la
   contraseña de la base (la del usuario `postgres`) en tu gestor de contraseñas.
2. **Apaga la API de datos.** En **Project Settings > Data API**, desactiva la API de datos (o, si la necesitas para
   otra cosa, quita `public` de **Exposed schemas**). Por qué: Supabase publica por HTTP los esquemas expuestos con
   los roles `anon` y `authenticated`, y la llave `anon` es pública por diseño. Las tablas de factura-hn están en
   `public`. La migración ya les quita a esos roles todo permiso sobre las tablas y funciones de factura-hn, pero la
   API de la demostración no debe tener una segunda puerta: nada de la base se usa por HTTP.
3. **Rol de la API.** Crea el rol con el que atiende la API. No tiene ningún permiso propio: la migración le
   concede el rol de la aplicación (`fhn_app`), al que solo puede pasar con `SET ROLE`, sujeto a las políticas de
   fila. En el **SQL Editor**, como `postgres`, sin contraseña:

   ```sql
   CREATE ROLE fhn_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
   ```

   La contraseña va aparte, para que no quede escrita en ningún editor ni historial: genera una con
   `openssl rand -hex 32` (en hexadecimal no hay que escapar nada en la URL), pégala directo en tu gestor de
   contraseñas y ponla desde `psql` con `\password fhn_api`, que la pide sin mostrarla y la manda ya cifrada. Si la
   pones en el SQL Editor (`ALTER ROLE fhn_api PASSWORD '…'`), borra después ese fragmento del editor.

   El usuario `postgres` de Supabase puede crear roles pero no es superusuario. Alcanza: la migración y la revisión de
   la demostración corren con un dueño así (las pruebas cubren ese caso).
4. **Certificado.** En **Project Settings > Database > SSL Configuration**, descarga el certificado
   (`prod-ca-2021.crt`). Node no conoce esa autoridad: sin el certificado, la conexión no se puede verificar. Todas
   las URL llevan `sslmode=verify-full`. Nunca `no-verify`: la conexión iría cifrada, pero sin saber con quién, y con
   la URL del dueño eso es entregar la base.
5. **Las dos URL de conexión.** `<REF>` es la referencia del proyecto (Project Settings > General).

   - `DATABASE_URL`, la de la API, que vive en Fly: la conexión **directa**, que es solo IPv6 (las máquinas de Fly
     salen por IPv6).

     ```
     postgresql://fhn_api:<CONTRASEÑA_FHN_API>@db.<REF>.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/app/supabase-ca.crt
     ```

   - `FHN_MIGRAR_URL`, la del dueño, que **nunca va a Fly**. Solo la usan la migración y la consola, desde tu equipo
     o desde el entorno protegido de GitHub, que en general no tienen IPv6. Por eso va por el **pooler en modo
     sesión** (Connect > Session pooler), con el certificado en la raíz del repositorio:

     ```
     postgresql://postgres.<REF>:<CONTRASEÑA_POSTGRES>@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=prod-ca-2021.crt
     ```

     El certificado del pooler debe estar firmado por la misma autoridad (`prod-ca-2021.crt`). La primera migración
     lo comprueba: si falla con un error de certificado, no sigas ni lo cambies por `no-verify`; revisa en Supabase
     qué certificado presenta el pooler.

   Si una contraseña tiene símbolos, escápala para URL (`encodeURIComponent`). Si la conexión directa no responde
   desde Fly (`ENETUNREACH`, `ETIMEDOUT`), la API también puede usar el pooler en modo sesión, con el usuario
   `fhn_api.<REF>` y `sslrootcert=/app/supabase-ca.crt`. El modo transacción (puerto 6543) también funcionaría,
   porque todo lo que la API fija en la conexión (`SET LOCAL ROLE`, `set_config(…, true)`) vale solo para su
   transacción, pero el modo sesión es el que se probó.

Supabase pausa los proyectos gratuitos sin actividad durante una semana. La API consulta la base cada minuto (la
limpieza de entornos vencidos) y UptimeRobot llama a `/salud`, que también la consulta, cada 5 minutos. Si aun así
se pausara, reanúdalo desde el panel de Supabase.

## 2. Aplicaciones en Fly.io

Usa una organización de Fly **solo para la demostración: sin otras aplicaciones y sin otros miembros** (tu
organización personal, si está así, o una nueva). La API cree la dirección del visitante que le manda el MCP remoto
solo si la solicitud viene de la red privada de la organización, y cualquier máquina de esa red podría hacerse pasar
por el MCP. En esa red también están el constructor remoto de imágenes de Fly y los equipos que conectes por
WireGuard (`fly wireguard`, `fly proxy`): son tuyos, y deben seguir siéndolo.

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

## 3. Secretos de la API

Ningún secreto va en los archivos `fly.*.toml`, en el repositorio ni en la línea de comandos (quedaría en el
historial de la terminal). Se pasan con un archivo temporal **fuera del repositorio**, que se borra al terminar:

```bash
umask 077                                                       # el archivo, solo para ti
printf 'FHN_DEMO_SECRETO=%s\n' "$(openssl rand -hex 32)" > ~/demo.env
printf 'SUPABASE_CA=%s\n' "$(base64 -w0 prod-ca-2021.crt)" >> ~/demo.env   # en macOS: base64 -i prod-ca-2021.crt
${EDITOR:-nano} ~/demo.env                                      # agrega DATABASE_URL=… pegándola desde tu gestor
fly secrets import -a factura-hn-demo-api --stage < ~/demo.env
rm ~/demo.env
```

- `DATABASE_URL`: la del rol `fhn_api` (paso 1.5). Es la única credencial de la base que tiene Fly.
- `FHN_DEMO_SECRETO`: 32 bytes al azar. Firma la huella de la dirección de cada visitante; si cambia, el cupo de
  entornos por dirección vuelve a empezar. Nadie necesita verla.
- `SUPABASE_CA`: el certificado en base64. Fly lo escribe en `/app/supabase-ca.crt` al arrancar cada máquina (la
  sección `[[files]]` de `fly.api.toml`).
- `FHN_MIGRAR_URL` **no** va. La API arranca con `FHN_MIGRAR_AL_ARRANCAR=0` (en `fly.api.toml`): no migra ni tiene
  credenciales de dueño. Al arrancar exige que el esquema esté al día y que `DATABASE_URL` no sea dueño de las
  tablas, superusuario ni `BYPASSRLS`; si no, no arranca.
- El MCP remoto no tiene secretos.

## 4. Migrar y desplegar: la base, la API y luego el MCP

### Migrar (con el dueño, fuera de Fly)

Antes del primer despliegue y antes de cada actualización de la API. Desde un clon del repositorio, con Node 22 y
pnpm, y con `prod-ca-2021.crt` en su raíz:

```bash
pnpm install && pnpm --filter '@factura-hn/api...' build
read -rs FHN_MIGRAR_URL && export FHN_MIGRAR_URL   # pega la URL del dueño desde tu gestor: no se ve ni queda en el historial
FHN_MODO=demo DATABASE_URL=postgresql://fhn_api@solo-el-nombre-del-rol/postgres node packages/api/dist/cli.js migrar
unset FHN_MIGRAR_URL
```

`migrar` crea o actualiza las tablas y el rol `fhn_app` y se lo concede a `fhn_api` (de `DATABASE_URL` solo lee el
nombre del rol: no lleva contraseña ni se conecta). Les quita a `PUBLIC`, `anon`, `authenticated` y `service_role`
los permisos sobre las tablas y funciones de factura-hn. Con `FHN_MODO=demo`, además, **se niega a terminar** si la
base tiene datos que no son de la demostración (un tenant de producción, un CAI real, un tenant que no es un entorno
de prueba). Debe terminar con «Esquema al día. La base es solo de la demostración.».

### Desplegar

```bash
fly deploy -c fly.api.toml --ha=false
fly deploy -c fly.mcp.toml --ha=false
fly scale count 1 -a factura-hn-demo-api --yes
fly scale count 1 -a factura-hn-demo-mcp --yes
fly machines list -a factura-hn-demo-api   # una sola máquina
fly machines list -a factura-hn-demo-mcp   # una sola máquina
fly ips list -a factura-hn-demo-api        # una IPv6 y una IPv4 compartida (el primer despliegue las asigna)
fly ips list -a factura-hn-demo-mcp
```

**Una sola máquina por aplicación.** Sin `--ha=false`, el primer despliegue de una aplicación crea dos máquinas. Las
sesiones del MCP remoto y los límites por minuto viven en la memoria de cada proceso: con dos, las sesiones se
rompen al caer en la otra máquina, los límites se duplican y el costo también. `fly scale count 1` lo corrige si ya
pasó; `fly machines list` debe mostrar una sola por aplicación, también después de cada despliegue.

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

No es un secreto; va con `fly secrets` para no publicar la red de tu organización en el repositorio. Sin este paso
todo funciona, pero los intentos con tokens falsos que llegan por el MCP cuentan como de una sola dirección. Con él,
la API cree el `X-Forwarded-For` del MCP (la dirección del visitante) solo si la solicitud viene de ese rango, que
debe ser solo tuyo (sección 2); las que llegan de internet usan `Fly-Client-IP`, que pone el proxy de Fly.

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

### Antes de anunciarla

1. **Fly reemplaza el `Fly-Client-IP` que manda el cliente.** Cada dirección crea 3 entornos en 24 horas
   (`FHN_DEMO_ENTORNOS_POR_IP`). Desde tu equipo, con una cabecera distinta en cada intento:

   ```bash
   for i in 1 2 3 4 5; do
     curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Fly-Client-IP: 198.51.100.$i" $API/v1/demo/entornos
   done
   ```

   Desde una dirección que no creó entornos hoy, debe dar `201` las tres primeras veces y `429` después (menos `201`
   si ya creaste alguno). Si da `201` las cinco, la API está creyendo la cabecera del cliente: pausa la demostración
   y no la anuncies. La prueba gasta tu cupo del día.
2. **La máquina lee el certificado.** La API corre como el usuario `node`; si no pudiera leer el certificado, no
   arrancaría. Para verlo:

   ```bash
   fly ssh console -a factura-hn-demo-api -C "ls -l /app/supabase-ca.crt"   # legible por todos (-r--r--r-- o -rw-r--r--) o del usuario node
   ```

3. **Una sola máquina** por aplicación (`fly machines list`, arriba).

Luego define la variable del repositorio que usa la página «Pruébalo ahora» y la prueba programada:

```bash
gh variable set FHN_DEMO_API --body "https://factura-hn-demo-api.fly.dev"
```

y vuelve a publicar el sitio (Actions > el flujo de Pages > Run workflow).

### En Claude

En [claude.ai](https://claude.ai) (web): **Customize > Connectors > + > Add custom connector**, un nombre como
«factura-hn prueba» y la `mcp.url` del entorno, sin OAuth. Guarda y, en una conversación nueva, activa el conector y
pide «emite una factura de prueba por dos cafés de 57.50, con el ISV incluido». El conector agregado en la web aparece
también en la aplicación móvil con la misma cuenta. Detalle para visitantes:
[MCP remoto](https://augustomelara-dev.github.io/factura-hn/ia/mcp-remoto/).

## 6. Operar

**Pausar sin credenciales de dueño:** `fly secrets set -a factura-hn-demo-api FHN_DEMO_PAUSADO=1` reinicia la API en
pausa: no se crean entornos y los que hay reciben 503 `DEMO_PAUSADO` (también por el MCP).
`fly secrets unset -a factura-hn-demo-api FHN_DEMO_PAUSADO` la quita. Para apagarlo todo y dejar de gastar en
máquinas: `fly scale count 0 -a <app> --yes` en cada aplicación (y `fly scale count 1 -a <app> --yes` para volver).

**La consola del operador** necesita al dueño de la base (sus comandos migran antes de empezar), así que corre desde
tu equipo, nunca en Fly, con la URL del dueño solo para ese momento:

```bash
read -rs FHN_MIGRAR_URL && export FHN_MIGRAR_URL
export FHN_MODO=demo DATABASE_URL=postgresql://fhn_api@solo-el-nombre-del-rol/postgres
node packages/api/dist/cli.js demo estado                  # vigentes, vencidos por borrar y si está en pausa
node packages/api/dist/cli.js demo pausar --motivo abuso   # en a lo sumo 5 segundos, sin reiniciar
node packages/api/dist/cli.js demo reanudar                # no quita FHN_DEMO_PAUSADO=1
unset FHN_MIGRAR_URL
```

La limpieza de los entornos vencidos no necesita al dueño: la API la hace sola con el rol de la aplicación, por una
función de la base que solo borra entornos de prueba vencidos.

Logs:

```bash
fly logs -a factura-hn-demo-api
fly logs -a factura-hn-demo-mcp
fly status -a factura-hn-demo-api
```

Ni la API ni el MCP escriben llaves, tokens ni direcciones de visitantes en el log. La URL del MCP lleva el token
en la ruta: no actives registros de solicitudes que guarden rutas completas.

### Limpieza a las 24 horas: el reinicio automático de los datos

Cada entorno vive 24 horas (`FHN_DEMO_HORAS`). A esa hora su llave y su URL del MCP dejan de servir (401
`ENTORNO_VENCIDO`) y, en el minuto siguiente, la API lo borra con todo lo suyo: documentos, series, autorizaciones,
llaves, bitácora y uso. No hay otro reinicio de datos: la base solo tiene entornos de prueba, y cada uno se borra
solo.

**No hace falta una máquina programada** que corra `demo limpiar`. La API limpia al arrancar y cada minuto; si
estuviera caída, nadie podría usar los entornos vencidos (la llave deja de servir a la hora de vencimiento, que se
revisa en cada solicitud) y la primera limpieza al volver los borra. Una máquina programada agregaría otra máquina
con credenciales de la base, sin cambiar nada de eso. Si la API estuvo detenida mucho tiempo,
`node packages/api/dist/cli.js demo limpiar` desde tu equipo (con `FHN_MIGRAR_URL`, como arriba) lo hace a mano.

### Actualizar

Desde tu equipo: `migrar` (sección 4) y luego `fly deploy -c fly.api.toml --ha=false` y
`fly deploy -c fly.mcp.toml --ha=false`. O desde GitHub, con el flujo **Desplegar demostración** (Actions >
Desplegar demostración > Run workflow), que migra en un trabajo aparte y despliega solo si la migración terminó
bien. Para usarlo, una vez:

1. En **Settings > Environments**, crea el entorno `demo` con **Required reviewers**: tu usuario (cada corrida espera
   tu aprobación), y en **Deployment branches and tags**, **Selected branches and tags**: `main`.
2. En ese entorno, tres secretos, pegados desde tu gestor de contraseñas en el formulario de GitHub:
   - `FHN_MIGRAR_URL`: la del dueño por el pooler en modo sesión (paso 1.5), con `sslrootcert=prod-ca-2021.crt`;
   - `SUPABASE_CA`: el certificado en base64, como en Fly;
   - `FLY_API_TOKEN`: un token que solo pueda desplegar estas dos aplicaciones. `fly tokens create deploy -a
     factura-hn-demo-api` y lo mismo con `-a factura-hn-demo-mcp`, los dos en el mismo valor separados por una coma
     (flyctl acepta varios tokens así). Si flyctl no lo aceptara, un token de la organización
     (`fly tokens create org`) también sirve, con más alcance.

   Cada secreto llega solo a los pasos que lo usan.

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
por respuesta). Revisa cada semana **Billing** en el panel de Fly (lo acumulado del mes), `fly machines list` de
cada aplicación (una sola máquina) y `demo estado` (sección 6). Si el tráfico sube sin razón: pausa, y luego baja
los límites `FHN_DEMO_*` en `fly.api.toml`.
