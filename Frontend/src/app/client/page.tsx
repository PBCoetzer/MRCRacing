import { ClientDashboardClient } from "@/components/client/client-dashboard-client";
import { DashboardShell } from "@/components/dashboard-shell";

const clientNav = [
  { label: "Overview", href: "/client/#overview" },
  { label: "Subscriptions", href: "/client/#subscriptions" },
  { label: "Meeting Cards", href: "/client/#meeting-cards" },
  { label: "Discover Tipsters", href: "/client/#discover-tipsters" },
  { label: "Marketplace", href: "/client/#marketplace" },
  { label: "Purchases", href: "/client/#purchases" },
  { label: "Write for MRC", href: "/client/#write-for-mrc" },
  { label: "My profile", href: "/client/#profile" },
  { label: "Become a Tipster", href: "/client/#become-tipster" },
];

export default function ClientPage() {
  return (
    <DashboardShell
      allowedRoles={["client", "administrator"]}
      accessDescription="the client dashboard"
      accessTitle="Client access required"
      title="Client dashboard"
      description="Your personal racing workspace for upcoming cards, race meetings, results, subscriptions, purchases, and profile requirements."
      nav={clientNav}
    >
      <ClientDashboardClient />
    </DashboardShell>
  );
}
