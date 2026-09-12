import type { Metadata } from "next";
import { PublicRaceMeetingQueryClient } from "@/components/racing/public-race-meeting-query-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { privatePageMetadata } from "@/lib/metadata";

export const metadata: Metadata = privatePageMetadata;

export default function LiveRaceMeetingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PublicRaceMeetingQueryClient />
      </main>
      <SiteFooter />
    </div>
  );
}
