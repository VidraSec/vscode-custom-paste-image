import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Everything about choosing the file name an image is saved under. Free of
 * `vscode` imports so it can be unit tested directly.
 */

/** Extensions we accept, both from the clipboard and from a typed file name. */
export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".avif",
  ".svg",
];

export interface NameSource {
  /** Extension including the leading dot, e.g. `.png`. */
  extension: string;
  /** Base name the clipboard carried, when it held a file rather than a bitmap. */
  name?: string;
}

export type NameProblem = { severity: "error" | "warning"; message: string };

export function suggestFileName(image: NameSource, altText: string, now = new Date()): string {
  const stem = slug(image.name ?? "") || slug(altText) || timestamp(now);
  return stem + image.extension;
}

/**
 * Checks what the user typed, without touching the disk.
 *
 * Subfolders are allowed (`shots/login.png`), escaping the target folder is
 * not. Returns `undefined` when the name is fine.
 */
export function checkFileName(value: string): NameProblem | undefined {
  const name = value.trim();
  if (!name) {
    return { severity: "error", message: "Enter a file name." };
  }
  const normalized = toPosix(name);
  if (isEscaping(normalized)) {
    return { severity: "error", message: "Must stay inside the folder." };
  }
  // Reject what Windows refuses, minus `/` which we allow for subfolders.
  if (/[<>:"|?*\u0000-\u001f]/.test(normalized)) {
    return {
      severity: "error",
      message: 'A file name must not contain < > : " | ? * or control characters.',
    };
  }
  if (/\s/.test(normalized)) {
    return {
      severity: "warning",
      message: "Spaces get escaped as %20 in the link; hyphens read better.",
    };
  }
  return undefined;
}

/**
 * Appends the clipboard's extension unless the name already ends in a known
 * image extension. Testing for *any* dot would read `figure-3.1` as having a
 * `.1` extension and save an unviewable file.
 */
export function normalizeFileName(name: string, fallbackExtension: string): string {
  const normalized = toPosix(name.trim());
  return hasImageExtension(normalized) ? normalized : normalized + fallbackExtension;
}

export function hasImageExtension(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/** Appends `-2`, `-3`, ... rather than silently overwriting when nobody is asked. */
export async function freePath(target: string): Promise<string> {
  const extension = path.extname(target);
  const stem = target.slice(0, target.length - extension.length);
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? target : `${stem}-${attempt}${extension}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
}

function toPosix(name: string): string {
  return name.replace(/\\/g, "/");
}

/**
 * `path.isAbsolute` alone is not enough: it is platform dependent, so a Linux
 * extension host would happily accept `C:/…`, and a Windows one `/etc/…`.
 */
function isEscaping(normalized: string): boolean {
  return (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").includes("..")
  );
}
