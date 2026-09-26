import { buildBlogAnnouncementContent } from "./blog-email.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("builds a direct blog announcement with preference controls", () => {
  const content = buildBlogAnnouncementContent({
    blogTitle: "Fairview analysis",
    blogExcerpt: "A detailed preview of the meeting.",
    blogUrl: "https://www.mrcracing.co.za/blog/fairview-analysis/",
    authorName: "GJ",
    preferenceUrl: "https://www.mrcracing.co.za/client/#email-announcements",
  });

  assert(
    content.subject === "New MRC Journal article: Fairview analysis",
    "subject should identify the article",
  );
  assert(
    content.actionUrl.endsWith("/blog/fairview-analysis/"),
    "action should open the article directly",
  );
  assert(
    content.body.includes("Manage your email preferences"),
    "email should explain how to manage announcements",
  );
});

Deno.test("escapes author-provided blog text in email HTML", () => {
  const content = buildBlogAnnouncementContent({
    blogTitle: "<img src=x onerror=alert(1)>",
    blogExcerpt: "<script>alert(1)</script>",
    authorName: "<b>Unsafe</b>",
  });

  assert(!content.body.includes("<script>"), "script markup must be escaped");
  assert(!content.body.includes("<img"), "image markup must be escaped");
  assert(!content.body.includes("<b>Unsafe</b>"), "author markup must be escaped");
  assert(content.body.includes("&lt;script&gt;"), "escaped content is missing");
});
