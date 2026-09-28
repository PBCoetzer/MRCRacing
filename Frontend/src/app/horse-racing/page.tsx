import type { Metadata } from "next";
import { HorseRacingIndexClient } from "@/components/racing/horse-racing-index-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { publicMetadata } from "@/lib/metadata";

export const metadata: Metadata = publicMetadata({ title: "South African Horse Racing Racecards and Results", description: "Browse factual South African horse-racing meetings with SAST race times, runners, jockeys, trainers, source timestamps, and official results.", path: "/horse-racing" });

export default function HorseRacingIndexPage() {
  return <div className="min-h-screen bg-background"><SiteHeader /><main className="site-container py-12"><p className="font-mono text-xs uppercase tracking-[0.22em] text-brand-cyan">Verified race feed</p><h1 className="mt-3 font-heading text-4xl text-white sm:text-5xl">South African racecards and results</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Factual meeting pages with South African Standard Time, source timestamps, runners, and recorded results refreshed from the live database.</p><div className="mt-10"><HorseRacingIndexClient /></div></main><SiteFooter /></div>;
}
