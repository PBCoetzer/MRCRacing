import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdownHorizontalRule, parseInlineMarkdown } from "./safe-markdown.ts";

test("parses safe bold, italic, combined emphasis, and HTTPS links", () => {
  assert.deepEqual(
    parseInlineMarkdown(
      "Use **Security**, *fresh codes*, ***extra protection***, and [Account Security](https://www.mrcracing.co.za/account/security/).",
    ),
    [
      { type: "text", value: "Use " },
      { type: "strong", value: "Security" },
      { type: "text", value: ", " },
      { type: "emphasis", value: "fresh codes" },
      { type: "text", value: ", " },
      { type: "strong-emphasis", value: "extra protection" },
      { type: "text", value: ", and " },
      {
        type: "link",
        value: "Account Security",
        href: "https://www.mrcracing.co.za/account/security/",
      },
      { type: "text", value: "." },
    ],
  );
});

test("leaves unsafe link schemes as escaped plain text", () => {
  assert.deepEqual(parseInlineMarkdown("[Open](javascript:alert(1))"), [
    { type: "text", value: "[Open](javascript:alert(1))" },
  ]);
});

test("recognizes supported Markdown horizontal dividers", () => {
  assert.equal(isMarkdownHorizontalRule("---"), true);
  assert.equal(isMarkdownHorizontalRule("***"), true);
  assert.equal(isMarkdownHorizontalRule("ordinary text"), false);
});
