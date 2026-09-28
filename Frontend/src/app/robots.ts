import type { MetadataRoute } from "next";
import { canonicalSiteUrl, isNonProductionDeployment } from "@/lib/metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (isNonProductionDeployment) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      host: canonicalSiteUrl,
    };
  }

  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/account/", "/admin/", "/client/", "/tipster/", "/auth/", "/login/", "/register/", "/forgot-password/", "/reset-password/", "/payment-status/"],
    }],
    sitemap: `${canonicalSiteUrl}/sitemap.xml`,
    host: canonicalSiteUrl,
  };
}
