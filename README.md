# omd-cli-poc

Proof of concept for the OMD CLI loading one npm package per schema version.
Schemas come from [omd-schema-sandbox](https://github.com/saturday-vibes/omd-schema-sandbox),
published as `@test-org-th/omd-schema-component` and `@test-org-th/omd-schema-service`.

```
npx @test-org-th/omd-cli-poc schema versions --format text
npx @test-org-th/omd-cli-poc schema show --kind component --version v1.4.4 --format text
npx @test-org-th/omd-cli-poc validate path/to/now.yaml --format text
```

## How schemas get in

Each shipped version is one alias in `dependencies`:

```json
"omd-schema-component-v1.4.4": "npm:@test-org-th/omd-schema-component@1.4.4"
```

`src/shared/schemas/catalog.ts` lists versions by reading the CLI's own
`package.json` and loads a version with `require.resolve('<alias>/package.json')`,
checking the package name and version match.

A `now.yaml` that declares a version the CLI doesn't ship is downloaded at
runtime (`src/shared/schemas/download.ts`): `npm install <package>@<version>
--prefix ~/.omd-cli/schemas/... --ignore-scripts`, run from the current folder
so its `.npmrc` applies, then reused from the cache. `--no-download` turns this
off.

## End to end

```
omd-schema-sandbox                     npm                         omd-cli-poc
──────────────────                     ───                         ───────────
PR bumps component/package.json
merge → release.yaml  ──────────────► omd-schema-component@X ──► schema-sync.yaml (dispatch / hourly / manual)
        tag component-vX                                            yarn add omd-schema-component-vX@npm:...
                                                                    build, test, write field snapshot
                                                                    PR "feat(schema): add component X"
                                                                      ▼ merge
                                                                    release-please PR ─► merge ─► npm publish
```

## CI checks per shipped version

`src/shared/schemas/versions.test.ts` loops over every alias:

- the alias resolves to the right package and version
- the schema compiles (AJV, `strict: false`, ajv-errors)
- the field walk used by `schema show` finds fields
- the sample declares this version
- a snapshot of the fields; `jest --ci` fails on a version without one, so
  schema-sync writes it and the PR shows it

## Secrets

| Secret | Used by | Without it |
| --- | --- | --- |
| `NPM_TOKEN` | release-please.yaml (publish) | releases are created but not published |
| `CLI_BOT_TOKEN` | schema-sync.yaml, release-please.yaml | PRs are opened with `GITHUB_TOKEN`, so PR checks don't run on them (schema-sync runs build and tests itself) |
