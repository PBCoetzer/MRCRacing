"use client";

import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Client", href: "/client" },
  { label: "Tipster", href: "/tipster" },
  { label: "Admin", href: "/admin" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-brand-gold/30 bg-brand-purple-deep/90 text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="relative flex h-11 w-14 overflow-hidden rounded-md border border-brand-gold/70 bg-brand-purple shadow-[0_0_0_2px_rgba(255,176,0,0.12)]">
            <Image
              src="/images/mrc-racing-tips-logo.jpeg"
              alt="MRC Racing Tips logo"
              width={112}
              height={88}
              priority
              className="h-full w-full object-cover object-top"
            />
          </span>
          <span className="leading-none">
            <span className="block font-heading text-base text-white sm:text-lg">
              MRC Racing
            </span>
            <span className="block font-mono text-[0.62rem] uppercase text-brand-magenta sm:text-xs">
              Tips
            </span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="outline" size="sm" className="border-brand-cyan/60 text-brand-cyan hover:bg-brand-cyan/12 hover:text-brand-cyan">
            <Link href="/login">Login</Link>
          </Button>
          <Button asChild size="sm" className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
            <Link href="/register">Buy Credits</Link>
          </Button>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="md:hidden" aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="border-brand-gold/30 bg-brand-purple-deep text-foreground">
            <SheetHeader>
              <SheetTitle>MRC Racing Tips</SheetTitle>
            </SheetHeader>
            <div className="mt-6 grid gap-2">
              {navItems.map((item) => (
                <Button key={item.href} asChild variant="ghost" className="justify-start">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
              <Button asChild variant="outline" className="mt-4 justify-start">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild className="justify-start bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                <Link href="/register">Buy Credits</Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
