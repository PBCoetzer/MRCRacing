import type { Metadata } from "next";
import { publicMetadata } from "@/lib/metadata";
export const metadata: Metadata = publicMetadata({ title: "MRC Credits and Tipster Pricing", description: "Understand MRC Credits, one-off meeting cards, tipster subscriptions, refunds, and transparent South African Rand pricing.", path: "/pricing" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
