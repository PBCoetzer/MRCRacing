import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TipsterProfileClient } from "@/components/tipsters/tipster-profile-client";

export default function TipsterProfilePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <TipsterProfileClient />
      <SiteFooter />
    </div>
  );
}
