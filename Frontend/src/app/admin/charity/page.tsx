import { AdminCharityClient } from "@/components/admin/admin-charity-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminCharityPage() {
  return <DashboardShell allowedRoles={["administrator"]} accessDescription="the Horse Care contribution ledger" accessTitle="Administrator access required" title="Horse Care Ledger" description="Review the immutable 10% Horse Care allocation from cash-backed Credits used on paid content and record completed remittances." nav={adminNav}><AdminCharityClient /></DashboardShell>;
}
