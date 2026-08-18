import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Horse Racing Tips FAQ", description: "Answers about MRC Credits, verified tipster records, racecards, responsible use, and how MRC differs from a bookmaker.", path: "/faq" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
