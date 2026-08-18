import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { publicMetadata } from "@/lib/metadata";
import { getPublicManifest, getPublicRaceMeeting } from "@/lib/public-content";

export const metadata: Metadata = publicMetadata({ title: "South African Horse Racing Racecards and Results", description: "Browse factual South African horse-racing meetings with SAST race times, runners, jockeys, trainers, source timestamps, and official results.", path: "/horse-racing" });

function formatDate(value: string) { return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date(`${value}T12:00:00+02:00`)); }

export default async function HorseRacingIndexPage() {
  const manifest = await getPublicManifest();
  const meetings = (await Promise.all(manifest.meetings.map((item) => getPublicRaceMeeting(item.venueSlug, item.meetingDate)))).filter((meeting) => meeting !== null);
  return <div className="min-h-screen bg-background"><SiteHeader /><main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"><p className="font-mono text-xs uppercase tracking-[0.22em] text-brand-cyan">Verified race feed</p><h1 className="mt-3 font-heading text-4xl text-white sm:text-5xl">South African racecards and results</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Factual meeting pages with South African Standard Time, source timestamps, runners, and recorded results. Betting markets are not reproduced.</p><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{meetings.map((meeting) => <Link key={meeting.id} href={`/horse-racing/${meeting.venueSlug}/${meeting.meetingDate}/`} className="group"><Card className="h-full transition group-hover:border-brand-gold/60"><CardHeader><div className="flex items-center justify-between gap-3"><Badge>{meeting.status.replaceAll("_", " ")}</Badge><span className="text-xs text-muted-foreground">{meeting.races.length} races</span></div><CardTitle className="flex items-center gap-2"><MapPin className="size-5 text-brand-gold" />{meeting.venue}</CardTitle></CardHeader><CardContent><p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-4 text-brand-cyan" />{formatDate(meeting.meetingDate)}</p></CardContent></Card></Link>)}</div></main><SiteFooter /></div>;
}
