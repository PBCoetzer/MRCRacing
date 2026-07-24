import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-xl items-center px-4 py-10 sm:px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>
              Use the secure Supabase reset session from your email link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
