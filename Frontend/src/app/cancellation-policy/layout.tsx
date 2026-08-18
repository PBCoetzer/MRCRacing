import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";

export const metadata: Metadata = publicMetadata({
  title: "Cancellation Policy",
  description: "MRC Racing Tips policy for checkout cancellation, fixed-term subscriptions, meeting changes, and account closure.",
  path: "/cancellation-policy",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
