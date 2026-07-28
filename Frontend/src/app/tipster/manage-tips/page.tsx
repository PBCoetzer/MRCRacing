import { DashboardShell } from "@/components/dashboard-shell";
import { ManageTipsClient } from "@/components/tipster/manage-tips-client";

const tipsterNav = [
  { label: "Dashboard", href: "/tipster/" },
  { label: "Manage Tips", href: "/tipster/manage-tips/" },
];

export default function ManageTipsPage() {
  return (
    <DashboardShell
      allowedRoles={["tipster", "administrator"]}
      accessDescription="the meeting-card editor"
      accessTitle="Tipster access required"
      title="Manage meeting tips"
      description="Create structured horse-racing selections, meeting bets, pre-sale cards, publications, and audited revisions."
      nav={tipsterNav}
    >
      <ManageTipsClient />
    </DashboardShell>
  );
}
