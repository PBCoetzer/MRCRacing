import { DashboardShell } from "@/components/dashboard-shell";
import { TipsterBlogClient } from "@/components/tipster/tipster-blog-client";

const tipsterNav = [
  { label: "Dashboard", href: "/tipster/" },
  { label: "Manage Tips", href: "/tipster/manage-tips/" },
  { label: "Blog", href: "/tipster/blog/" },
];

export default function TipsterBlogPage() {
  return <DashboardShell allowedRoles={["tipster", "administrator"]} accessDescription="the tipster blog workspace" accessTitle="Tipster access required" title="Tipster blog" description="Prepare safe public articles and publish directly when the separate administrator author permission is active." nav={tipsterNav}><TipsterBlogClient /></DashboardShell>;
}
