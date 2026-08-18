import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, HeartHandshake, Home, ShieldCheck, Stethoscope } from "lucide-react";
import { CharityTransparencyClient } from "@/components/charity/charity-transparency-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HorseCarePage() {
  return <div className="min-h-screen bg-background"><SiteHeader /><main>
    <section className="relative min-h-[620px] overflow-hidden border-b border-brand-gold/30">
      <Image src="/images/echcu-horse-care-hero.png" alt="Illustration of a horse receiving calm, compassionate care" fill priority sizes="100vw" className="object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-brand-purple-deep via-brand-purple-deep/88 to-brand-purple-deep/10" />
      <div className="relative mx-auto flex min-h-[620px] w-full max-w-7xl items-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl"><Badge className="bg-brand-gold text-brand-purple-deep">Racing with purpose</Badge><div className="mt-6 flex items-center gap-5"><Image src="/images/echcu-logo.png" alt="East Cape Horse Care Unit official logo" width={145} height={142} className="h-28 w-28 rounded-full bg-white object-contain p-1 shadow-xl sm:h-36 sm:w-36" /><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-brand-cyan">MRC × ECHCU</p><h1 className="mt-2 font-heading text-4xl leading-tight text-white sm:text-6xl">Every card can help a horse</h1></div></div><p className="mt-7 max-w-xl text-lg leading-8 text-white/85">From this feature’s launch, MRC records 10% of its platform commission on meeting-card and tipster-subscription purchases for the Eastern Cape Horse Care Unit.</p><div className="mt-7 flex flex-wrap gap-3"><Button asChild className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90"><Link href="https://echcu.co.za/" target="_blank" rel="noreferrer">Support ECHCU directly <ArrowUpRight className="size-4" /></Link></Button><Button asChild variant="outline"><Link href="/tipsters/">Browse tipsters</Link></Button></div><p className="mt-5 text-xs text-white/60">Hero artwork is an original AI-generated illustration created for MRC; it is not documentary photography.</p></div>
      </div>
    </section>

    <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8"><p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-cyan">Transparent contribution ledger</p><h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">What MRC has recorded</h2><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">The public figures are aggregate totals only. Customer, purchase, and transaction details remain private and administrator-restricted.</p><div className="mt-7"><CharityTransparencyClient /></div>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">{[
        { title: "Purchase recorded", body: "The contribution basis is MRC’s recorded platform-fee commission—not the customer’s full package payment.", icon: ShieldCheck },
        { title: "10% accrues", body: "The ZAR-per-Credit rate and 10% contribution rate are snapshotted in an immutable ledger entry.", icon: HeartHandshake },
        { title: "Refunds reverse", body: "A refund creates an equal negative ledger entry. Remittances are recorded separately with a reference and date.", icon: Stethoscope },
      ].map((item) => <Card key={item.title}><CardHeader><item.icon className="size-6 text-brand-gold" /><CardTitle className="mt-3 text-xl text-white">{item.title}</CardTitle><CardDescription className="leading-6">{item.body}</CardDescription></CardHeader></Card>)}</div>
    </section>

    <section className="border-y border-brand-gold/20 bg-card/55"><div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8"><div className="flex items-center justify-center"><Image src="/images/echcu-logo.png" alt="East Cape Horse Care Unit" width={438} height={427} className="w-full max-w-sm rounded-full bg-white p-3" /></div><div><p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-cyan">Twenty years of practical care</p><h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">Caring for equines across the Eastern Cape</h2><p className="mt-5 leading-8 text-muted-foreground">ECHCU began in the Nelson Mandela Metro in June 2006 to meet a need for owner education and horse-and-donkey welfare. It became an independent organisation in 2012. Its official site describes ongoing work across metro townships and clinics further afield, with rehabilitation, rehoming, owner education, and cooperation with community and police services.</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{[
          { title: "Rescue and rehabilitation", text: "Complaint follow-ups, veterinary support, hoof care, vaccinations, deworming, feeding guidance, and safe recovery.", icon: Stethoscope },
          { title: "Adoption and fostering", text: "Strict pre-home checks and careful placement help horses, ponies, and donkeys reach suitable homes.", icon: Home },
          { title: "Community education", text: "Practical advice helps owners improve nutrition, shelter, handling, harnessing, and preventative care.", icon: ShieldCheck },
          { title: "Current needs", text: "The June 2026 update records winter care, vaccinations, veterinary interventions, gelding, rehoming, feed, tack, and volunteer support.", icon: HeartHandshake },
        ].map((item) => <div key={item.title} className="rounded-xl border bg-background/45 p-4"><item.icon className="size-5 text-brand-gold" /><h3 className="mt-3 font-semibold text-white">{item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p></div>)}</div><div className="mt-7 flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="https://echcu.co.za/" target="_blank" rel="noreferrer">ECHCU official website <ArrowUpRight className="size-4" /></Link></Button><Button asChild variant="ghost"><Link href="https://echcu.co.za/2026-newsletters/june-26" target="_blank" rel="noreferrer">Read the June 2026 update</Link></Button></div></div></div></section>
  </main><SiteFooter /></div>;
}
