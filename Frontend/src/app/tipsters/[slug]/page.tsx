import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, BarChart3, CalendarCheck2 } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    description: profile.biography ?? `View ${profile.displayName}'s verified South African racing profile and settled winner strike rate.`,
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
      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        <Card className="border-brand-gold/30 bg-brand-purple-deep text-white">
          <CardContent className="grid gap-8 p-7 lg:grid-cols-[1fr_auto] lg:items-center">
            <div><Badge className="bg-brand-gold text-brand-purple-deep"><BadgeCheck className="size-3" />Verified tipster</Badge><h1 className="mt-5 font-heading text-4xl">{profile.displayName}</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-white/72">{profile.biography || "Verified South African horse-racing tipster."}</p></div>
            <div className="grid min-w-64 grid-cols-2 gap-3"><div className="rounded-lg border border-white/12 bg-white/8 p-4"><p className="text-xs text-white/62">Winner strike rate</p><p className="mt-1 font-mono text-2xl font-bold">{profile.winnerStrikeRate === null ? "—" : `${Number(profile.winnerStrikeRate).toFixed(1)}%`}</p></div><div className="rounded-lg border border-white/12 bg-white/8 p-4"><p className="text-xs text-white/62">Settled tips</p><p className="mt-1 font-mono text-2xl font-bold">{profile.settledWinnerTips}</p></div></div>
          </CardContent>
        </Card>
        <div className="grid gap-5 md:grid-cols-2">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="size-5 text-brand-cyan" />Transparent records</CardTitle><CardDescription>Only officially resulted winner selections contribute to the displayed strike rate.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Verified winner hits: {profile.winnerHits}. ROI is withheld until authoritative dividends support a reliable calculation.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarCheck2 className="size-5 text-brand-gold" />View live offers</CardTitle><CardDescription>Meeting cards, purchases, subscriptions, and favourites remain live account features.</CardDescription></CardHeader><CardContent><Button asChild><Link href={`/tipsters/profile/?tipster=${profile.id}`}>Open interactive profile</Link></Button></CardContent></Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
