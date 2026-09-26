import { AdminRevenueSplitClient } from "@/components/admin/admin-revenue-split-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminRevenuePage() {
  return (
    <DashboardShell
      allowedRoles={["administrator"]}
      accessDescription="the content-spend revenue allocation report"
      accessTitle="Administrator access required"
      title="Content revenue split"
      description="Reconcile the 10% Horse Care, 20% MRC, and 70% tipster allocation when Credits are used on meeting cards or subscriptions. Reward Credits are excluded."
      nav={adminNav}
    >
      <AdminRevenueSplitClient />
    </DashboardShell>
  );
}
