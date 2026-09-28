"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { LogOut, Menu, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { dashboardForRoles, dashboardLinksForRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

const publicNavItems = [
  { label: "Home", href: "/" },
  { label: "Tipsters", href: "/tipsters/" },
  { label: "Blog", href: "/blog/" },
  { label: "Racing", href: "/horse-racing/" },
  { label: "Horse Care", href: "/horse-care/" },
  { label: "Pricing", href: "/pricing" },
];

type AuthState = "signed-out" | "signed-in";

type RoleRow = {
  role: string;
};

export function SiteHeader() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("signed-out");
  const [roles, setRoles] = useState<string[]>([]);
  const dashboardLinks = dashboardLinksForRoles(roles);
  const navItems = [...publicNavItems, ...dashboardLinks];
  const dashboardHref = authState === "signed-in" ? dashboardForRoles(roles) : null;
  const profileHref = roles.includes("tipster") && !roles.includes("administrator")
    ? "/tipster/#profile"
    : roles.includes("client") && !roles.includes("administrator")
      ? "/client/#profile"
      : "/account/profile/";

  useEffect(() => {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    let isMounted = true;

    async function loadNavigation(providedSession?: Session | null) {
      try {
        let activeSession = providedSession;

        if (typeof activeSession === "undefined") {
          const {
            data: { session },
            error: sessionError,
          } = await supabase.auth.getSession();

          if (sessionError) {
            throw sessionError;
          }

          activeSession = session;
        }

        if (!activeSession) {
          if (isMounted) {
            setRoles([]);
            setAuthState("signed-out");
          }
          return;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser(activeSession.access_token);

        if (userError || !user) {
          await supabase.auth.signOut({ scope: "local" });
          if (isMounted) {
            setRoles([]);
            setAuthState("signed-out");
          }
          return;
        }

        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (roleError) {
          throw roleError;
        }

        if (isMounted) {
          const roleRows = (roleData ?? []) as RoleRow[];
          setRoles(roleRows.map((row) => row.role));
          setAuthState("signed-in");
        }
      } catch {
        if (isMounted) {
          setRoles([]);
          setAuthState("signed-out");
        }
      }
    }

    loadNavigation();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        setRoles([]);
        setAuthState("signed-out");
        return;
      }

      window.setTimeout(() => {
        loadNavigation(session);
      }, 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();

    if (supabase) {
      await supabase.auth.signOut();
    }

    setRoles([]);
    setAuthState("signed-out");
    router.push("/login/");
    router.refresh();
  }

  function handleWorkspaceLink(href: string) {
    const [, view] = href.split("#");
    if (view) {
      window.dispatchEvent(new CustomEvent("mrc-dashboard-view-change", {
        detail: view,
      }));
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-brand-gold/30 bg-brand-purple-deep/90 text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="site-container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="relative flex h-11 w-14 overflow-hidden rounded-md border border-brand-gold/70 bg-brand-purple shadow-[0_0_0_2px_rgba(255,176,0,0.12)]">
            <Image
              src="/images/mrc-racing-tips-logo.webp"
              alt="MRC Racing Tips logo"
              width={112}
              height={88}
              priority
              className="h-full w-full object-cover object-top"
            />
          </span>
          <span className="leading-none">
            <span className="block font-heading text-base text-white sm:text-lg">
              MRC Racing
            </span>
            <span className="block font-mono text-[0.62rem] uppercase text-brand-magenta sm:text-xs">
              Tips
            </span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 xl:flex">
          {navItems.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="hidden items-center gap-2 xl:flex">
          {authState === "signed-in" ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={profileHref} onClick={() => handleWorkspaceLink(profileHref)}>
                  <UserRound className="size-4" />
                  Profile
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/account/security/">
                  <ShieldCheck className="size-4" />
                  Security
                </Link>
              </Button>
              {dashboardHref ? (
                <Button asChild size="sm" className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                  <Link href={dashboardHref}>Dashboard</Link>
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="size-4" />
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline" size="sm" className="border-brand-cyan/60 text-brand-cyan hover:bg-brand-cyan/12 hover:text-brand-cyan">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild size="sm" className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                <Link href="/register">Buy Credits</Link>
              </Button>
            </>
          )}
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="xl:hidden" aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="border-brand-gold/30 bg-brand-purple-deep text-foreground">
            <SheetHeader>
              <SheetTitle>MRC Racing Tips</SheetTitle>
            </SheetHeader>
            <div className="mt-6 grid gap-2">
              {navItems.map((item) => (
                <Button key={item.href} asChild variant="ghost" className="justify-start">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
              {authState === "signed-in" ? (
                <>
                  <Button asChild variant="outline" className="mt-4 justify-start">
                    <Link href={profileHref} onClick={() => handleWorkspaceLink(profileHref)}>
                      <UserRound className="size-4" />
                      My profile
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="justify-start">
                    <Link href="/account/security/">
                      <ShieldCheck className="size-4" />
                      Profile security &amp; 2FA
                    </Link>
                  </Button>
                  {dashboardHref ? (
                    <Button asChild className="justify-start bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                      <Link href={dashboardHref}>Dashboard</Link>
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" className="justify-start" onClick={handleLogout}>
                    <LogOut className="size-4" />
                    Logout
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild variant="outline" className="mt-4 justify-start">
                    <Link href="/login">Login</Link>
                  </Button>
                  <Button asChild className="justify-start bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
                    <Link href="/register">Buy Credits</Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
