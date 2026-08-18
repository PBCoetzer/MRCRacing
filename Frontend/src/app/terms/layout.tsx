import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "Terms of Use", description: "Terms governing MRC Racing Tips accounts, Credits, digital content, tipster publishing, and responsible platform access.", path: "/terms" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
