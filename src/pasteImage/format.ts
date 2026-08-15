import * as path from "node:path";

/**
 * Turning a path and a caption into the text that goes into the document.
 * Free of `vscode` imports so it can be unit tested directly.
 */

/**
 * `encodeURI` leaves these alone, and every one of them breaks the output:
 * `(` `)` end a markdown destination early, `#` and `?` become a fragment or
 * query in both markdown and `<img src>`, `[` `]` confuse link parsers, and
 * `&` starts an entity inside an attribute. A file called `Screenshot (1).png`
 * is the everyday case.
 *
 * Together with what `encodeURI` already escapes (`<` `>` `"` and whitespace)
 * this leaves a link that is safe to drop into an HTML attribute unescaped.
 */
const RESERVED_IN_LINK = /[()#?[\]&]/g;

export function encodeLinkPath(linkPath: string): string {
  return encodeURI(linkPath).replace(
    RESERVED_IN_LINK,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Link from the edited file's directory to `file`, always with a `./` or `../` prefix. */
export function relativeLink(fromDir: string, file: string): string {
  const relative = toPosix(path.relative(fromDir, file));
  return encodeLinkPath(relative.startsWith(".") ? relative : `./${relative}`);
}

/**
 * Whether `target` sits under `root`.
 *
 * The `..` test alone is not enough on Windows: across drives `path.relative`
 * gives back an absolute path with no `..` in it, which would read as inside.
 */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Link from the workspace root to `file`, with a leading `/`. */
export function workspaceAbsoluteLink(workspaceRoot: string, file: string): string {
  return `/${encodeLinkPath(toPosix(path.relative(workspaceRoot, file)))}`;
}

/**
 * Collapses the selection to a single line. A multi-line selection would
 * otherwise put raw newlines inside `![…]` and destroy the construct.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Escapes for markdown link text: an unbalanced `]` would end the caption early. */
export function escapeMarkdownAltText(altText: string): string {
  return altText.replace(/[\\[\]]/g, (char) => `\\${char}`);
}

/** Escapes for an HTML attribute value delimited by double quotes. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}
