export type BlogAnnouncementPayload = {
  blogTitle?: string;
  blogExcerpt?: string;
  blogUrl?: string;
  authorName?: string;
  preferenceUrl?: string;
};

export type BlogAnnouncementContent = {
  subject: string;
  text: string;
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildBlogAnnouncementContent(
  payload: BlogAnnouncementPayload,
): BlogAnnouncementContent {
  const blogTitle = String(payload.blogTitle ?? "New MRC Journal article");
  const blogExcerpt = String(
    payload.blogExcerpt ?? "A new horse-racing analysis article is available.",
  );
  const authorName = String(payload.authorName ?? "MRC Racing Tips");
  const blogUrl = String(
    payload.blogUrl ?? "https://www.mrcracing.co.za/blog/",
  );
  const preferenceUrl = String(
    payload.preferenceUrl ??
      "https://www.mrcracing.co.za/client/#email-announcements",
  );

  return {
    subject: `New MRC Journal article: ${blogTitle}`,
    text: `${authorName} published “${blogTitle}”. ${blogExcerpt} Read it at ${blogUrl} Manage email announcement preferences at ${preferenceUrl}`,
    title: "A new MRC Journal article is available",
    body: `<p style="margin:0 0 14px"><strong>${
      escapeHtml(authorName)
    }</strong> published <strong>${escapeHtml(blogTitle)}</strong>.</p>` +
      `<p style="margin:0 0 14px">${escapeHtml(blogExcerpt)}</p>` +
      `<p style="margin:0;font-size:13px;color:#c4b5fd">You are receiving optional MRC email announcements. <a href="${
        escapeHtml(preferenceUrl)
      }" style="color:#22d3ee">Manage your email preferences</a>.</p>`,
    actionUrl: blogUrl,
    actionLabel: "Read the article",
  };
}
