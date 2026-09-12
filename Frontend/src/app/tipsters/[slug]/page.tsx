import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TipsterProfileClient } from "@/components/tipsters/tipster-profile-client";
import { JsonLd } from "@/lib/json-ld";
import { canonicalSiteUrl, publicMetadata } from "@/lib/metadata";
import { getPublicManifest, getPublicTipsterProfile } from "@/lib/public-content";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const manifest = await getPublicManifest();
  return manifest.tipsters.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const profile = await getPublicTipsterProfile((await params).slug);
  if (!profile) return { robots: { index: false, follow: false } };
  return publicMetadata({
    title: `${profile.displayName} — Verified Horse Racing Tipster`,
    description: profile.biography ?? `View ${profile.displayName}'s verified South African racing profile and settled winner and place strike rates.`,
    path: `/tipsters/${profile.slug}`,
  });
}

export default async function PublicTipsterPage({ params }: PageProps) {
  const profile = await getPublicTipsterProfile((await params).slug);
  if (!profile) notFound();
  const profileUrl = `${canonicalSiteUrl}/tipsters/${profile.slug}/`;
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "Person", name: profile.displayName, description: profile.biography, url: profileUrl, knowsAbout: ["South African horse racing", "Race analysis"] },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Tipsters", item: `${canonicalSiteUrl}/tipsters/` }, { "@type": "ListItem", position: 2, name: profile.displayName, item: profileUrl }] },
      ]} />
      <TipsterProfileClient tipsterSlug={profile.slug} />
      <SiteFooter />
    </div>
  );
}
