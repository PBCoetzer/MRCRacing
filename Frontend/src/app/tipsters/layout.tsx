import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Verified South African Horse Racing Tipsters", description: "Compare verified tipster profiles, settled sample sizes, and factual winner strike rates before opening live meeting-card offers.", path: "/tipsters" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
