# Releasing vsim

All `@vsim/*` packages are versioned and published together from this monorepo. Publish
**with pnpm** (not `npm publish`) — pnpm rewrites `workspace:*` deps to real versions and
applies each package's `publishConfig` (which repoints `main`/`types`/`exports`/`bin` at
`dist/`). Plain `npm publish` does neither.

## One-time setup

- `npm login` as an account that owns (or may create) the **`@vsim`** npm scope.
  Publishing the first scoped public package creates the scope.
- Enable 2FA → you'll be prompted for an OTP per package, or use an automation token
  (`NPM_TOKEN`) in CI.

## Cut a release

1. Be on `main` with a clean tree; bump versions if needed (all packages share one
   version — keep them in lockstep).
2. Verify everything:
   ```bash
   pnpm install
   pnpm build
   pnpm test
   pnpm lint
   pnpm typecheck
   ```
3. Dry-run the publish and inspect the tarballs:
   ```bash
   pnpm release:dry
   ```
4. Publish (public access, in dependency order):
   ```bash
   pnpm -r --filter "./packages/*" publish --access public
   ```
5. Tag and push:
   ```bash
   git tag v0.1.0
   git push origin main --tags
   ```
6. Create the GitHub release for `v0.1.0` and attach the showreel:
   ```bash
   pnpm showreel                       # → out/showreel.mp4
   gh release create v0.1.0 out/showreel.mp4 \
     --title "vsim v0.1.0" --notes "Open-source code → 3D video SDK."
   ```

## Notes

- `publishConfig` in each `package.json` keeps local dev pointed at `./src` (build-free,
  via tsx) while the published tarball ships compiled `./dist`.
- `@vsim/cli` depends on `tsx` at runtime so a published `vsim` can compile a user's
  `.ts` scene under plain `node`.
- Only `dist/`, `package.json`, `README.md`, and `LICENSE` are published (`files` field).
