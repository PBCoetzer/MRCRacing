import { DashboardShell } from "@/components/dashboard-shell";
import { ManageTipsClient } from "@/components/tipster/manage-tips-client";
import { tipsterNav } from "@/components/tipster/tipster-nav";

export default function ManageTipsPage() {
  return (
    <DashboardShell
      allowedRoles={["tipster", "administrator"]}
      accessDescription="the meeting-card editor"
      accessTitle="Tipster access required"
      title="Manage Meeting Tips"
      description="Create race-by-race selections, Exotics and Multiples, pre-sale cards, publications, results, and audited revisions."
      nav={tipsterNav}
    >
      <ManageTipsClient />
    </DashboardShell>
  );
}
