import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TipsterDirectoryClient } from "@/components/tipsters/tipster-directory-client";

export default function TipstersPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <TipsterDirectoryClient />
      <SiteFooter />
    </div>
  );
}
