import { DashboardShell } from "@/components/dashboard-shell";
import { ManageTipsClient } from "@/components/tipster/manage-tips-client";

const tipsterNav = [
  { label: "Dashboard", href: "/tipster/" },
  { label: "Manage Tips", href: "/tipster/manage-tips/" },
  { label: "Blog", href: "/tipster/blog/" },
];

export default function ManageTipsPage() {
  return (
    <DashboardShell
      allowedRoles={["tipster", "administrator"]}
      accessDescription="the meeting-card editor"
      accessTitle="Tipster access required"
      title="Manage meeting tips"
      description="Create race-by-race selections, free-text Exotic's and Multiples, pre-sale cards, publications, results, and audited revisions."
      nav={tipsterNav}
    >
      <ManageTipsClient />
    </DashboardShell>
  );
}
