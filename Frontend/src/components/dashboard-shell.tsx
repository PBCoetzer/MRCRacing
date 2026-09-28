import { RoleGate, type MfaPolicy } from "@/components/auth/role-gate";
import { DashboardNav } from "@/components/dashboard-nav";
import type { DashboardNavItem } from "@/components/dashboard-nav";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

type DashboardShellProps = {
  allowedRoles: string[];
  accessDescription: string;
  accessTitle: string;
  title: string;
  description: string;
  nav: DashboardNavItem[];
  children: React.ReactNode;
  mfaPolicy?: MfaPolicy;
  requireRole?: boolean;
};

export function DashboardShell({
  allowedRoles,
  accessDescription,
  accessTitle,
  title,
  description,
  nav,
  children,
  mfaPolicy,
  requireRole,
}: DashboardShellProps) {
  const resolvedMfaPolicy = mfaPolicy ?? (
    allowedRoles.length === 1 && allowedRoles[0] === "administrator"
      ? "administrator"
      : "enrolled"
  );

  return (
    <RoleGate
      allowedRoles={allowedRoles}
      description={accessDescription}
      title={accessTitle}
      mfaPolicy={resolvedMfaPolicy}
      requireRole={requireRole}
    >
      <div className="min-h-screen bg-background text-foreground">
        <SiteHeader />
        <main className="site-container grid gap-6 py-8 lg:grid-cols-[240px_minmax(0,1fr)]">
          <details className="rounded-lg border border-brand-gold/25 bg-card/82 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur lg:hidden">
            <summary className="cursor-pointer list-none px-4 py-3 font-mono text-xs font-semibold uppercase text-brand-cyan marker:content-none">
              Workspace Menu
            </summary>
            <div className="border-t border-brand-gold/15 p-3">
              <DashboardNav nav={nav} />
            </div>
          </details>
          <aside className="hidden h-fit rounded-lg border border-brand-gold/25 bg-card/82 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur lg:block">
            <p className="px-2 pb-2 font-mono text-xs font-semibold uppercase text-brand-cyan">
              Workspace
            </p>
            <DashboardNav nav={nav} />
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
