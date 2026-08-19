import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicRaceMeetingLive } from "@/components/racing/public-race-meeting-live";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { JsonLd } from "@/lib/json-ld";
import { canonicalSiteUrl, publicMetadata } from "@/lib/metadata";
import { getPublicManifest, getPublicRaceMeeting } from "@/lib/public-content";

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
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PublicRaceMeetingLive initialMeeting={meeting} />
      </main>
      <SiteFooter />
    </div>
  );
}
