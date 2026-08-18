import type { Metadata } from "next";

export const canonicalSiteUrl = "https://www.mrcracing.co.za";
export const siteName = "MRC Racing Tips";
export const defaultDescription =
  "South African horse-racing tips, verified tipster performance, factual racecards, results history, and responsible racing analysis.";
export const defaultShareImage = "/images/mrc-racing-og.png";

export function publicMetadata({
  title,
  description,
  path,
  image = defaultShareImage,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
}): Metadata {
  const canonical = path === "/" ? "/" : `${path.replace(/\/$/, "")}/`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "en_ZA",
      siteName,
      title,
      description,
      url: canonical,
      images: [{ url: image, width: 1200, height: 630, alt: `${title} — ${siteName}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export const privatePageMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};
