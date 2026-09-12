import { DashboardShell } from "@/components/dashboard-shell";
import { TipsterBlogClient } from "@/components/tipster/tipster-blog-client";

const authorNav = [
  { label: "Client dashboard", href: "/client/" },
  { label: "Public blog", href: "/blog/" },
  { label: "Author workspace", href: "/tipster/blog/" },
];

export default function TipsterBlogPage() {
  return <DashboardShell allowedRoles={["client", "tipster", "administrator"]} accessDescription="the blog author workspace" accessTitle="Registered account required" title="Blog author workspace" description="Request independent author approval, prepare public articles, and publish after an administrator verifies your access." nav={authorNav}><TipsterBlogClient /></DashboardShell>;
}
