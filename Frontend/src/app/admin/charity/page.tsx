import { AdminCharityClient } from "@/components/admin/admin-charity-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminCharityPage() {
  return <DashboardShell allowedRoles={["administrator"]} accessDescription="the ECHCU contribution ledger" accessTitle="Administrator access required" title="ECHCU contribution ledger" description="Review the immutable 10% Horse Care allocation from cash-backed Credits used on paid content and record completed remittances." nav={adminNav}><AdminCharityClient /></DashboardShell>;
}
