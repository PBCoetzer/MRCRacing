export function getSiteUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

    if (isLocalhost) {
      return window.location.origin;
    }

    return configuredSiteUrl || window.location.origin;
  }

  return configuredSiteUrl || "http://localhost:3000";
}
