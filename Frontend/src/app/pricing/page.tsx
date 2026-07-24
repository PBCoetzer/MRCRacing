import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { creditPackages } from "@/lib/mock-data";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-heading text-4xl font-bold tracking-normal">Credit packages</h1>
        <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
          Buy credits once and unlock only the premium tips that matter to you. Credits
          unlock digital analysis content and cannot be withdrawn or used to place bets.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {creditPackages.map((pack) => (
            <Card key={pack.name}>
              <CardHeader>
                <CardTitle>{pack.name}</CardTitle>
                <CardDescription>{pack.value}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-4xl font-bold">{pack.price}</p>
                <p className="mt-2 text-muted-foreground">{pack.credits} credits</p>
                <Button className="mt-6 w-full">Choose package</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
