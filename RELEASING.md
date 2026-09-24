# Releasing

This repository distributes source through GitHub Releases. The package remains
private; releases do not publish to npm or attach prebuilt wasm binaries. Users
build the selected tag with the toolchains documented in `docs/install.md`.

1. Run the quality and runtime gates on Linux with Node 24 and the documented
   Emscripten toolchain:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm test:e2e
   CI=true pnpm playground:e2e
   pnpm docs:build:compiled
   CI=true PLAYGROUND_E2E_STATIC=1 pnpm playground:e2e
   ```

2. Bump `package.json`, finalize the changelog as `## X.Y.Z - YYYY-MM-DD` with a
   highlights paragraph, and retain an empty `## Unreleased` section. Use a patch
   version for fixes; use a minor version for features or compatibility changes.
3. Review and merge the release PR after its exact head passes CI.
4. Tag the merged release commit as `vX.Y.Z`, push the tag, and create a published
   GitHub Release using the complete matching changelog section as its body.
5. Verify the remote tag, package version, published release, and changelog body
   agree. There is no tag-triggered publication workflow or npm registry gate.
