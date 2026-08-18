import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Racing With Purpose — ECHCU Horse Care", description: "See how MRC pledges 10% of recorded platform commission to support the Eastern Cape Horse Care Unit and transparent horse welfare.", path: "/horse-care", image: "/images/echcu-horse-care-hero.png" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
