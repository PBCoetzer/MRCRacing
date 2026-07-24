import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-8rem)] w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_460px] lg:px-8">
        <section>
          <p className="text-sm font-semibold uppercase text-primary">Join MRC Racing Tips</p>
          <h1 className="mt-3 font-heading text-4xl font-bold tracking-normal">
            Create a client account and prepare your credit wallet.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            Registration will confirm age, terms acceptance, email ownership, and a default
            client role before any premium tip can be unlocked.
          </p>
          <Alert className="mt-6 max-w-2xl">
            <ShieldCheck className="size-4" />
            <AlertTitle>18+ and responsible use</AlertTitle>
            <AlertDescription>
              MRC Racing Tips provides analysis and digital content only. Users remain responsible for
              their own betting decisions.
            </AlertDescription>
          </Alert>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>Client registration fields for Supabase Auth.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" placeholder="Your name" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Cell number</Label>
                <Input id="phone" placeholder="+27" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Create a password" />
              </div>
              <Button type="button" className="w-full">Create account</Button>
              <p className="text-sm text-muted-foreground">
                Already registered?{" "}
                <Link href="/login" className="text-primary hover:underline">Login</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
