import { DashboardShell } from "@/components/dashboard-shell";
import { TipsterApplicationClient } from "@/components/tipster/tipster-application-client";

const clientNav = [
  { label: "Client dashboard", href: "/client/" },
  { label: "Subscriptions", href: "/client/#subscriptions" },
  { label: "Meeting Cards", href: "/client/#unlocked-tips" },
  { label: "Discover Tipsters", href: "/client/#discover-tipsters" },
  { label: "Become a Tipster", href: "/client/tipster-application/" },
];

export default function TipsterApplicationPage() {
  return (
    <DashboardShell
      allowedRoles={["client", "administrator"]}
      accessDescription="the tipster application workspace"
      accessTitle="Client access required"
      title="Become an MRC Tipster"
      description="Submit your experience, private verification documents, and electronically signed platform agreement for administrator review."
      nav={clientNav}
    >
      <TipsterApplicationClient />
    </DashboardShell>
  );
}
