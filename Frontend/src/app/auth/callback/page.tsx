import { AuthCallback } from "@/components/auth/auth-callback";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-xl items-center px-4 py-10 sm:px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Account confirmation</CardTitle>
            <CardDescription>
              Securely completing your MRC Racing account setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuthCallback />
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
