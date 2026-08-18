import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "About MRC Racing Tips", description: "Learn how MRC provides transparent South African horse-racing analysis, verified tipster records, and responsible factual racing content.", path: "/about" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
