import { AdminOperationsClient } from "@/components/admin/admin-operations-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminPage() {
  return (
    <DashboardShell
      allowedRoles={["administrator"]}
      accessDescription="the administrator dashboard"
      accessTitle="Administrator access required"
      title="Admin dashboard"
      description="Operational control for users, tipsters, fixtures, credits, payments, announcements, API keys, roles, permissions, and audit logs."
      nav={adminNav}
    >
      <AdminOperationsClient />
    </DashboardShell>
  );
}
