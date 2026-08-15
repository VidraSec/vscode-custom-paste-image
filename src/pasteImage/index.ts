import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readClipboardImage, type ClipboardImage } from "./clipboard";
import { resolvePasteTarget } from "./target";

/**
 * `Paste Image` — saves the clipboard image next to (or near) the current
 * file and links it from the current markdown document.
 *
 * Reads more than a bitmap: a file copied in Explorer/Nautilus arrives as a
 * file-drop-list, not pixels, which most paste-image extensions miss. Where a
 * browser or the Snipping Tool offers a real PNG alongside the bitmap, that
 * one is preferred, which keeps transparency instead of flattening it to black.
 */

type SnippetFormat = "markdown" | "html";

export async function pasteImage(log: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Paste Image: open the file you want the image in first.");
    return;
  }
  if (editor.document.uri.scheme !== "file") {
    vscode.window.showWarningMessage("Paste Image: save the file to disk before pasting an image.");
    return;
  }

  const target = resolvePasteTarget(editor.document.uri);
  if ("error" in target) {
    vscode.window.showErrorMessage(`Paste Image: ${target.error}`);
    return;
  }

  const image = await withProgress("Reading clipboard", () => readClipboardImage());
  if (!image) {
    vscode.window.showWarningMessage(
      "Paste Image: no image on the clipboard. Copy a screenshot, or copy the image file itself.",
    );
    return;
  }

  const config = vscode.workspace.getConfiguration("customPasteImage", editor.document.uri);
  const altText = editor.document.getText(editor.selection).trim();
  const suggestion = suggestFileName(image, altText);

  let file: string;
  if (config.get<boolean>("confirmFileName", true)) {
    // Overwriting is allowed here, but only after the input box says so.
    const fileName = await askForFileName(suggestion, target.dir);
    if (fileName === undefined) {
      return; // cancelled
    }
    file = path.join(target.dir, fileName);
  } else {
    file = await freePath(path.join(target.dir, suggestion));
  }

  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, image.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Writing ${file} failed: ${message}`);
    vscode.window.showErrorMessage(`Paste Image: could not save the image: ${message}`);
    return;
  }

  const link = target.toLink(file);
  const format = config.get<SnippetFormat>("format", "markdown");
  await editor.insertSnippet(buildSnippet(format, link, altText), editor.selection);

  log.info(`Pasted ${image.data.length} bytes to ${file} as ${link}`);
}

/* -------------------------------------------------------------------------- */
/* File name                                                                   */
/* -------------------------------------------------------------------------- */

function suggestFileName(image: ClipboardImage, altText: string): string {
  const stem = slug(image.name ?? "") || slug(altText) || timestamp();
  return stem + image.extension;
}

/**
 * Asks for the name with the extension already appended but only the stem
 * selected, so typing replaces the name and keeps the format.
 */
async function askForFileName(suggestion: string, targetDir: string): Promise<string | undefined> {
  const stemLength = suggestion.length - path.extname(suggestion).length;

  const answer = await vscode.window.showInputBox({
    title: "Paste Image",
    prompt: `Saved into ${targetDir}`,
    value: suggestion,
    valueSelection: [0, stemLength],
    validateInput: (value) => validateFileName(value, targetDir),
  });

  return answer === undefined ? undefined : normalizeFileName(answer.trim(), path.extname(suggestion));
}

async function validateFileName(
  value: string,
  targetDir: string,
): Promise<vscode.InputBoxValidationMessage | undefined> {
  const name = value.trim();
  if (!name) {
    return { message: "Enter a file name.", severity: vscode.InputBoxValidationSeverity.Error };
  }
  const normalized = name.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    return {
      message: "Must stay inside the folder.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }
  // Reject what Windows refuses, minus `/` which we allow for subfolders.
  if (/[<>:"|?*\u0000-\u001f]/.test(normalized)) {
    return {
      message: 'A file name must not contain < > : " | ? * or control characters.',
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }
  if (/\s/.test(normalized)) {
    return {
      message: "Spaces get escaped as %20 in the link; hyphens read better.",
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  }
  try {
    await fs.access(path.join(targetDir, normalized));
    return {
      message: "A file with this name exists and will be overwritten.",
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  } catch {
    return undefined;
  }
}

/** Appends `-2`, `-3`, ... rather than silently overwriting when nobody is asked. */
async function freePath(target: string): Promise<string> {
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

function normalizeFileName(name: string, fallbackExtension: string): string {
  const normalized = name.replace(/\\/g, "/");
  return path.extname(normalized) ? normalized : normalized + fallbackExtension;
}

function slug(text: string): string {
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

function timestamp(): string {
  const now = new Date();
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

/* -------------------------------------------------------------------------- */
/* Snippet                                                                     */
/* -------------------------------------------------------------------------- */

function buildSnippet(format: SnippetFormat, link: string, altText: string): vscode.SnippetString {
  const snippet = new vscode.SnippetString();

  if (format === "html") {
    snippet.appendText('<img src="');
    snippet.appendText(link);
    snippet.appendText('" alt="');
    appendAlt(snippet, altText);
    snippet.appendText('" width="');
    snippet.appendPlaceholder("50%");
    snippet.appendText('">');
  } else {
    snippet.appendText("![");
    appendAlt(snippet, altText);
    snippet.appendText(`](${link})`);
  }

  snippet.appendTabstop(0);
  return snippet;
}

/** Selected text becomes the caption; without a selection the cursor lands there. */
function appendAlt(snippet: vscode.SnippetString, altText: string): void {
  if (altText) {
    snippet.appendText(altText);
  } else {
    snippet.appendTabstop(1);
  }
}

function withProgress<T>(title: string, work: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Paste Image: ${title}` },
    work,
  );
}
