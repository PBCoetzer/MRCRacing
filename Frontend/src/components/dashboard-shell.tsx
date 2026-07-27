import Link from "next/link";
import { RoleGate } from "@/components/auth/role-gate";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

type DashboardShellProps = {
  allowedRoles: string[];
  accessDescription: string;
  accessTitle: string;
  title: string;
  description: string;
  nav: { label: string; href: string }[];
  children: React.ReactNode;
};

export function DashboardShell({
  allowedRoles,
  accessDescription,
  accessTitle,
  title,
  description,
  nav,
  children,
}: DashboardShellProps) {
  return (
    <RoleGate
      allowedRoles={allowedRoles}
      description={accessDescription}
      title={accessTitle}
    >
      <div className="min-h-screen bg-background text-foreground">
        <SiteHeader />
        <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
          <aside className="h-fit rounded-lg border border-brand-gold/25 bg-card/82 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
            <p className="px-2 pb-2 font-mono text-xs font-semibold uppercase text-brand-cyan">
              Workspace
            </p>
            <nav className="grid gap-1">
              {nav.map((item) => (
                <Button key={`${item.href}-${item.label}`} asChild variant="ghost" className="justify-start">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </nav>
          </aside>
          <section className="min-w-0">
            <div className="mb-6">
              <h1 className="font-heading text-3xl font-normal tracking-normal text-white">
                {title}
              </h1>
              <p className="mt-2 max-w-3xl text-muted-foreground">{description}</p>
            </div>
            {children}
          </section>
        </main>
        <SiteFooter />
      </div>
    </RoleGate>
  );
}
