import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardViewChangeEvent,
  dashboardViewFromHref,
  handleDashboardViewLinkClick,
  isSameDashboardPath,
  type DashboardLinkClick,
} from "./dashboard-navigation.ts";

test("reads dashboard views from hash links", () => {
  assert.equal(dashboardViewFromHref("/tipster/#meeting-cards"), "meeting-cards");
  assert.equal(dashboardViewFromHref("/tipster/"), null);
});

test("treats trailing slashes as the same dashboard path", () => {
  assert.equal(isSameDashboardPath("/tipster", "/tipster/"), true);
  assert.equal(isSameDashboardPath("/tipster/", "/client/"), false);
});

test("activates a same-page dashboard view without relying on hashchange", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let currentUrl = new URL("https://www.mrcracing.co.za/tipster/#overview");
  let pushCount = 0;
  let prevented = false;
  let requestedView = "";
  const fakeWindow = {
    get location() {
      return currentUrl;
    },
    history: {
      state: null,
      pushState(_state: unknown, _title: string, url: string | URL) {
        pushCount += 1;
        currentUrl = new URL(String(url), currentUrl);
      },
    },
    dispatchEvent(event: Event) {
      if (event.type === dashboardViewChangeEvent && event instanceof CustomEvent) {
        requestedView = String(event.detail);
      }
      return true;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    const event: DashboardLinkClick = {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      currentTarget: {
        href: "https://www.mrcracing.co.za/tipster/#meeting-cards",
      },
      preventDefault() {
        prevented = true;
      },
    };

    assert.equal(handleDashboardViewLinkClick(event), true);
    assert.equal(prevented, true);
    assert.equal(pushCount, 1);
    assert.equal(currentUrl.hash, "#meeting-cards");
    assert.equal(requestedView, "meeting-cards");

    assert.equal(handleDashboardViewLinkClick(event), true);
    assert.equal(pushCount, 1);
    assert.equal(requestedView, "meeting-cards");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("preserves modified clicks for normal browser navigation", () => {
  const event: DashboardLinkClick = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    currentTarget: {
      href: "https://www.mrcracing.co.za/tipster/#meeting-cards",
    },
    preventDefault() {
      throw new Error("Modified clicks must not be intercepted.");
    },
  };

  assert.equal(handleDashboardViewLinkClick(event), false);
});
