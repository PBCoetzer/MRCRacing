import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-8rem)] w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_440px] lg:px-8">
        <section>
          <p className="text-sm font-semibold uppercase text-primary">Secure access</p>
          <h1 className="mt-3 font-heading text-4xl font-bold tracking-normal">
            Log in to unlock tips, track credits, and manage your dashboard.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            Supabase Auth will power email verification, password resets, and role-aware
            routing for clients, tipsters, and administrators.
          </p>
          <Alert className="mt-6 max-w-2xl">
            <LockKeyhole className="size-4" />
            <AlertTitle>Local auth screen</AlertTitle>
            <AlertDescription>
              This form is ready for Supabase wiring once project credentials are added.
            </AlertDescription>
          </Alert>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Enter your account details.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Your password" />
              </div>
              <Button type="button" className="w-full">Login</Button>
              <div className="flex items-center justify-between text-sm">
                <Link href="/register" className="text-primary hover:underline">Create account</Link>
                <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
                  Forgot password?
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
