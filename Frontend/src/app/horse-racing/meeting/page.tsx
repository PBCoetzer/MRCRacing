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
      <main className="site-container py-12">
        <PublicRaceMeetingQueryClient />
      </main>
      <SiteFooter />
    </div>
  );
}
