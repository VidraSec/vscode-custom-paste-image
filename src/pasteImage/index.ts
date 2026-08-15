import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readClipboardImage } from "./clipboard";
import {
  collapseWhitespace,
  escapeHtmlAttribute,
  escapeMarkdownAltText,
} from "./format";
import {
  checkFileName,
  freePath,
  normalizeFileName,
  suggestFileName,
  type NameProblem,
} from "./naming";
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
  const altText = collapseWhitespace(editor.document.getText(editor.selection));
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

/**
 * Asks for the name with the extension already appended but only the stem
 * selected, so typing replaces the name and keeps the format.
 */
async function askForFileName(suggestion: string, targetDir: string): Promise<string | undefined> {
  const extension = path.extname(suggestion);
  const stemLength = suggestion.length - extension.length;

  const answer = await vscode.window.showInputBox({
    title: "Paste Image",
    prompt: `Saved into ${targetDir}`,
    value: suggestion,
    valueSelection: [0, stemLength],
    validateInput: (value) => validateFileName(value, targetDir, extension),
  });

  return answer === undefined ? undefined : normalizeFileName(answer, extension);
}

async function validateFileName(
  value: string,
  targetDir: string,
  fallbackExtension: string,
): Promise<vscode.InputBoxValidationMessage | undefined> {
  const problem = checkFileName(value);
  if (problem?.severity === "error") {
    return toValidationMessage(problem);
  }
  // Checked against the name that will actually be written, extension and all,
  // and reported ahead of any style warning — losing a file matters more.
  if (await exists(path.join(targetDir, normalizeFileName(value, fallbackExtension)))) {
    return toValidationMessage({
      severity: "warning",
      message: "A file with this name exists and will be overwritten.",
    });
  }
  return problem && toValidationMessage(problem);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function toValidationMessage(problem: NameProblem): vscode.InputBoxValidationMessage {
  return {
    message: problem.message,
    severity:
      problem.severity === "error"
        ? vscode.InputBoxValidationSeverity.Error
        : vscode.InputBoxValidationSeverity.Warning,
  };
}

/* -------------------------------------------------------------------------- */
/* Snippet                                                                     */
/* -------------------------------------------------------------------------- */

function buildSnippet(format: SnippetFormat, link: string, altText: string): vscode.SnippetString {
  const snippet = new vscode.SnippetString();

  if (format === "html") {
    snippet.appendText(`<img src="${link}" alt="`);
    appendAlt(snippet, escapeHtmlAttribute(altText));
    snippet.appendText('" width="');
    snippet.appendPlaceholder("50%");
    snippet.appendText('">');
  } else {
    snippet.appendText("![");
    appendAlt(snippet, escapeMarkdownAltText(altText));
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
