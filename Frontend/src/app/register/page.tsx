import { ShieldCheck } from "lucide-react";
import { RegisterForm } from "@/components/auth/register-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
            <CardDescription>Create your secure online MRC Racing account.</CardDescription>
          </CardHeader>
          <CardContent>
            <RegisterForm />
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
