import type { MetadataRoute } from "next";
import { canonicalSiteUrl } from "@/lib/metadata";
import { getPublicManifest } from "@/lib/public-content";

export const dynamic = "force-static";

const publicRoutes = ["", "/about", "/blog", "/cancellation-policy", "/contact", "/faq", "/horse-care", "/horse-racing", "/pricing", "/privacy", "/refund-policy", "/responsible-gambling", "/terms", "/tipsters"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const manifest = await getPublicManifest();
  const staticEntries = publicRoutes.map((path) => ({
    url: `${canonicalSiteUrl}${path || "/"}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "daily" as const : "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  return [
    ...staticEntries,
    ...manifest.blogPosts.map((post) => ({ url: `${canonicalSiteUrl}/blog/${post.slug}/`, lastModified: post.lastModified, changeFrequency: "weekly" as const, priority: 0.75 })),
    ...manifest.tipsters.map((tipster) => ({ url: `${canonicalSiteUrl}/tipsters/${tipster.slug}/`, lastModified: tipster.lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...manifest.meetings.map((meeting) => ({ url: `${canonicalSiteUrl}/horse-racing/${meeting.venueSlug}/${meeting.meetingDate}/`, lastModified: meeting.lastModified, changeFrequency: "daily" as const, priority: 0.65 })),
  ];
}
