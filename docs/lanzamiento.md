# Lanzamiento: pasos para el responsable

Todo lo que se podía preparar sin publicar nada ya está en el repositorio:
- CI;
- workflow de release con changesets, listo para publicar con procedencia firmada (OIDC) cuando se active `PUBLICAR_NPM`;
- sitio de documentación;
- archivos de comunidad;
- auditoría de datos.

Estos pasos crean cuentas, publican o despliegan: los ejecutas tú, en este orden. Los comandos son para Git
Bash (en Windows) o cualquier terminal Unix, desde la raíz del repositorio. Necesitas `gh` (GitHub CLI) y
`npm`, con una sesión iniciada en cada uno.

El repositorio es `AugustoMelara-Dev/factura-hn`, en la cuenta personal, y el sitio va en
`augustomelara-dev.github.io/factura-hn`. Los paquetes van en la organización **`factura-hn`** de npm. Si cambias
el repositorio, el paso 1 actualiza los enlaces en todo el código.

## 0. Antes de empezar

```bash
git checkout main && git status            # limpio, en main
pnpm install --frozen-lockfile
pnpm auditar:datos && pnpm build && pnpm typecheck && pnpm test && pnpm test:ejemplos && pnpm test:pg
pnpm verificar:dist && pnpm sitio
```

### El correo de autor en el historial

Cada commit publica el correo de su autor. El historial ya usa el correo noreply de GitHub, y
`pnpm auditar:datos` falla si algún commit trae otro (también en la CI). Mantenlo así en el `git config` local:

```bash
git config user.email    # debe terminar en @users.noreply.github.com
```

Activa también en GitHub Settings → Emails «Keep my email addresses private» y «Block command line pushes that
expose my email».

## 1. Nombre del repositorio (solo si cambia)

```bash
# Solo si el repositorio deja de ser AugustoMelara-Dev/factura-hn (el dominio de Pages va en minúsculas):
git grep -l "AugustoMelara-Dev/factura-hn\|augustomelara-dev.github.io" | xargs sed -i \
  -e 's#AugustoMelara-Dev/factura-hn#DUENO/REPO#g' -e 's#augustomelara-dev.github.io/factura-hn#dueno.github.io/REPO#g'
pnpm sitio && git commit -am "chore: datos del repositorio para el lanzamiento"
```

## 2. Crear el repositorio en GitHub

```bash
gh auth login
gh repo create AugustoMelara-Dev/factura-hn --public \
  --description "Facturación SAR Honduras (Acuerdo 481-2017): SDK, API REST y servidor MCP. Proyecto independiente, no afiliado al SAR." \
  --homepage "https://augustomelara-dev.github.io/factura-hn/" \
  --source . --remote origin
git push -u origin main
```

El primer push corre el CI (pestaña Actions). Release y Sitio quedan apagados hasta el paso 6.

Ajustes recomendados:

```bash
R=AugustoMelara-Dev/factura-hn
gh api -X PUT repos/$R/private-vulnerability-reporting          # reporte privado (SECURITY.md)
gh repo edit $R --enable-wiki=false --enable-discussions --delete-branch-on-merge --enable-squash-merge
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

## 4. Primera publicación (0.2.0), desde tu máquina

La publicación de confianza (trusted publishing, OIDC) se configura en la página de cada paquete en npmjs.com,
y esa página solo existe después de la primera publicación. Por eso la 0.2.0 sale de tu máquina, con tu
código 2FA. Esa versión no lleva procedencia firmada (solo la firma la CI); las siguientes, sí.

Los paquetes ya están en 0.2.0 y el `CHANGELOG.md` describe la versión. `scripts/publicar.mjs` empaqueta cada
paquete con `pnpm pack` (cambia `workspace:` por versiones) y lo sube con `npm publish`, en orden de
dependencias: `factura-hn`, `@factura-hn/pdf`, `@factura-hn/postgres`, `@factura-hn/sqlite`,
`@factura-hn/cliente`, `@factura-hn/mcp`. Lo que ya está en npm se salta: si el código 2FA vence a medias,
vuelve a correrlo con un código nuevo.

```bash
git checkout main && git pull --ff-only && git status   # limpio, en main
pnpm install --frozen-lockfile
pnpm build && node scripts/verificar-dist.mjs
node scripts/publicar.mjs --dry-run                     # ensayo: no publica
npm whoami                                              # tu usuario, miembro de la organización factura-hn
node scripts/publicar.mjs --otp=CODIGO                  # CODIGO: el de tu app de 2FA, recién generado
git push origin --tags                                  # etiquetas factura-hn@0.2.0, @factura-hn/…@0.2.0
```

Comprueba el resultado:

```bash
npm view factura-hn version                      # 0.2.0
mkdir /tmp/prueba-fhn && cd /tmp/prueba-fhn && npm init -y >/dev/null && npm install factura-hn && npm audit signatures
```

## 5. Publicación de confianza en npmjs.com

En cada uno de los seis paquetes: npmjs.com → el paquete → **Settings** → **Trusted publishing** → **GitHub
Actions**, con estos datos (los mismos para los seis):

| Campo | Valor |
|---|---|
| Organization or user | `AugustoMelara-Dev` |
| Repository | `factura-hn` |
| Workflow filename | `release.yml` (solo el nombre, con la extensión) |
| Environment name | `npm` |
| Allowed actions | marca **npm publish** (`npm stage publish` va siempre) |

npm exige que `repository.url` de cada paquete coincida exactamente con el repositorio: es
`git+https://github.com/AugustoMelara-Dev/factura-hn.git` en los seis, y `pnpm verificar:dist` lo comprueba.
Una conexión no se puede editar: si cambia el repositorio, el archivo del flujo o el entorno, bórrala y créala de
nuevo.

Después, en cada paquete, **Settings** → **Publishing access** → «Require two-factor authentication and
disallow tokens»: sin tokens, solo tú (con 2FA) y el flujo Release pueden publicar.

El entorno `npm` del repositorio lleva tu aprobación obligatoria y solo acepta despliegues desde ramas
protegidas (`main`):

```bash
R=AugustoMelara-Dev/factura-hn
gh api -X PUT repos/$R/environments/npm --input - <<JSON
{ "reviewers": [ { "type": "User", "id": $(gh api user --jq .id) } ],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
JSON
```

## 6. Activar el flujo Release y GitHub Pages

```bash
R=AugustoMelara-Dev/factura-hn
gh variable set PUBLICAR_NPM --body true --repo $R
gh api -X POST repos/$R/pages -f build_type=workflow
gh variable set PUBLICAR_SITIO --body true --repo $R
gh workflow run pages.yml --repo $R
gh run watch --repo $R
```

El sitio queda en <https://augustomelara-dev.github.io/factura-hn/>.

Desde aquí, cada cambio a un paquete lleva `pnpm changeset`. Al llegar a `main`, el flujo Release abre el PR
«Versión de paquetes»; al fusionarlo, espera tu aprobación del entorno `npm` y publica con OIDC, sin tokens. La
procedencia firmada se comprueba con `npm view @factura-hn/mcp dist.attestations`.

## 7. Después del lanzamiento

- Quita «aún no está en npm» del README y de `packages/mcp/README.md`: `npx -y @factura-hn/mcp` ya funciona.
- Envía la consulta al SAR (`docs/consulta-sar.md`) y archiva la respuesta. Hasta que llegue la de P-02, no hay
  API alojada (`docs/modelo-de-negocio.md`).
- Opcional: publicar la imagen Docker de la API en GHCR. Hoy se construye desde el repositorio.
