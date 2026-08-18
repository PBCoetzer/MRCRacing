import type { MetadataRoute } from "next";
import { canonicalSiteUrl } from "@/lib/metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/client/", "/tipster/", "/auth/", "/login/", "/register/", "/forgot-password/", "/reset-password/", "/payment-status/"],
    }],
    sitemap: `${canonicalSiteUrl}/sitemap.xml`,
    host: canonicalSiteUrl,
  };
}
