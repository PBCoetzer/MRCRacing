export const dashboardViewChangeEvent = "mrc-dashboard-view-change";

export type DashboardLinkClick = {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  currentTarget: {
    href: string;
  };
  preventDefault: () => void;
};

function normalizedPathname(pathname: string) {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function dashboardViewFromHref(href: string) {
  const hash = new URL(href, "https://dashboard.invalid/").hash.replace(/^#/, "");
  return hash ? decodeURIComponent(hash) : null;
}

export function isSameDashboardPath(leftPathname: string, rightPathname: string) {
  return normalizedPathname(leftPathname) === normalizedPathname(rightPathname);
}

export function handleDashboardViewLinkClick(event: DashboardLinkClick) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  const view = dashboardViewFromHref(event.currentTarget.href);
  if (!view) {
    return false;
  }

  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(event.currentTarget.href, currentUrl);

  if (
    targetUrl.origin !== currentUrl.origin ||
    !isSameDashboardPath(targetUrl.pathname, currentUrl.pathname)
  ) {
    return false;
  }

  event.preventDefault();

  if (targetUrl.href !== currentUrl.href) {
    window.history.pushState(window.history.state, "", targetUrl.href);
  }

  window.dispatchEvent(new CustomEvent(dashboardViewChangeEvent, {
    detail: view,
  }));

  return true;
}
