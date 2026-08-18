import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";

export const metadata: Metadata = publicMetadata({
  title: "Refund Policy",
  description: "MRC Racing Tips policy for failed or duplicate payments, unused Credits, digital content, cancelled meetings, and approved refunds.",
  path: "/refund-policy",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
