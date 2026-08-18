import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Privacy Policy", description: "How MRC Racing Tips handles account, payment, analytics, comment, and racing-platform information.", path: "/privacy" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
