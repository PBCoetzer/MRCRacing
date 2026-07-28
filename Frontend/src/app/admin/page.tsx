import { AdminDashboardClient } from "@/components/admin/admin-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const adminNav = [
  { label: "Operations", href: "/admin/" },
  { label: "Users & Tipsters", href: "/admin/#users" },
  { label: "Disputes", href: "/admin/#disputes" },
  { label: "Notifications", href: "/admin/#notifications" },
];

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
      <AdminDashboardClient />
    </DashboardShell>
  );
}
