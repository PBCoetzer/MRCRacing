import { LockKeyhole } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
            Supabase Auth now powers email login, password resets, and role-aware routing for
            clients, tipsters, and administrators.
          </p>
          <Alert className="mt-6 max-w-2xl">
            <LockKeyhole className="size-4" />
            <AlertTitle>Local auth screen</AlertTitle>
            <AlertDescription>
              This form is connected to the live MRCRacing Supabase project for local and Xneelo testing.
            </AlertDescription>
          </Alert>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Enter your account details.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
