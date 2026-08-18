import { AdminCharityClient } from "@/components/admin/admin-charity-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminCharityPage() {
  return <DashboardShell allowedRoles={["administrator"]} accessDescription="the ECHCU contribution ledger" accessTitle="Administrator access required" title="ECHCU contribution ledger" description="Review immutable 10% platform-commission contributions and record completed remittances." nav={adminNav}><AdminCharityClient /></DashboardShell>;
}
