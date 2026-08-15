# Custom Paste Image

Paste a clipboard image straight into a markdown file, with a configurable
target folder and link style.

VS Code's own Markdown Language Features already paste a bitmap on `Ctrl+V`.
This extension goes further:

- Reads more than a bitmap: a file copied in Explorer/Nautilus arrives as a
  *file-drop-list*, not pixels, which the built-in paste and most third-party
  paste-image extensions miss entirely.
- Prefers a real PNG over a flattened bitmap where the clipboard offers both
  (browsers, the Snipping Tool), which keeps transparency instead of turning
  it black.
- Configurable save location and link style — next to the file, a fixed
  subfolder, or a workspace-root-relative path for static sites that serve a
  folder at the site root.
- Markdown or HTML output, the latter with a `width` placeholder for sizing.
- Works on native Windows, in a Remote-WSL window, and on Linux (X11/Wayland),
  reading the clipboard through the platform's own tools rather than the
  Electron clipboard API.

Published by [VidraSec](https://vidrasec.com), an IT security company — the
Marketplace listing carries their verified publisher badge.

## Usage

Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>
on macOS) in a markdown file. The image on the clipboard is written to disk
and a link is inserted at the cursor:

```markdown
![Login form](./login-form.png)
```

**What ends up on the clipboard:**

| You copied | Result |
| --- | --- |
| A screenshot (Snipping Tool, <kbd>Print Screen</kbd>, browser, Office) | Saved as PNG |
| An image **file** in Explorer/Nautilus | Saved with its own name and format |
| A path to an image file, as text | Saved with its own name and format |

Selected text becomes the alt text and seeds the file name. Without a
selection the cursor lands inside the empty `![]`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `customPasteImage.folder` | `""` | Where to save. Empty saves next to the file. `/assets/img` is relative to the workspace root. `images` or `../assets` is relative to the file's directory. |
| `customPasteImage.linkStyle` | `relative` | `relative` links from the file to the image; `workspaceAbsolute` links from the workspace root with a leading `/` (falls back to relative if the image isn't inside the workspace). |
| `customPasteImage.confirmFileName` | `true` | Ask for the file name before saving. |
| `customPasteImage.format` | `markdown` | `markdown` for `![]()`, `html` for `<img>` with a `width` placeholder. |

Because `folder` can point outside the workspace, its *workspace* value is
ignored in an untrusted folder; your user setting still applies. Trust the
folder to let the repository's own value take effect.

## Requirements

On Linux (not WSL), install `wl-clipboard` (Wayland) or `xclip` (X11) to read
the clipboard.

## Development

```sh
npm install
npm run watch      # rebuild on change
npm test           # unit tests for the pure helpers
npm run typecheck
```

Press <kbd>F5</kbd> to launch an Extension Development Host with the extension loaded.

The clipboard readers need a real clipboard, so they are exercised by hand.
Everything that does not — file naming, link encoding, alt-text escaping, URI
list parsing — lives in `naming.ts`, `format.ts` and `firstImagePath`, is free
of `vscode` imports, and is covered by `src/test`.

## Publishing

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
Azure DevOps PATs are retired December 2026), not a token secret. This is a
one-time setup, already done for this repo — kept here for reference/recovery:

1. Create a publisher at
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
2. Create a user-assigned Managed Identity in the Azure Portal, with a
   federated credential for GitHub Actions (entity type **Environment**,
   environment name `marketplace-publish`, matching this repo).
3. Add the identity's Client ID and Tenant ID as the `AZURE_CLIENT_ID` and
   `AZURE_TENANT_ID` repository secrets, and create a GitHub Actions
   environment named `marketplace-publish`.
4. Register the identity with Azure DevOps once (`az rest -u
   https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource
   499b84ac-1321-427f-aa17-267ca6975798`) and copy the returned `id`.
5. Add that id as a **Contributor** member on the publisher.

Locally, `npx vsce publish --azure-credential` picks up an `az login` session
the same way.
