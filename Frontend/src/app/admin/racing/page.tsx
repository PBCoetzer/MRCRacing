import { AdminRaceFeedClient } from "@/components/admin/admin-race-feed-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminRacingPage() {
  return (
    <DashboardShell
      allowedRoles={["administrator"]}
      accessDescription="the administrator race-feed monitor"
      accessTitle="Administrator access required"
      title="Race-feed monitor"
      description="Manage approved sources, monitor LLM extraction, review quarantined changes, and inspect tip-impact alerts."
      nav={adminNav}
    >
      <AdminRaceFeedClient />
    </DashboardShell>
  );
}
