import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";
import { professionalSourceName, publicSourceUrl } from "@/lib/racing/source-brand";

export type PublicManifest = {
  generatedAt: string;
  blogPosts: { slug: string; lastModified: string }[];
  tipsters: { slug: string; lastModified: string }[];
  meetings: { venueSlug: string; meetingDate: string; lastModified: string }[];
};

export type PublicBlogArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  coverImagePath: string | null;
  publishedAt: string;
  updatedAt: string;
  author: string;
  authorSlug: string;
  authorPhotoPath: string | null;
};

export type PublicTipsterProfile = {
  id: string;
  slug: string;
  displayName: string;
  biography: string | null;
  photoPath: string | null;
  ranking: number | null;
  winnerStrikeRate: number | null;
  settledWinnerTips: number;
  winnerHits: number;
  statsUpdatedAt: string | null;
  updatedAt: string;
};

export type PublicRaceRunner = {
  saddleNumber: number;
  horseName: string;
  jockeyName: string | null;
  trainerName: string | null;
  draw: number | null;
  carriedWeight: number | null;
  status: string;
  resultPosition: number | null;
  sourceUpdatedAt: string | null;
};

export type PublicRace = {
  id: string;
  raceNumber: number | null;
  title: string;
  startsAt: string;
  status: string;
  distanceMetres: number | null;
  raceClass: string | null;
  resultSummary: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  runners: PublicRaceRunner[];
};

export type PublicRaceMeeting = {
  id: string;
  venue: string;
  venueSlug: string;
  countryCode: string;
  meetingDate: string;
  firstRaceAt: string;
  lastRaceAt: string | null;
  status: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  updatedAt: string;
  races: PublicRace[];
};

export function publicStorageUrl(bucket: string, path: string | null) {
  return path ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}` : null;
}

export async function publicRpc<T>(name: string, body: Record<string, unknown> = {}) {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Public Supabase build credentials are not configured.");
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: supabasePublishableKey,
      authorization: `Bearer ${supabasePublishableKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`Public content request failed (${response.status}).`);
  return await response.json() as T;
}

export const getPublicManifest = () => publicRpc<PublicManifest>("get_public_build_manifest");
export const getPublicBlogArticle = (slug: string) =>
  publicRpc<PublicBlogArticle | null>("get_public_blog_article", { p_slug: slug });
export const getPublicTipsterProfile = (slug: string) =>
  publicRpc<PublicTipsterProfile | null>("get_public_tipster_profile", { p_slug: slug });
export async function getPublicRaceMeeting(venueSlug: string, meetingDate: string) {
  const meeting = await publicRpc<PublicRaceMeeting | null>("get_public_race_meeting", {
    p_venue_slug: venueSlug,
    p_meeting_date: meetingDate,
  });

  if (!meeting) return null;

  return {
    ...meeting,
    sourceName: professionalSourceName(meeting.sourceName),
    sourceUrl: publicSourceUrl(meeting.sourceName, meeting.sourceUrl),
    races: meeting.races.map((race) => ({
      ...race,
      sourceName: professionalSourceName(race.sourceName),
      sourceUrl: publicSourceUrl(race.sourceName, race.sourceUrl),
    })),
  };
}
