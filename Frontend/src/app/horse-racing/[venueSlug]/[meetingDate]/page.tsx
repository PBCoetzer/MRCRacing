import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock3, ExternalLink, Flag, Trophy } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonLd } from "@/lib/json-ld";
import { canonicalSiteUrl, publicMetadata } from "@/lib/metadata";
import { getPublicManifest, getPublicRaceMeeting } from "@/lib/public-content";
import { professionalSourceName, publicSourceUrl } from "@/lib/racing/source-brand";

type PageProps = { params: Promise<{ venueSlug: string; meetingDate: string }> };

export async function generateStaticParams() {
  const manifest = await getPublicManifest();
  return manifest.meetings.map(({ venueSlug, meetingDate }) => ({ venueSlug, meetingDate }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { venueSlug, meetingDate } = await params;
  const meeting = await getPublicRaceMeeting(venueSlug, meetingDate);
  if (!meeting) return { robots: { index: false, follow: false } };
  return publicMetadata({ title: `${meeting.venue} Racecard and Results — ${formatDate(meeting.meetingDate)}`, description: `Factual ${meeting.venue} horse-racing racecard, runners, scheduled SAST times, official results, and source updates for ${formatDate(meeting.meetingDate)}.`, path: `/horse-racing/${meeting.venueSlug}/${meeting.meetingDate}` });
}

function formatDate(value: string) { return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date(`${value}T12:00:00+02:00`)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(new Date(value)); }

export default async function RaceMeetingPage({ params }: PageProps) {
  const { venueSlug, meetingDate } = await params;
  const meeting = await getPublicRaceMeeting(venueSlug, meetingDate);
  if (!meeting) notFound();
  const pageUrl = `${canonicalSiteUrl}/horse-racing/${meeting.venueSlug}/${meeting.meetingDate}/`;
  const eventStatus = meeting.status === "cancelled" || meeting.status === "abandoned" ? "https://schema.org/EventCancelled" : meeting.status === "completed" ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled";
  return (
    <div className="min-h-screen bg-background"><SiteHeader />
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "SportsEvent", name: `${meeting.venue} horse racing meeting`, startDate: meeting.firstRaceAt, endDate: meeting.lastRaceAt ?? undefined, eventStatus, eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", location: { "@type": "Place", name: meeting.venue, address: { "@type": "PostalAddress", addressCountry: "ZA" } }, url: pageUrl, sport: "Horse racing" },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Horse racing", item: `${canonicalSiteUrl}/horse-racing/` }, { "@type": "ListItem", position: 2, name: `${meeting.venue} ${meeting.meetingDate}`, item: pageUrl }] },
      ]} />
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"><Badge>{meeting.status.replaceAll("_", " ")}</Badge><h1 className="mt-4 font-heading text-4xl text-white sm:text-5xl">{meeting.venue} racecard and results</h1><p className="mt-3 text-lg text-muted-foreground">{formatDate(meeting.meetingDate)} · All displayed times are South African Standard Time (SAST).</p>
        <div className="mt-8 space-y-6">{meeting.races.map((race) => <Card key={race.id} className="border-brand-gold/20"><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Race {race.raceNumber ?? "—"}</Badge><Badge variant="secondary"><Clock3 className="size-3" />{formatTime(race.startsAt)} SAST</Badge></div><CardTitle>{race.title}</CardTitle><CardDescription>{[race.distanceMetres ? `${race.distanceMetres}m` : null, race.raceClass, race.status].filter(Boolean).join(" · ")}</CardDescription></CardHeader><CardContent>
          {race.resultSummary ? <p className="mb-4 rounded-lg border border-brand-cyan/25 bg-brand-cyan/8 p-3 text-sm"><Trophy className="mr-2 inline size-4 text-brand-cyan" />{race.resultSummary}</p> : null}
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-muted-foreground"><tr><th className="p-2">Pos.</th><th className="p-2">No.</th><th className="p-2">Horse</th><th className="p-2">Jockey</th><th className="p-2">Trainer</th><th className="p-2">Draw</th><th className="p-2">Weight</th><th className="p-2">Status</th></tr></thead><tbody>{race.runners.map((runner) => <tr key={`${race.id}-${runner.saddleNumber}`} className="border-b border-border/50"><td className="p-2 font-mono">{runner.resultPosition ?? "—"}</td><td className="p-2">{runner.saddleNumber}</td><td className="p-2 font-semibold text-white">{runner.horseName}</td><td className="p-2">{runner.jockeyName ?? "—"}</td><td className="p-2">{runner.trainerName ?? "—"}</td><td className="p-2">{runner.draw ?? "—"}</td><td className="p-2">{runner.carriedWeight ? `${runner.carriedWeight} kg` : "—"}</td><td className="p-2">{runner.status}</td></tr>)}</tbody></table></div>
          <p className="mt-4 text-xs text-muted-foreground">
            Verified by{" "}
            {publicSourceUrl(race.sourceName, race.sourceUrl) ? (
              <Link href={publicSourceUrl(race.sourceName, race.sourceUrl) ?? "#"} target="_blank" rel="noreferrer" className="text-brand-cyan underline">
                {professionalSourceName(race.sourceName)}
                <ExternalLink className="ml-1 inline size-3" />
              </Link>
            ) : professionalSourceName(race.sourceName)}
            {race.sourceUpdatedAt ? ` · Updated ${new Date(race.sourceUpdatedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}` : ""}
          </p>
        </CardContent></Card>)}</div>
        <Card className="mt-8"><CardHeader><CardTitle className="flex items-center gap-2"><Flag className="size-5 text-brand-gold" />Responsible racing information</CardTitle></CardHeader><CardContent className="text-sm leading-7 text-muted-foreground">This page presents factual race and result information, not guaranteed outcomes. MRC Racing Tips does not accept bets. If you choose to gamble, be 18+, set limits, and never chase losses.</CardContent></Card>
      </main><SiteFooter /></div>
  );
}
