# Running the coreJ validator with Docker

The validator is two apps: `cumba-oss-corej-rest` (the validation service, Java) and this SPA
(`cumba-oss-corej-web`). [`docker-compose.yml`](../docker-compose.yml) at this repo's root runs them
as two containers (PLAN-ci-snapshots-and-container-images D6):

| container    | image             | what it does                                                                                                                            |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `corej-web`  | `p300/corej-web`  | nginx serves the built SPA and proxies `/api`, `/v3/api-docs`, `/swagger-ui*` to the rest container — the browser sees **one origin**   |
| `corej-rest` | `p300/corej-rest` | the API on `:8080` (not published); sessions, reports, the rule corpora, the metadata store and dictionaries on the `corej-data` volume |

## The images

CI builds both images (`.github/workflows/ci.yml`, job `publish-image`) from the release zip
its build job produced, so an image carries the same bytes as the release. They are pushed to
Docker Hub, namespace `p300` — `docker.io/p300/corej-web` and `docker.io/p300/corej-rest` — for
linux/amd64 and linux/arm64:

| pushed by      | tags                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| a tag `vX.Y.Z` | `X.Y.Z` and `latest` — `latest` only ever means a release                                        |
| a push to main | `X.Y.Z-SNAPSHOT`, the pom's `<revision>` (moves with main), and `sha-<short commit>` (immutable) |

Each image carries its own repo's versions: a release number or a `sha-` tag of `corej-rest`
names nothing in `corej-web`, so the compose file takes one tag per image (`COREJ_REST_TAG`,
`COREJ_WEB_TAG`).

## Start

```bash
docker compose up -d                      # Podman: podman-compose up -d
COREJ_REST_TAG=<its X.Y.Z-SNAPSHOT> COREJ_WEB_TAG=<its X.Y.Z-SNAPSHOT> docker compose up -d   # follow main
```

Open <http://127.0.0.1:8080/>. Stop with `docker compose down`; the `corej-data` volume survives
(`down -v` deletes it). The variables (all optional):

| variable                  | default                    | meaning                                                      |
| ------------------------- | -------------------------- | ------------------------------------------------------------ |
| `COREJ_REST_TAG`          | `latest`                   | the tag of the corej-rest image (above)                      |
| `COREJ_WEB_TAG`           | `latest`                   | the tag of the corej-web image (above)                       |
| `COREJ_REGISTRY`          | `docker.io`                | the registry both images are pulled from                     |
| `WEB_PORT`                | `8080` (on 127.0.0.1 only) | the published nginx port                                     |
| `BRAND`                   | `neutral`                  | the look (below)                                             |
| `COREJ_CACHESEED_ENABLED` | `false`                    | `true`: corej-rest seeds the metadata store once at start-up |
| `COREJ_MAX_UPLOAD`        | `512MB`                    | corej-rest's upload cap — ⚠ nginx's is fixed at 512m (below) |
| `JAVA_TOOL_OPTIONS`       | empty                      | extra JVM options for corej-rest, e.g. `-Xmx2g`              |

## What the nginx in front does

[`nginx.conf`](nginx.conf) is the reference for **any** reverse proxy in front of the two apps
(what it forwards, on one origin). It was ported from `cumba-oss-corej-rule-editor-web`'s, with
different limits on `/api/` (review M1) — the rule editor's 4 MB body cap would refuse every
dataset upload:

- `client_max_body_size 512m` — **equal** to corej-rest's multipart limit
  (`spring.servlet.multipart.*`, 512 MB). Raise both together, or nginx answers `413` first.
- `proxy_request_buffering off` — the upload streams through instead of being spooled into the
  container first.
- `proxy_read_timeout 1800s` — sized for a validation run.

The SPA's own responses carry a `Content-Security-Policy`, `X-Content-Type-Options: nosniff` and
`frame-ancestors 'none'`.

## The brand

`BRAND=<name>` in the environment of `corej-web` selects the look (`neutral` by default, `p300`
ships too; `BRAND=p300 docker compose up -d` is enough). An unknown name stops the container at
start-up with the available names in its log ([`25-cumba-brand.sh`](25-cumba-brand.sh)) — the
look is never silently the default. To add a brand of your own, mount its folder (the token
contract: [`brands/README.md`](../brands/README.md)) beside the shipped ones in a
`docker-compose.override.yml`:

```yaml
services:
  corej-web:
    volumes:
      - ./my-brands/acme:/usr/share/nginx/html/brands/acme:ro
```

and set `BRAND=acme`.

## Build the image yourself

The image has no Node stage: [`Dockerfile.runtime`](../Dockerfile.runtime) copies a built dist
from `image-ctx/corej-web/` (never the repo-root `dist/`, which `.dockerignore` excludes):

```bash
npm ci && npm run build
mkdir -p image-ctx && rm -rf image-ctx/corej-web && cp -a dist image-ctx/corej-web
docker build -f Dockerfile.runtime -t corej-web:local .
```

Then name `corej-web:local` as the service's `image:` in a `docker-compose.override.yml`. Without
Docker, `npm run dev` proxies `/api` to a corej-rest on `:8080` (`vite.config.ts`).

## Troubleshooting

| symptom                                                   | cause                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `toomanyrequests` from Docker Hub                         | the anonymous pull rate limit — `docker login` with any Docker Hub account                         |
| `manifest unknown` for `latest`                           | no release has been tagged yet — `COREJ_REST_TAG` / `COREJ_WEB_TAG` = each repo's `X.Y.Z-SNAPSHOT` |
| `413 Request Entity Too Large` on an upload               | the file is above nginx's 512m — raise `client_max_body_size` and corej-rest's limit together      |
| `cumba brand: BRAND="…" has no …/brand.css; available: …` | a typo in `BRAND`, or a mounted brand without `brand.css`                                          |
| `502 Bad Gateway` on `/api/…` right after `up`            | corej-rest is still starting (its healthcheck allows 60 s) — `docker compose logs -f corej-rest`   |
