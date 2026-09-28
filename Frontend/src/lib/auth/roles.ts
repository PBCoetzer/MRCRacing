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
  const isAdministrator = roles.includes("administrator");

  if (isAdministrator) {
    return [
      { label: "Client", href: "/client" },
      { label: "Tipster", href: "/tipster" },
      { label: "Admin", href: "/admin" },
    ];
  }

  if (roles.includes("tipster")) {
    return [{ label: "Tipster", href: "/tipster" }];
  }

  return roles.includes("client")
    ? [{ label: "Client", href: "/client" }]
    : [];
}
