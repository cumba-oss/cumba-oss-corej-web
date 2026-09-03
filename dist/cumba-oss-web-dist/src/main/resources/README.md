# Cumba OSS Web — built validator SPA

This archive is the **built** single-page CDISC validator UI: static files only, no build
step and no Node toolchain required. Unzipping it gives you the site root
(`index.html` plus `assets/`), not a wrapper directory.

## Serving it

Any static file server works, with one requirement: the SPA does client-side routing, so
**unknown paths must fall back to `index.html`** rather than returning 404.

It calls the CDISC validation REST API at **`/api`**, relative to its own origin. So either
serve it from the same origin as the API, or put both behind one reverse proxy.

## Serving it from the API itself (one deployable)

`cumba-oss-cdisc-rest`, in the [cumba-oss-clients](https://github.com/cumba-oss/cumba-oss-clients)
repository, can bundle these files into its own jar so the API serves the UI at `/` on the
same origin — which also removes the CORS question entirely:

```bash
unzip cumba-oss-web-<version>.zip -d ./web-dist
mvn -pl clients/cumba-oss-cdisc-rest -Pbundle-web clean package -Dweb.dist.dir=$PWD/web-dist
```

## Verifying this archive

Each release asset is signed with the same GPG key as the project's Maven Central
artifacts — one trust root, not two. A **release asset can be replaced in place** by anyone
with write access to the repository, so unlike an immutable Central artifact the signature
is the only thing standing between you and a swapped file. Check it:

```bash
gpg --verify cumba-oss-web-<version>.zip.asc cumba-oss-web-<version>.zip
```

Key fingerprint: `AE5AA7685BED3FC5DF4AE8DD7727EF25F931AF6B`

## Which API does it match?

The typed API client in this build was generated from the `openapi.snapshot.json` committed
in the web repository at this tag. That snapshot is this project's copy of record for the
contract — see the repository README's *The API contract* section for what it does and does
not guarantee.

Licensed under AGPL-3.0-only.
