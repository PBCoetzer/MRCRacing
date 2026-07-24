import { AdminDashboardClient } from "@/components/admin/admin-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const adminNav = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin" },
  { label: "Tipsters", href: "/admin" },
  { label: "Fixtures", href: "/admin" },
  { label: "Payments", href: "/admin" },
  { label: "Audit Logs", href: "/admin" },
];

export default function AdminPage() {
  return (
    <DashboardShell
      title="Admin dashboard"
      description="Operational control for users, tipsters, fixtures, credits, payments, announcements, API keys, roles, permissions, and audit logs."
      nav={adminNav}
    >
      <AdminDashboardClient />
    </DashboardShell>
  );
}
