export type AppRole = "administrator" | "client" | "tipster";

export type DashboardLink = {
  href: string;
  label: string;
};

export function dashboardForRoles(roles: readonly string[]) {
  if (roles.includes("administrator")) {
    return "/admin/";
  }

  if (roles.includes("tipster")) {
    return "/tipster/";
  }

  return "/client/";
}

export function dashboardLinksForRoles(roles: readonly string[]): DashboardLink[] {
  const links: DashboardLink[] = [];
  const isAdministrator = roles.includes("administrator");

  if (roles.includes("client") || isAdministrator) {
    links.push({ label: "Client", href: "/client" });
  }

  if (roles.includes("tipster") || isAdministrator) {
    links.push({ label: "Tipster", href: "/tipster" });
  }

  if (isAdministrator) {
    links.push({ label: "Admin", href: "/admin" });
  }

  return links;
}
