import { ClientDashboardClient } from "@/components/client/client-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const clientNav = [
  { label: "Subscriptions", href: "/client/#subscriptions" },
  { label: "Meeting Cards", href: "/client/#unlocked-tips" },
  { label: "Discover Tipsters", href: "/client/#discover-tipsters" },
  { label: "Marketplace", href: "/client/#marketplace" },
  { label: "Purchases", href: "/client/#purchases" },
];

export default function ClientPage() {
  return (
    <DashboardShell
      allowedRoles={["client", "administrator"]}
      accessDescription="the client dashboard"
      accessTitle="Client access required"
      title="Client dashboard"
      description="Your Credit balance, subscribed tipsters, unlocked meeting cards, verified tipster discovery, and purchase history."
      nav={clientNav}
    >
      <ClientDashboardClient />
    </DashboardShell>
  );
}
