import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  LockKeyhole,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import {
  RaceResultsHistory,
  UpcomingMeetingBoard,
} from "@/components/racing/race-data-board";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { affiliatePartners, creditPackages } from "@/lib/mock-data";
import { publicMetadata } from "@/lib/metadata";

export const metadata: Metadata = publicMetadata({
  title: "South African Horse Racing Tips",
  description: "Compare verified South African horse-racing tipsters, factual racecards, settled results, and transparent winner strike rates.",
  path: "/",
});

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-brand-gold/25 bg-[radial-gradient(circle_at_18%_20%,rgba(211,39,255,0.24),transparent_30rem),radial-gradient(circle_at_84%_22%,rgba(0,212,231,0.2),transparent_26rem),linear-gradient(135deg,#321652,#1e0c38_55%,#3c1665)] text-white">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(255,255,255,0.11)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.11)_1px,transparent_1px)] [background-size:70px_70px]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <div className="grid overflow-hidden rounded-2xl border border-brand-gold/40 bg-brand-purple-deep/72 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur lg:grid-cols-[0.9fr_1.1fr]">
              <div className="relative hidden min-h-72 overflow-hidden border-b border-brand-gold/25 lg:block lg:min-h-[34rem] lg:border-r lg:border-b-0">
                <Image
                  src="/images/mrc-racing-tips-hero.webp"
                  alt="MRC Racing Tips logo"
                  fill
                  priority
                  fetchPriority="high"
                  sizes="(max-width: 1024px) 100vw, 45vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-brand-purple-deep/38 to-transparent" />
              </div>
              <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-14">
                <Badge className="mb-5 w-fit border border-brand-gold/40 bg-brand-gold text-brand-purple-deep">
                  <Sparkles className="size-3" />
                  South African horse racing only
                </Badge>
                <h1 className="font-heading text-4xl font-normal leading-tight text-white sm:text-5xl lg:text-6xl">
                  MRC Racing Tips
                </h1>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-white/82">
                  A dedicated South African horse-racing tipping platform with transparent
                  tipster stats, Credit-based unlocks, verified race cards, result history,
                  and admin-grade controls.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button
                    asChild
                    size="lg"
                    className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90"
                  >
                    <Link href="/register/">
                      Create account
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="border-brand-cyan/45 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/16 hover:text-brand-cyan"
                  >
                    <Link href="/tipsters/">Browse verified tipsters</Link>
                  </Button>
                </div>
                <div className="mt-10 grid grid-cols-3 gap-3 text-sm">
                  {[
                    ["1", "racing category"],
                    ["18+", "age gated"],
                    ["Source", "audit trail"],
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-brand-gold/20 bg-white/8 p-4"
                    >
                      <p className="font-mono text-xl font-bold sm:text-2xl">{value}</p>
                      <p className="text-xs text-white/68 sm:text-sm">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-10">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-cyan">
                    Verified race feed
                  </p>
                  <h2 className="mt-2 font-heading text-3xl text-white">
                    Upcoming race meetings
                  </h2>
                  <p className="mt-2 text-white/68">
                    Up to seven public meetings, ordered by the first race.
                  </p>
                </div>
                <Badge className="bg-brand-red text-white">Live database</Badge>
              </div>
              <UpcomingMeetingBoard />
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
          {[
            { label: "Racing coverage", value: "Horse only", icon: Trophy },
            { label: "Premium access", value: "Credits", icon: LockKeyhole },
            { label: "Tipster records", value: "Verified", icon: Users },
            { label: "Race data", value: "Source-linked", icon: Wallet },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardDescription>{stat.label}</CardDescription>
                <stat.icon className="size-4 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-bold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-5 text-brand-gold" />
                Buy the meeting, not one race
              </CardTitle>
              <CardDescription>
                One-off access opens a tipster&apos;s complete venue/date meeting card.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Review race-by-race winner, best-place, and comment selections.</p>
              <p>See the tipster&apos;s Exotic&apos;s and Multiples for the full meeting.</p>
              <p>Access corrections through the same entitlement without buying again.</p>
              <Button asChild variant="outline">
                <Link href="/pricing/">How Credits work</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="size-5 text-brand-cyan" />
                Choose a verified tipster
              </CardTitle>
              <CardDescription>
                Compare truthful winner strike rates and settled sample sizes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Every profile has its own meeting prices and subscription options.</p>
              <p>ROI stays hidden until authoritative odds or dividends support it.</p>
              <p>Favourite tipsters to keep their profiles easy to find.</p>
              <Button asChild>
                <Link href="/tipsters/">Discover tipsters</Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="border-y bg-card/45">
          <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
            <RaceResultsHistory />
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 max-w-3xl">
            <Badge variant="outline">Affiliate partners</Badge>
            <h2 className="mt-3 font-heading text-3xl text-white">
              Open a bookmaker account with an MRC partner.
            </h2>
            <p className="mt-3 text-muted-foreground">
              These are affiliate links. MRC Racing Tips may earn a commission when you
              register or transact through a partner link, at no additional cost to you.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {affiliatePartners.map((partner) => (
              <a
                key={partner.name}
                href={partner.href}
                target="_blank"
                rel="sponsored noopener noreferrer"
                aria-label={`Visit ${partner.name}`}
                className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-brand-gold/24 bg-brand-purple-deep transition hover:-translate-y-1 hover:border-brand-gold/65 hover:shadow-[0_18px_45px_rgba(0,0,0,0.28)]"
              >
                <Image
                  src={partner.image}
                  alt={`${partner.name} logo`}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  className="object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/86 via-black/55 to-transparent px-4 pt-10 pb-3 text-white">
                  <span className="font-semibold">{partner.name}</span>
                  <ExternalLink className="size-4 text-brand-cyan" />
                </div>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            18+ only. Betting involves risk. Affiliate placement does not change MRC&apos;s
            independent tipster reporting or results history.
          </p>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Badge variant="outline">Credits</Badge>
              <h2 className="mt-3 font-heading text-3xl text-white">
                R1 always equals 1 Credit.
              </h2>
            </div>
            <Button asChild variant="outline">
              <Link href="/pricing/">View checkout options</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {creditPackages.map((pack) => (
              <Card key={pack.name}>
                <CardHeader>
                  <CardTitle>{pack.name}</CardTitle>
                  <CardDescription>{pack.value}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-3xl font-bold">{pack.price}</p>
                  <Button asChild className="mt-5 w-full">
                    <Link href="/pricing/">
                      <CircleDollarSign className="size-4" />
                      View package
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="grid gap-4 rounded-xl border border-brand-gold/30 bg-brand-purple-deep p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.22)] md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="font-mono text-sm uppercase text-brand-cyan">
                Responsible, auditable, horse-racing only
              </p>
              <h2 className="mt-2 font-heading text-2xl">
                Follow tipsters without hiding the source or result history.
              </h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                asChild
                className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90"
              >
                <Link href="/login/">Login</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/10 hover:text-brand-cyan"
              >
                <Link href="/responsible-gambling/">
                  <Activity className="size-4" />
                  Responsible gambling
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
