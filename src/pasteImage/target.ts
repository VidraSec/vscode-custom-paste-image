import * as path from "node:path";
import * as vscode from "vscode";
import { isInside, relativeLink, workspaceAbsoluteLink } from "./format";

/**
 * Where to save a pasted image and how to link it, driven entirely by
 * settings. No assumptions about the project's structure — this is what
 * makes the extension work in any markdown file, not just one kind of site.
 */

export type LinkStyle = "relative" | "workspaceAbsolute";

export interface PasteTarget {
  /** Directory the image gets written into. */
  dir: string;
  /** Turns an absolute path under `dir` into the link to insert. */
  toLink: (file: string) => string;
}

/**
 * Resolves the save directory and link style for `documentUri` from the
 * `customPasteImage.folder` / `customPasteImage.linkStyle` settings.
 *
 * `folder`:
 *  - empty (default) — save next to the edited file.
 *  - starts with `/` — relative to the workspace folder root, e.g. `/assets/img`.
 *  - anything else — relative to the edited file's directory, e.g. `images` or `../assets`.
 */
export function resolvePasteTarget(documentUri: vscode.Uri): PasteTarget | { error: string } {
  const config = vscode.workspace.getConfiguration("customPasteImage", documentUri);
  const folderSetting = config.get<string>("folder", "").trim();
  const linkStyle = config.get<LinkStyle>("linkStyle", "relative");
  const fileDir = path.dirname(documentUri.fsPath);

  let dir: string;
  if (!folderSetting) {
    dir = fileDir;
  } else if (folderSetting.startsWith("/") || folderSetting.startsWith("\\")) {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath;
    if (!workspaceRoot) {
      return {
        error: `customPasteImage.folder is set to "${folderSetting}", which is relative to the workspace root, but this file is not inside an open workspace folder.`,
      };
    }
    dir = path.join(workspaceRoot, folderSetting.slice(1));
  } else {
    dir = path.resolve(fileDir, folderSetting);
  }

  if (linkStyle === "workspaceAbsolute") {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath;
    if (workspaceRoot && isInside(workspaceRoot, dir)) {
      return { dir, toLink: (file) => workspaceAbsoluteLink(workspaceRoot, file) };
    }
    // Falls back to a relative link when the target isn't under a workspace
    // folder, since a workspace-root link would otherwise be meaningless.
  }
  return { dir, toLink: (file) => relativeLink(fileDir, file) };
}
