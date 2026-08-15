import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collapseWhitespace,
  encodeLinkPath,
  escapeHtmlAttribute,
  escapeMarkdownAltText,
  isInside,
  relativeLink,
  workspaceAbsoluteLink,
} from "../pasteImage/format";

test("encodeLinkPath escapes what would end a markdown destination early", () => {
  assert.equal(encodeLinkPath("./Screenshot (1).png"), "./Screenshot%20%281%29.png");
  assert.equal(encodeLinkPath("./note#2.png"), "./note%232.png");
  assert.equal(encodeLinkPath("./a?b.png"), "./a%3Fb.png");
  assert.equal(encodeLinkPath("./[draft].png"), "./%5Bdraft%5D.png");
  assert.equal(encodeLinkPath("./tom&jerry.png"), "./tom%26jerry.png");
});

test("encodeLinkPath leaves an already-safe path alone", () => {
  assert.equal(encodeLinkPath("./images/login-form.png"), "./images/login-form.png");
  assert.equal(encodeLinkPath("../assets/a.b.c.png"), "../assets/a.b.c.png");
});

test("encodeLinkPath does not double-encode its own output", () => {
  const once = encodeLinkPath("./100% (final).png");
  assert.equal(once, "./100%25%20%28final%29.png");
  assert.equal(decodeURIComponent(once), "./100% (final).png");
});

test("encodeLinkPath output is safe inside an HTML attribute", () => {
  const link = encodeLinkPath('./weird <"&(#>.png');
  assert.equal(/["<>&]/.test(link), false);
});

test("relativeLink always carries a ./ or ../ prefix", () => {
  assert.equal(relativeLink("/w/docs", "/w/docs/a.png"), "./a.png");
  assert.equal(relativeLink("/w/docs", "/w/docs/img/a.png"), "./img/a.png");
  assert.equal(relativeLink("/w/docs", "/w/assets/a.png"), "../assets/a.png");
});

test("workspaceAbsoluteLink is rooted at the workspace", () => {
  assert.equal(workspaceAbsoluteLink("/w", "/w/assets/img/a.png"), "/assets/img/a.png");
  assert.equal(workspaceAbsoluteLink("/w", "/w/a (1).png"), "/a%20%281%29.png");
});

test("isInside accepts the root itself and anything under it", () => {
  assert.equal(isInside("/w", "/w"), true);
  assert.equal(isInside("/w", "/w/a/b.png"), true);
});

test("isInside rejects siblings and parents", () => {
  assert.equal(isInside("/w", "/other/a.png"), false);
  assert.equal(isInside("/w", "/"), false);
  // A prefix match on the string is not containment.
  assert.equal(isInside("/w", "/workspace2/a.png"), false);
});

test("collapseWhitespace flattens a multi-line selection to one line", () => {
  assert.equal(collapseWhitespace("  the login\n  form  "), "the login form");
  assert.equal(collapseWhitespace("a\t\tb"), "a b");
  assert.equal(collapseWhitespace("   "), "");
});

test("escapeMarkdownAltText keeps brackets from ending the caption", () => {
  assert.equal(escapeMarkdownAltText("see [fig 1]"), "see \\[fig 1\\]");
  assert.equal(escapeMarkdownAltText("a] b"), "a\\] b");
  assert.equal(escapeMarkdownAltText("back\\slash"), "back\\\\slash");
  assert.equal(escapeMarkdownAltText("plain caption"), "plain caption");
});

test("escapeHtmlAttribute keeps a quote from closing the attribute", () => {
  assert.equal(escapeHtmlAttribute('the "login" form'), "the &quot;login&quot; form");
  assert.equal(escapeHtmlAttribute("a & b"), "a &amp; b");
  assert.equal(escapeHtmlAttribute("<b>"), "&lt;b&gt;");
});

test("escapeHtmlAttribute escapes the ampersand it introduces only once", () => {
  assert.equal(escapeHtmlAttribute('&"'), "&amp;&quot;");
});
