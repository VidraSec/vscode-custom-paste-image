# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Links are now escaped for characters `encodeURI` leaves alone. A file called
  `Screenshot (1).png` produced `![alt](./Screenshot (1).png)`, whose link
  ended at the first `)`; `#`, `?`, `[`, `]` and `&` were broken the same way.
- Alt text taken from the selection is escaped, and a multi-line selection is
  collapsed to one line. A selection containing `]` used to truncate the
  markdown caption, and one containing `"` broke out of the HTML `alt`
  attribute.
- A typed file name ending in a version-like suffix keeps its image extension:
  `figure-3.1` is saved as `figure-3.1.png` instead of an extensionless
  `figure-3.1` that no viewer would render.
- On Linux, a clipboard entry pointing at a file that has since been deleted
  reports that plainly instead of surfacing a raw `ENOENT`.
- Oversized images are refused with a message naming the limit, rather than
  being killed mid-transfer with `ENOBUFS`. The 64 MB cap now applies to the
  image, not to its base64 encoding.

### Changed

- `customPasteImage.folder` is declared a restricted configuration, so its
  workspace value is ignored until the folder is trusted — a repository can no
  longer point pastes outside the workspace on open.
- The extension declares that it does not support virtual workspaces.
- The command shows as `Paste Image` in the palette rather than
  `Paste Image: Paste Image`.

## [0.1.0]

Initial release: extracted from a personal setup into a standalone extension.

- Reads image *files* off the clipboard (Explorer/Nautilus file-drop-list), not
  only bitmaps.
- Prefers a real PNG over a flattened bitmap, preserving transparency.
- Configurable target folder and link style, markdown or HTML output.
- Windows, Remote-WSL and Linux (X11/Wayland).
