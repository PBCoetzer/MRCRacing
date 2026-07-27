import { DashboardShell } from "@/components/dashboard-shell";
import { TipsterDashboardClient } from "@/components/tipster/tipster-dashboard-client";

const tipsterNav = [
  { label: "Dashboard", href: "/tipster" },
  { label: "Manage Tips", href: "/tipster" },
  { label: "Performance", href: "/tipster" },
  { label: "Followers", href: "/tipster" },
  { label: "Earnings", href: "/tipster" },
  { label: "Profile", href: "/tipster" },
];

export default function TipsterPage() {
  return (
    <DashboardShell
      allowedRoles={["tipster", "administrator"]}
      accessDescription="the tipster dashboard"
      accessTitle="Tipster access required"
      title="Tipster dashboard"
      description="A publishing and performance workspace for verified tipsters."
      nav={tipsterNav}
    >
      <TipsterDashboardClient />
    </DashboardShell>
  );
}
