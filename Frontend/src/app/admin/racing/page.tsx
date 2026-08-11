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
      description="Review grounded race proposals, monitor staged extraction, manage source trust, and control approval safeguards."
      nav={adminNav}
    >
      <AdminRaceFeedClient />
    </DashboardShell>
  );
}
