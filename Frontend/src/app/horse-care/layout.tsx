import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Racing With Purpose — ECHCU Horse Care", description: "See how MRC allocates 10% of cash-backed Credits used on eligible content to support the Eastern Cape Horse Care Unit.", path: "/horse-care", image: "/images/echcu-horse-care-hero.png" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
