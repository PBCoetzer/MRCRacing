import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminUsersPage() {
  return (
    <DashboardShell
      allowedRoles={["administrator"]}
      accessDescription="the administrator user directory"
      accessTitle="Administrator access required"
      title="User directory"
      description="Search, filter, sort, and review every MRC Racing account using server-side pagination."
      nav={adminNav}
    >
      <AdminUsersClient />
    </DashboardShell>
  );
}
