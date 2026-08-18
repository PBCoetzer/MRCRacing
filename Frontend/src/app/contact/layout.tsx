import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Contact MRC Racing Tips", description: "Contact MRC Racing Tips about accounts, South African racing content, tipster access, or responsible platform support.", path: "/contact" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
