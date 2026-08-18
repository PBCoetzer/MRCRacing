import { AdminBlogClient } from "@/components/admin/admin-blog-client";
import { adminNav } from "@/components/admin/admin-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminBlogPage() {
  return <DashboardShell allowedRoles={["administrator"]} accessDescription="blog administration" accessTitle="Administrator access required" title="Blog administration" description="Grant the separate author permission and moderate published posts, comments, and reports without destructive deletion." nav={adminNav}><AdminBlogClient /></DashboardShell>;
}
