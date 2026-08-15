import assert from "node:assert/strict";
import { test } from "node:test";
import { firstImagePath, WINDOWS_CLIPBOARD_SCRIPT } from "../pasteImage/clipboard";
import { IMAGE_EXTENSIONS } from "../pasteImage/naming";

test("firstImagePath skips the leading verb GNOME puts on the clipboard", () => {
  assert.equal(
    firstImagePath("copy\nfile:///home/u/pictures/shot.png"),
    "/home/u/pictures/shot.png",
  );
});

test("firstImagePath decodes percent escapes", () => {
  assert.equal(firstImagePath("file:///home/u/my%20shot%20(1).png"), "/home/u/my shot (1).png");
});

test("firstImagePath picks the first image out of a mixed list", () => {
  const payload = ["file:///home/u/notes.txt", "file:///home/u/a.webp", "file:///home/u/b.png"].join(
    "\r\n",
  );
  assert.equal(firstImagePath(payload), "/home/u/a.webp");
});

test("firstImagePath ignores non-image and non-file entries", () => {
  assert.equal(firstImagePath("file:///home/u/notes.txt"), undefined);
  assert.equal(firstImagePath("https://example.com/a.png"), undefined);
  assert.equal(firstImagePath(""), undefined);
});

test("firstImagePath matches the extension case insensitively", () => {
  assert.equal(firstImagePath("file:///home/u/SHOT.PNG"), "/home/u/SHOT.PNG");
});

test("firstImagePath survives a malformed escape instead of throwing", () => {
  assert.equal(firstImagePath("file:///home/u/bad%ZZ.png\nfile:///home/u/ok.png"), "/home/u/ok.png");
});

/* -------------------------------------------------------------------------- */
/* Windows reader script                                                       */
/* -------------------------------------------------------------------------- */

test("every placeholder in the PowerShell script is substituted", () => {
  assert.equal(/__[A-Z_]+__/.test(WINDOWS_CLIPBOARD_SCRIPT), false);
});

test("the PowerShell script carries the full extension list", () => {
  for (const extension of IMAGE_EXTENSIONS) {
    assert.ok(WINDOWS_CLIPBOARD_SCRIPT.includes(`'${extension}'`), extension);
  }
});

test("the PowerShell script encodes to UTF-16LE base64 without surprises", () => {
  // -EncodedCommand only accepts UTF-16LE; a mismatch here is silent breakage.
  const encoded = Buffer.from(WINDOWS_CLIPBOARD_SCRIPT, "utf16le").toString("base64");
  assert.equal(Buffer.from(encoded, "base64").toString("utf16le"), WINDOWS_CLIPBOARD_SCRIPT);
});
