import { DashboardShell } from "@/components/dashboard-shell";
import { TipsterDashboardClient } from "@/components/tipster/tipster-dashboard-client";
import { tipsterNav } from "@/components/tipster/tipster-nav";

export default function TipsterPage() {
  return (
    <DashboardShell
      allowedRoles={["tipster", "administrator"]}
      accessDescription="the tipster dashboard"
      accessTitle="Tipster access required"
      title="Tipster Dashboard"
      description="Your publishing, performance, earnings, and account workspace."
      nav={tipsterNav}
    >
      <TipsterDashboardClient />
    </DashboardShell>
  );
}
