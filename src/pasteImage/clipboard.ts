import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Screenshots are tiny; the cap only stops a stray huge file from eating memory. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const CLIPBOARD_TIMEOUT_MS = 20_000;

export interface ClipboardImage {
  /** Encoded image bytes, ready to be written to disk unchanged. */
  data: Buffer;
  /** Extension including the leading dot, e.g. `.png`. */
  extension: string;
  /** Base name the clipboard carried, when it held a file rather than a bitmap. */
  name?: string;
}

/** Extensions we accept when the clipboard holds a file instead of a bitmap. */
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

const MIME_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/bmp", ".bmp"],
  ["image/svg+xml", ".svg"],
];

/**
 * Reads an image off the system clipboard.
 *
 * Returns `undefined` when the clipboard holds no image; throws when the
 * clipboard could not be read at all (missing helper tool, timeout, ...).
 */
export async function readClipboardImage(): Promise<ClipboardImage | undefined> {
  // Under Remote-WSL the extension host is Linux but the clipboard belongs to
  // Windows, so the Windows reader is right in both cases.
  if (process.platform === "win32" || (await isWsl())) {
    return readWindowsClipboard();
  }
  if (process.platform === "linux") {
    return readLinuxClipboard();
  }
  throw new Error(`Pasting images is not supported on ${process.platform}.`);
}

/* -------------------------------------------------------------------------- */
/* Windows                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Emits a single compact JSON object on stdout describing the clipboard.
 *
 * The order matters. Explorer puts copied files on the clipboard as a file drop
 * list with no bitmap attached, so asking for an image first (what most paste
 * extensions do) silently reports an empty clipboard. Browsers and the Snipping
 * Tool additionally offer a real PNG next to the DIB; preferring it keeps
 * transparency, which `Clipboard.GetImage()` would flatten to black.
 */
const WINDOWS_CLIPBOARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Send-Result([hashtable]$Payload) {
  [Console]::Out.Write((ConvertTo-Json $Payload -Compress))
  exit 0
}

function Send-Image([byte[]]$Bytes, [string]$Extension, [string]$Name) {
  Send-Result @{
    kind = 'image'
    extension = $Extension
    name = $Name
    data = [Convert]::ToBase64String($Bytes)
  }
}

function Send-FileIfImage([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
  if (@(EXTENSIONS) -notcontains $extension) { return }
  Send-Image ([IO.File]::ReadAllBytes($Path)) $extension ([IO.Path]::GetFileNameWithoutExtension($Path))
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  # 1. Files copied in Explorer arrive as a drop list, never as a bitmap.
  if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
    foreach ($file in [Windows.Forms.Clipboard]::GetFileDropList()) { Send-FileIfImage $file }
  }

  $dataObject = [Windows.Forms.Clipboard]::GetDataObject()

  # 2. A real PNG, offered by browsers and the Snipping Tool. Keeps the alpha channel.
  if ($dataObject -and $dataObject.GetDataPresent('PNG')) {
    $source = $dataObject.GetData('PNG')
    if ($source -is [IO.Stream]) {
      $buffer = New-Object IO.MemoryStream
      $source.Position = 0
      $source.CopyTo($buffer)
      if ($buffer.Length -gt 0) { Send-Image $buffer.ToArray() '.png' '' }
    }
  }

  # 3. Plain bitmap: Print Screen, Office, older applications.
  if ([Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [Windows.Forms.Clipboard]::GetImage()
    if ($image) {
      $buffer = New-Object IO.MemoryStream
      $image.Save($buffer, [Drawing.Imaging.ImageFormat]::Png)
      Send-Image $buffer.ToArray() '.png' ''
    }
  }

  # 4. A copied path, e.g. from the Explorer address bar or a shell.
  if ([Windows.Forms.Clipboard]::ContainsText()) {
    Send-FileIfImage ([Windows.Forms.Clipboard]::GetText().Trim().Trim('"'))
  }

  Send-Result @{ kind = 'none' }
} catch {
  Send-Result @{ kind = 'error'; message = $_.Exception.Message }
}
`.replace("EXTENSIONS", IMAGE_EXTENSIONS.map((extension) => `'${extension}'`).join(","));

interface WindowsClipboardResult {
  kind: "image" | "none" | "error";
  extension?: string;
  name?: string;
  data?: string;
  message?: string;
}

async function readWindowsClipboard(): Promise<ClipboardImage | undefined> {
  // -EncodedCommand takes UTF-16LE base64 and sidesteps every quoting rule, plus
  // it means no script file to ship and no WSL path translation.
  const command = Buffer.from(WINDOWS_CLIPBOARD_SCRIPT, "utf16le").toString("base64");

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      await powershellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", command],
      {
        // Windows PowerShell 5.1 is STA by default, which System.Windows.Forms
        // clipboard access requires.
        cwd: await powershellWorkingDirectory(),
        timeout: CLIPBOARD_TIMEOUT_MS,
        maxBuffer: MAX_IMAGE_BYTES,
        windowsHide: true,
      },
    ));
  } catch (err) {
    throw new Error(`Could not read the Windows clipboard: ${describe(err)}`);
  }

  let result: WindowsClipboardResult;
  try {
    result = JSON.parse(stdout.trim()) as WindowsClipboardResult;
  } catch {
    throw new Error(`Unexpected clipboard reader output: ${stdout.slice(0, 200)}`);
  }

  if (result.kind === "error") {
    throw new Error(`Could not read the Windows clipboard: ${result.message ?? "unknown error"}`);
  }
  if (result.kind !== "image" || !result.data) {
    return undefined;
  }
  return {
    data: Buffer.from(result.data, "base64"),
    extension: result.extension || ".png",
    name: result.name || undefined,
  };
}

async function powershellPath(): Promise<string> {
  if (process.platform !== "win32") {
    return "powershell.exe"; // WSL resolves it through the interop PATH.
  }
  // Absolute path so a shadowed powershell.exe on PATH cannot be picked up.
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const absolute = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return (await exists(absolute)) ? absolute : "powershell.exe";
}

async function powershellWorkingDirectory(): Promise<string | undefined> {
  // Launching a Windows binary from a Linux cwd makes it warn about unsupported
  // UNC paths and fall back to C:\Windows. Point it somewhere valid instead.
  if (process.platform === "win32") {
    return undefined;
  }
  return (await exists("/mnt/c")) ? "/mnt/c" : undefined;
}

/* -------------------------------------------------------------------------- */
/* Linux (native X11 / Wayland session, not WSL)                               */
/* -------------------------------------------------------------------------- */

interface LinuxClipboardTool {
  name: string;
  listTargets: () => Promise<string[]>;
  read: (target: string) => Promise<Buffer>;
}

async function readLinuxClipboard(): Promise<ClipboardImage | undefined> {
  const tool = await pickLinuxTool();
  const targets = await tool.listTargets();

  for (const [mime, extension] of MIME_EXTENSIONS) {
    if (targets.includes(mime)) {
      return { data: await tool.read(mime), extension };
    }
  }

  // File managers copy files as a URI list rather than as pixels.
  const uriTarget = targets.find(
    (target) => target === "text/uri-list" || target === "x-special/gnome-copied-files",
  );
  if (uriTarget) {
    const file = firstImagePath((await tool.read(uriTarget)).toString("utf8"));
    if (file) {
      return {
        data: await fs.readFile(file),
        extension: path.extname(file).toLowerCase(),
        name: path.basename(file, path.extname(file)),
      };
    }
  }

  return undefined;
}

async function pickLinuxTool(): Promise<LinuxClipboardTool> {
  const run = async (command: string, args: string[]): Promise<Buffer> => {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "buffer",
      timeout: CLIPBOARD_TIMEOUT_MS,
      maxBuffer: MAX_IMAGE_BYTES,
    });
    return stdout;
  };

  if (process.env.WAYLAND_DISPLAY && (await hasCommand("wl-paste"))) {
    return {
      name: "wl-paste",
      listTargets: async () => splitLines((await run("wl-paste", ["--list-types"])).toString("utf8")),
      read: (target) => run("wl-paste", ["--no-newline", "--type", target]),
    };
  }

  if (await hasCommand("xclip")) {
    const selection = ["-selection", "clipboard"];
    return {
      name: "xclip",
      listTargets: async () =>
        splitLines((await run("xclip", [...selection, "-t", "TARGETS", "-o"])).toString("utf8")),
      read: (target) => run("xclip", [...selection, "-t", target, "-o"]),
    };
  }

  throw new Error(
    "No clipboard helper found. Install `wl-clipboard` (Wayland) or `xclip` (X11) to paste images.",
  );
}

/** Picks the first `file://` URI pointing at an image; ignores the leading `copy` line GNOME adds. */
function firstImagePath(payload: string): string | undefined {
  for (const line of splitLines(payload)) {
    if (!line.startsWith("file://")) {
      continue;
    }
    let file: string;
    try {
      file = decodeURIComponent(line.slice("file://".length));
    } catch {
      continue;
    }
    if (IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
      return file;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

let wslDetection: Promise<boolean> | undefined;

function isWsl(): Promise<boolean> {
  wslDetection ??= detectWsl();
  return wslDetection;
}

async function detectWsl(): Promise<boolean> {
  if (process.platform !== "linux") {
    return false;
  }
  if (process.env.WSL_DISTRO_NAME) {
    return true;
  }
  try {
    return /microsoft/i.test(await fs.readFile("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
