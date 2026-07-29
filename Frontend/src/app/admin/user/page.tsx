import { AdminUserDetailClient } from "@/components/admin/admin-user-detail-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminUserPage() {
  return (
    <DashboardShell
      allowedRoles={["administrator"]}
      accessDescription="the administrator user workspace"
      accessTitle="Administrator access required"
      title="User workspace"
      description="Identity, access, Credits, moderation, notes, activity, and immutable audit history."
      nav={adminNav}
    >
      <AdminUserDetailClient />
    </DashboardShell>
  );
}
