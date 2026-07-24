import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  LockKeyhole,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  creditPackages,
  fixtures,
  latestResults,
  premiumTips,
  tipsters,
} from "@/lib/mock-data";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-brand-gold/25 bg-[radial-gradient(circle_at_18%_20%,rgba(211,39,255,0.24),transparent_30rem),radial-gradient(circle_at_84%_22%,rgba(0,212,231,0.2),transparent_26rem),linear-gradient(135deg,#321652,#1e0c38_55%,#3c1665)] text-white">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(255,255,255,0.11)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.11)_1px,transparent_1px)] [background-size:70px_70px]" />
          <div className="relative mx-auto grid min-h-[calc(92svh-4rem)] w-full max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_500px] lg:px-8">
            <div className="max-w-3xl">
              <Badge className="mb-5 border border-brand-gold/40 bg-brand-gold text-brand-purple-deep">
                <Sparkles className="size-3" />
                MRC brand system applied
              </Badge>
              <h1 className="font-heading text-5xl font-normal leading-tight tracking-normal text-white sm:text-6xl">
                MRC Racing Tips
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/82">
                A premium South African sports tipping platform with transparent tipster
                stats, credit-based unlocks, race cards, result history, and admin-grade
                controls from day one.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                  <Link href="/register">
                    Create account
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-brand-cyan/45 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/16 hover:text-brand-cyan">
                  <Link href="/admin">View admin board</Link>
                </Button>
              </div>
              <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3 text-sm">
                {[
                  ["42k+", "credits traced"],
                  ["18+", "age gated"],
                  ["RLS", "security model"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-lg border border-brand-gold/20 bg-white/8 p-4 backdrop-blur">
                    <p className="font-mono text-2xl font-bold">{value}</p>
                    <p className="text-white/68">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-brand-gold/35 bg-brand-purple-deep/55 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur">
              <div className="overflow-hidden rounded-lg border border-brand-gold/50 bg-brand-purple">
                <Image
                  src="/images/mrc-racing-tips-logo.jpeg"
                  alt="MRC Racing Tips logo"
                  width={1128}
                  height={887}
                  priority
                  className="aspect-[1.27] w-full object-cover"
                />
              </div>
              <div className="mt-4 mb-4 flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm text-brand-cyan">Live race control</p>
                  <h2 className="font-heading text-xl font-normal tracking-normal text-white">Upcoming board</h2>
                </div>
                <Badge className="bg-brand-red text-white">Preview</Badge>
              </div>
              <div className="grid gap-3">
                {fixtures.map((fixture) => (
                  <div key={fixture.fixture} className="rounded-lg border border-brand-gold/16 bg-white/8 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-xs uppercase text-brand-cyan">{fixture.sport}</p>
                        <p className="mt-1 font-semibold">{fixture.fixture}</p>
                        <p className="text-sm text-white/68">{fixture.league}</p>
                      </div>
                      <Badge variant="outline" className="border-brand-gold/30 text-brand-gold">
                        {fixture.status}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-white/76">
                      <span>{fixture.startsAt}</span>
                      <span>{fixture.market}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
          {[
            { label: "Wallet credits", value: "1,240", icon: Wallet },
            { label: "Unlocked tips", value: "318", icon: LockKeyhole },
            { label: "Active tipsters", value: "24", icon: Users },
            { label: "Result strike rate", value: "58%", icon: Trophy },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardDescription>{stat.label}</CardDescription>
                <stat.icon className="size-4 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="font-mono text-3xl font-bold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-5 text-brand-gold" />
                Latest premium tips
              </CardTitle>
              <CardDescription>Locked preview cards for credit-based access.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fixture</TableHead>
                    <TableHead>Tipster</TableHead>
                    <TableHead>Odds</TableHead>
                    <TableHead>Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {premiumTips.map((tip) => (
                    <TableRow key={tip.fixture}>
                      <TableCell>
                        <p className="font-medium">{tip.fixture}</p>
                        <p className="text-xs text-muted-foreground">{tip.prediction}</p>
                      </TableCell>
                      <TableCell>{tip.tipster}</TableCell>
                      <TableCell className="font-mono">{tip.odds}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{tip.credits}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="size-5 text-brand-cyan" />
                Top tipsters
              </CardTitle>
              <CardDescription>Ranking model based on ROI, win rate, and verified history.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {tipsters.map((tipster) => (
                <div key={tipster.name} className="flex items-center justify-between border p-3">
                  <div>
                    <p className="font-semibold">{tipster.name}</p>
                    <p className="text-sm text-muted-foreground">{tipster.sport}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-brand-gold">{tipster.roi}</p>
                    <p className="text-xs text-muted-foreground">{tipster.winRate} win rate</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="border-y bg-card/45">
          <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
            {latestResults.map((result) => (
              <Card key={result.event}>
                <CardHeader>
                  <CardTitle className="text-lg">{result.event}</CardTitle>
                  <CardDescription>{result.highlight}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-end justify-between">
                  <p className="font-semibold">{result.result}</p>
                  <Badge variant="outline">{result.strikeRate}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <Badge variant="outline">Credit packages</Badge>
              <h2 className="mt-3 font-heading text-3xl font-normal tracking-normal text-white">
                Buy credits once, unlock only what matters.
              </h2>
            </div>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link href="/pricing">Compare all</Link>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {creditPackages.map((pack) => (
              <Card key={pack.name}>
                <CardHeader>
                  <CardTitle>{pack.name}</CardTitle>
                  <CardDescription>{pack.value}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <p className="font-mono text-4xl font-bold">{pack.price}</p>
                    <p className="text-sm text-muted-foreground">{pack.credits} credits</p>
                  </div>
                  <Button className="mt-5 w-full bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                    <CircleDollarSign className="size-4" />
                    Select package
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="grid gap-4 rounded-xl border border-brand-gold/30 bg-brand-purple-deep p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.22)] md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="font-mono text-sm uppercase text-brand-cyan">Responsible, auditable, scalable</p>
              <h2 className="mt-2 font-heading text-2xl font-normal tracking-normal">
                Built for tipsters, clients, admins, and future payment gateways.
              </h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild variant="outline" className="border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/10 hover:text-brand-cyan">
                <Link href="/responsible-gambling">
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
