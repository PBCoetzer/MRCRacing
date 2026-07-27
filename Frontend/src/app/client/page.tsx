import { ClientDashboardClient } from "@/components/client/client-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const clientNav = [
  { label: "Credits", href: "/client" },
  { label: "Purchased Tips", href: "/client" },
  { label: "Upcoming Tips", href: "/client" },
  { label: "History", href: "/client" },
  { label: "Payments", href: "/client" },
  { label: "Settings", href: "/client" },
];

export default function ClientPage() {
  return (
    <DashboardShell
      allowedRoles={["client", "administrator"]}
      accessDescription="the client dashboard"
      accessTitle="Client access required"
      title="Client dashboard"
      description="A client workspace for credit balance, purchased tips, upcoming tips, history, payments, profile, notifications, and settings."
      nav={clientNav}
    >
      <ClientDashboardClient />
    </DashboardShell>
  );
}
