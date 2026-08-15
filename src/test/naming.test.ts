import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import {
  checkFileName,
  freePath,
  hasImageExtension,
  normalizeFileName,
  slug,
  suggestFileName,
  timestamp,
} from "../pasteImage/naming";

/* -------------------------------------------------------------------------- */
/* slug / timestamp / suggestFileName                                          */
/* -------------------------------------------------------------------------- */

test("slug folds umlauts and accents rather than dropping them", () => {
  assert.equal(slug("Größenänderung"), "groessenaenderung");
  assert.equal(slug("Übersicht"), "uebersicht");
  assert.equal(slug("café"), "cafe");
});

test("slug collapses punctuation and trims the result", () => {
  assert.equal(slug("The Login Form!"), "the-login-form");
  assert.equal(slug("  --a--b--  "), "a-b");
  assert.equal(slug("!!!"), "");
  assert.equal(slug(""), "");
});

test("slug caps the length", () => {
  assert.equal(slug("a".repeat(200)).length, 60);
});

test("timestamp pads every field", () => {
  assert.equal(timestamp(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02-03-04-05");
});

test("suggestFileName prefers the copied file's name, then the selection", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(
    suggestFileName({ extension: ".jpg", name: "Holiday Photo" }, "ignored", now),
    "holiday-photo.jpg",
  );
  assert.equal(suggestFileName({ extension: ".png" }, "Login form", now), "login-form.png");
  assert.equal(suggestFileName({ extension: ".png" }, "", now), "2026-01-02-03-04-05.png");
});

test("suggestFileName falls back to the timestamp when both slugs are empty", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(suggestFileName({ extension: ".png", name: "###" }, "!!!", now), "2026-01-02-03-04-05.png");
});

/* -------------------------------------------------------------------------- */
/* checkFileName                                                               */
/* -------------------------------------------------------------------------- */

test("checkFileName accepts a plain name and a subfolder", () => {
  assert.equal(checkFileName("login.png"), undefined);
  assert.equal(checkFileName("shots/login.png"), undefined);
  assert.equal(checkFileName("  login.png  "), undefined);
});

test("checkFileName rejects an empty name", () => {
  assert.equal(checkFileName("")?.severity, "error");
  assert.equal(checkFileName("   ")?.severity, "error");
});

test("checkFileName rejects anything that leaves the target folder", () => {
  for (const name of ["/etc/passwd", "../x.png", "a/../../x.png", "C:/Windows/x.png", "..\\x.png"]) {
    assert.equal(checkFileName(name)?.severity, "error", name);
  }
});

test("checkFileName rejects a drive letter regardless of host platform", () => {
  // path.isAbsolute is platform dependent; the check must not be.
  assert.equal(checkFileName("C:x.png")?.severity, "error");
});

test("checkFileName rejects characters Windows refuses", () => {
  for (const name of ['a"b.png', "a<b.png", "a|b.png", "a?b.png", "a*b.png", "a\u0001b.png"]) {
    assert.equal(checkFileName(name)?.severity, "error", name);
  }
});

test("checkFileName only warns about spaces", () => {
  assert.equal(checkFileName("login form.png")?.severity, "warning");
});

/* -------------------------------------------------------------------------- */
/* normalizeFileName                                                           */
/* -------------------------------------------------------------------------- */

test("normalizeFileName appends the clipboard extension when there is none", () => {
  assert.equal(normalizeFileName("login", ".png"), "login.png");
  assert.equal(normalizeFileName("  login  ", ".png"), "login.png");
});

test("normalizeFileName does not mistake a version suffix for an extension", () => {
  assert.equal(normalizeFileName("figure-3.1", ".png"), "figure-3.1.png");
  assert.equal(normalizeFileName("v1.2", ".png"), "v1.2.png");
  assert.equal(normalizeFileName("my.image", ".png"), "my.image.png");
});

test("normalizeFileName keeps an extension the user chose deliberately", () => {
  assert.equal(normalizeFileName("login.jpg", ".png"), "login.jpg");
  assert.equal(normalizeFileName("login.PNG", ".png"), "login.PNG");
  assert.equal(normalizeFileName("shots/login.webp", ".png"), "shots/login.webp");
});

test("normalizeFileName normalizes backslashes to forward slashes", () => {
  assert.equal(normalizeFileName("shots\\login", ".png"), "shots/login.png");
});

test("hasImageExtension is case insensitive and rejects non-images", () => {
  assert.equal(hasImageExtension("a.JPEG"), true);
  assert.equal(hasImageExtension("a.txt"), false);
  assert.equal(hasImageExtension("a"), false);
});

/* -------------------------------------------------------------------------- */
/* freePath                                                                    */
/* -------------------------------------------------------------------------- */

// Synchronous: the emitted test module is CommonJS, so no top-level await.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "paste-image-test-"));
after(() => fs.rm(tmpDir, { recursive: true, force: true }));

test("freePath returns the name unchanged when nothing is there", async () => {
  const target = path.join(tmpDir, "free.png");
  assert.equal(await freePath(target), target);
});

test("freePath counts up past every taken name, keeping the extension last", async () => {
  await fs.writeFile(path.join(tmpDir, "taken.png"), "");
  assert.equal(await freePath(path.join(tmpDir, "taken.png")), path.join(tmpDir, "taken-2.png"));

  await fs.writeFile(path.join(tmpDir, "taken-2.png"), "");
  assert.equal(await freePath(path.join(tmpDir, "taken.png")), path.join(tmpDir, "taken-3.png"));
});
