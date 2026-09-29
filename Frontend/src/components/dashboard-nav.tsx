"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  dashboardViewChangeEvent,
  handleDashboardViewLinkClick,
} from "@/lib/dashboard-navigation";

type DashboardNavProps = {
  nav: DashboardNavItem[];
};

export type DashboardNavItem = {
  label: string;
  href: string;
  section?: string;
};

function currentLocation(pathname: string) {
  if (typeof window === "undefined") {
    return pathname;
  }

  return `${pathname}${window.location.hash}`;
}

export function DashboardNav({ nav }: DashboardNavProps) {
  const pathname = usePathname();
  const [location, setLocation] = useState(pathname);

  useEffect(() => {
    const syncLocation = () => setLocation(currentLocation(pathname));

    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    window.addEventListener(dashboardViewChangeEvent, syncLocation);

    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener(dashboardViewChangeEvent, syncLocation);
    };
  }, [pathname]);

  return (
    <nav className="grid gap-1.5">
      {nav.map((item, index) => {
        const [itemPath, itemHash = ""] = item.href.split("#");
        const normalizedPath = itemPath.endsWith("/") ? itemPath : `${itemPath}/`;
        const normalizedCurrentPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
        const currentHash = location.includes("#") ? location.split("#")[1] : "";
        const active = itemHash
          ? normalizedCurrentPath === normalizedPath &&
            (currentHash === itemHash || (!currentHash && itemHash === "overview"))
          : normalizedCurrentPath === normalizedPath && !location.includes("#");

        const showSection = item.section && item.section !== nav[index - 1]?.section;

        return (
          <div key={`${item.href}-${item.label}`} className={showSection && index > 0 ? "pt-3" : ""}>
            {showSection ? (
              <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand-cyan/80">
                {item.section}
              </p>
            ) : null}
            <Button
              asChild
              variant={active ? "secondary" : "ghost"}
              className="h-auto min-h-9 w-full items-start justify-start whitespace-normal px-3 py-2.5 text-left leading-snug"
            >
              <Link
                className="block w-full"
                href={item.href}
                onClick={handleDashboardViewLinkClick}
              >
                {item.label}
              </Link>
            </Button>
          </div>
        );
      })}
    </nav>
  );
}
