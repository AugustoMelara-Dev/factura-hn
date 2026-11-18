# Lanzamiento: pasos para el responsable

Todo lo que se podía preparar sin publicar nada ya está en el repositorio:
- CI;
- release con changesets y procedencia;
- sitio de documentación;
- archivos de comunidad;
- auditoría de datos.

Estos pasos crean cuentas, publican o despliegan: los ejecutas tú, en este orden. Los comandos son para Git
Bash (en Windows) o cualquier terminal Unix, desde la raíz del repositorio. Necesitas `gh` (GitHub CLI) y
`npm`, con una sesión iniciada en cada uno.

Se supone la organización **`factura-hn`** en GitHub y en npm, y el repositorio `factura-hn/factura-hn`. Si
usas otros nombres, el paso 1 los cambia en todo el repositorio.

## 0. Antes de empezar

```bash
git checkout main && git status            # limpio, en main
pnpm install --frozen-lockfile
pnpm auditar:datos && pnpm build && pnpm typecheck && pnpm test && pnpm test:ejemplos && pnpm test:pg
pnpm verificar:dist && pnpm sitio
```

### El correo de autor en el historial

Los commits del historial llevan como autor el correo de tu configuración de git. Al hacer público el
repositorio, ese correo queda visible en cada commit. Revisa qué correos hay:

```bash
git log --format='%an <%ae>' | sort | uniq -c
```

Si no quieres publicar alguno, tienes dos opciones:

1. **Desde ahora:** usa el correo privado que te da GitHub (Settings → Emails → «Keep my email addresses
   private»):

   ```bash
   git config user.email "TU_ID+TU_USUARIO@users.noreply.github.com"
   ```

2. **Reescribir el historial antes del primer push.** Es irreversible: haz una copia antes. Necesita
   `git-filter-repo` (`pip install git-filter-repo`):

   ```bash
   cp -r ../factura-hn ../factura-hn-respaldo
   printf 'Tu Nombre <TU_ID+TU_USUARIO@users.noreply.github.com> <correo-a-ocultar@ejemplo.example>\n' > ../mailmap.txt
   git filter-repo --mailmap ../mailmap.txt
   ```

## 1. Completar los marcadores

```bash
grep -rn "CORREO_DE_CONTACTO" --exclude-dir=node_modules .
# Reemplázalo por un correo del proyecto (no personal), p. ej.:
sed -i 's/CORREO_DE_CONTACTO/conducta@tu-dominio/' CODE_OF_CONDUCT.md

# Solo si la organización o el repositorio no se llaman factura-hn/factura-hn:
git grep -l "factura-hn/factura-hn\|factura-hn.github.io" | xargs sed -i \
  -e 's#factura-hn/factura-hn#TU_ORG/TU_REPO#g' -e 's#factura-hn.github.io/factura-hn#TU_ORG.github.io/TU_REPO#g'
pnpm sitio && git commit -am "chore: datos del repositorio para el lanzamiento"
```

## 2. Crear el repositorio en GitHub

Crea la organización `factura-hn` en <https://github.com/account/organizations/new> (plan gratuito). Después:

```bash
gh auth login
gh repo create factura-hn/factura-hn --public \
  --description "Facturación SAR Honduras (Acuerdo 481-2017): SDK, API REST y servidor MCP" \
  --homepage "https://factura-hn.github.io/factura-hn/" \
  --source . --remote origin
git push -u origin main
```

El primer push corre el CI (pestaña Actions). Release y Sitio quedan apagados hasta los pasos 5 y 6.

Ajustes recomendados:

```bash
R=factura-hn/factura-hn
gh api -X PUT repos/$R/private-vulnerability-reporting          # reporte privado (SECURITY.md)
gh repo edit $R --enable-wiki=false --delete-branch-on-merge --enable-squash-merge
gh api repos/$R/topics -X PUT -f 'names[]=honduras' -f 'names[]=sar' -f 'names[]=facturacion' -f 'names[]=typescript' -f 'names[]=mcp'

# Protección de main: PR obligatorio y el CI en verde
gh api -X PUT repos/$R/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": [
    "Tipos, pruebas, build, dist y documentación (Node 22)",
    "Tipos, pruebas, build, dist y documentación (Node 24)",
    "Postgres (almacén, API, cliente, MCP, Express, Next.js)",
    "Imagen de la API"
  ] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
```

## 3. Crear la organización `@factura-hn` en npm

1. Activa la verificación en dos pasos de tu cuenta npm: <https://www.npmjs.com/settings/~/tfa>.
2. Crea la organización **factura-hn** (gratis para paquetes públicos): <https://www.npmjs.com/org/create>.
3. Comprueba que los nombres siguen libres (un 404 es lo esperado):

   ```bash
   npm whoami
   for p in factura-hn @factura-hn/sqlite @factura-hn/postgres @factura-hn/pdf @factura-hn/cliente @factura-hn/mcp; do
     npm view "$p" name 2>/dev/null && echo "OCUPADO: $p" || echo "libre: $p"
   done
   ```

   Si `factura-hn` (sin scope) está ocupado, avísame antes de seguir: hay que renombrar el paquete del núcleo.

## 4. Token de npm en GitHub

1. Crea un **token granular** en <https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new>:
   - nombre `github-factura-hn`, vencimiento de 90 días;
   - permisos de paquetes: **Read and write**; para la primera publicación, «All packages» (los paquetes aún
     no existen);
   - organizaciones: `factura-hn`, **Read only**.
2. Guárdalo en un entorno protegido del repositorio. El flujo usa el entorno `npm`; con revisor obligatorio,
   cada publicación espera tu aprobación:

   ```bash
   R=factura-hn/factura-hn
   gh api -X PUT repos/$R/environments/npm --input - <<JSON
   { "reviewers": [ { "type": "User", "id": $(gh api user --jq .id) } ] }
   JSON
   gh secret set NPM_TOKEN --env npm --repo $R     # pega el token cuando lo pida (no queda en el historial)
   ```

Después de la primera publicación, cambia el token por uno limitado a los seis paquetes. Mejor aún, configura
la publicación de confianza (trusted publishing, OIDC) de cada paquete en npmjs.com y borra el token.

## 5. Primera publicación (0.2.0)

Los paquetes ya están en 0.2.0 y el `CHANGELOG.md` describe la versión. No hace falta un changeset: el flujo
Release publica lo que aún no está en npm.

```bash
R=factura-hn/factura-hn
pnpm -r --filter "./packages/*" publish --dry-run --no-git-checks   # ensayo local: no publica (la API es privada y se omite)
gh variable set PUBLICAR_NPM --body true --repo $R
gh workflow run release.yml --repo $R
gh run watch --repo $R             # aprueba el entorno «npm» cuando lo pida
```

Comprueba el resultado:

```bash
npm view factura-hn version                      # 0.2.0
npm view @factura-hn/mcp dist.attestations       # procedencia firmada
mkdir /tmp/prueba-fhn && cd /tmp/prueba-fhn && npm init -y >/dev/null && npm install factura-hn && npm audit signatures
```

Desde aquí, cada cambio a un paquete lleva `pnpm changeset`. Al llegar a `main`, el flujo abre el PR
«Versión de paquetes»; al fusionarlo, publica.

## 6. Activar GitHub Pages

```bash
R=factura-hn/factura-hn
gh api -X POST repos/$R/pages -f build_type=workflow
gh variable set PUBLICAR_SITIO --body true --repo $R
gh workflow run pages.yml --repo $R
gh run watch --repo $R
```

El sitio queda en <https://factura-hn.github.io/factura-hn/>.

## 7. Después del lanzamiento

- Quita «aún no está en npm» del README y de `packages/mcp/README.md`: `npx -y @factura-hn/mcp` ya funciona.
- Envía la consulta al SAR (`docs/consulta-sar.md`) y archiva la respuesta. Hasta que llegue la de P-02, no hay
  API alojada (`docs/modelo-de-negocio.md`).
- Opcional: publicar la imagen Docker de la API en GHCR. Hoy se construye desde el repositorio.
