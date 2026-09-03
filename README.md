# cumba-oss-web

The **CDISC validator SPA** — a React + TypeScript + Vite single-page UI over the coreJ
CDISC validation REST API. Create a session, upload study files, start a check run, and
page through the findings.

Part of the [cumba-oss](https://github.com/cumba-oss) set. The API it talks to is
`cumba-oss-cdisc-rest`, in [cumba-oss-clients](https://github.com/cumba-oss/cumba-oss-clients).

## Layout

```
web/cumba-oss-web/         the SPA (React + TypeScript + Vite)
dist/cumba-oss-web-dist/   packages the built site into the release archive
```

⚠ `dist/` at the repository root is a **Maven module directory** and is committed. The
SPA's build output is `web/cumba-oss-web/dist` and is not. Do not add a bare `dist/` to
the root `.gitignore`.

## Building

```bash
mvn -B clean verify          # the whole gate, exactly what CI runs
```

Maven contributes only the reactor, a pinned Node, the release assembly and `${revision}`;
`frontend-maven-plugin` runs the real gate:

```
prettier --check  →  eslint  →  tsc --noEmit  →  vitest (coverage thresholds)  →  vite build
```

Working on the UI alone is faster straight through npm:

```bash
cd web/cumba-oss-web
npm ci
npm run dev        # vite dev server, proxying /api to http://localhost:8080
npm run verify     # the same chain the Maven build runs
```

⚠ `mvn package` deliberately produces **no** release archive. `vite build` is bound to
the `verify` phase, so the assembly is too — `verify` is the floor for producing a zip.

### What the build needs from the network

The test suite reads **nothing** licensed or machine-specific: every HTTP call is
intercepted by [MSW](https://mswjs.io/), and there are no external fixtures. The build
does need public registries — Node from nodejs.org (version pinned in the module pom), npm
packages from registry.npmjs.org (pinned by `package-lock.json`), and Maven plugins from
Central. It also needs a real **git checkout**, because the schema drift check below shells
out to `git diff`; CI therefore checks out with `fetch-depth: 0`.

## The API contract

The typed API client (`src/api/schema.d.ts`) is **generated**, not written, from
`openapi.snapshot.json` — a committed copy of the REST API's OpenAPI document. Keeping that
copy in the repository is what makes the build hermetic: no network, no running API, and a
clean clone reproduces the same types.

`npm run gen:api:check` regenerates the types and fails if the result differs from the
committed file. It runs on every build, at `generate-sources`. Without it, the build would
rewrite `schema.d.ts` silently on each run and leave only an unstaged diff nobody has to
notice. To fix a reported drift, run the plain generator and stage the result:

```bash
cd web/cumba-oss-web
npm run gen:api
git add src/api/schema.d.ts
```

To generate against a spec you dumped yourself rather than the committed snapshot:

```bash
COREJ_OPENAPI_SPEC=/path/to/openapi.json npm run gen:api
```

A path that is named but does not exist is a hard error — silently falling back to the
snapshot is the failure that option exists to prevent. If you use it and the API really did
change, refresh `openapi.snapshot.json` from the same file: the snapshot and `schema.d.ts`
are committed as a pair.

### ⛔ Known gap: nothing here detects drift against the *published* API

`gen:api:check` proves only that `schema.d.ts` matches the **committed snapshot**. It does
not, and cannot, tell you whether that snapshot is still the current published contract.

In the monorepo the other half of the guard was `OpenApiSnapshotDriftTest` in
`clients/corej-cdisc-rest`, which pinned the snapshot against the live generated spec. It
could not survive the split into two repositories and was removed from `cumba-oss-clients`.

The agreed replacement — the REST API publishing its OpenAPI document as a real versioned
artifact, with the snapshot declaring which version it is a copy of — is **not implemented**.
Until it is, the snapshot is a pinned adoption with no expiry, and "is this current?" is
answered by a human. Treat a REST API change as requiring a deliberate snapshot refresh here.

## Releases

Tagging `vX.Y.Z` builds, signs and publishes one asset:

```
cumba-oss-web-<version>.zip     the built static site (index.html + assets/)
```

⛔ **Nothing in this repository is published to Maven Central**, or to any Maven repository.
Both modules are `packaging=pom`; the archive is the entire deliverable.

### Verifying a release asset

Each asset is signed with the same GPG key as the project's Maven Central artifacts — one
trust root, not two. A release asset **can be replaced in place** by anyone with write
access, so unlike an immutable Central artifact the signature is the only thing standing
between you and a swapped file:

```bash
curl -sLO <asset-url> && curl -sLO <asset-url>.asc
gpg --verify cumba-oss-web-<version>.zip.asc cumba-oss-web-<version>.zip
```

Key fingerprint: `AE5AA7685BED3FC5DF4AE8DD7727EF25F931AF6B`

### Serving it with the API on one origin

`cumba-oss-cdisc-rest` can bundle the built site into its own jar, so the API serves the UI
at `/` — same origin, and no CORS configuration:

```bash
unzip cumba-oss-web-<version>.zip -d ./web-dist
mvn -pl clients/cumba-oss-cdisc-rest -Pbundle-web clean package -Dweb.dist.dir=$PWD/web-dist
```

Served standalone instead, it needs a static server that falls back unknown paths to
`index.html` (client-side routing), and the API reachable at `/api` on the same origin.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
