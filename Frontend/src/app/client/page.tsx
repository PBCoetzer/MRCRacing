import { ClientDashboardClient } from "@/components/client/client-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const clientNav = [
  { label: "Marketplace", href: "/client/" },
  { label: "Purchased Tips", href: "/client/#unlocked-tips" },
  { label: "Purchases", href: "/client/#purchases" },
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
