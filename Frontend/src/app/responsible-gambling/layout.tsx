import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Responsible Gambling", description: "Practical responsible-gambling guidance, age restrictions, safer limits, and support context for South African racing audiences.", path: "/responsible-gambling" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
