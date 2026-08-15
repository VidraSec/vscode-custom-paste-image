import * as vscode from "vscode";
import { pasteImage } from "./pasteImage";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Paste Image", { log: true });
  context.subscriptions.push(log);
  log.info(`Activated version ${context.extension.packageJSON.version}.`);

  context.subscriptions.push(
    vscode.commands.registerCommand("customPasteImage.paste", async () => {
      try {
        await pasteImage(log);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Paste image failed: ${message}`);
        vscode.window.showErrorMessage(`Paste Image: ${message}`);
      }
    }),
  );
}

export function deactivate(): void {
  // nothing to tear down
}
