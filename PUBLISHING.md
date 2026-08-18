# Publishing

```sh
npm run package    # builds a local .vsix, without publishing anything
```

To ship a release, once your changes are committed and pushed to `main`:

```sh
npm version patch   # or minor / major
```

This runs `typecheck` + `test` (`preversion`), bumps `package.json`, commits
and tags `vX.Y.Z`, then pushes both (`postversion`). The pushed tag runs
`.github/workflows/release.yml`: it packages the `.vsix`, publishes to the
Marketplace, and only then creates the GitHub Release — so a rejected publish
leaves nothing to clean up before you retry.

`release.yml` authenticates to the Marketplace via Microsoft Entra ID (global
Azure DevOps PATs are retired December 2026), not a token secret. Locally,
`npx vsce publish --azure-credential` picks up an `az login` session the same
way.
