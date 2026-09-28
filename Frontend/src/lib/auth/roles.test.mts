import assert from "node:assert/strict";
import test from "node:test";
import { dashboardForRoles, dashboardLinksForRoles } from "./roles.ts";

test("shows a tipster workspace without the client tab", () => {
  assert.deepEqual(
    dashboardLinksForRoles(["client", "tipster"]),
    [{ label: "Tipster", href: "/tipster" }],
  );
  assert.equal(dashboardForRoles(["client", "tipster"]), "/tipster/");
});

test("keeps all workspace links available to administrators", () => {
  assert.deepEqual(
    dashboardLinksForRoles(["client", "tipster", "administrator"]),
    [
      { label: "Client", href: "/client" },
      { label: "Tipster", href: "/tipster" },
      { label: "Admin", href: "/admin" },
    ],
  );
  assert.equal(dashboardForRoles(["administrator"]), "/admin/");
});

test("shows the client workspace for ordinary client accounts", () => {
  assert.deepEqual(
    dashboardLinksForRoles(["client"]),
    [{ label: "Client", href: "/client" }],
  );
  assert.equal(dashboardForRoles(["client"]), "/client/");
});

test("keeps administrator routing authoritative regardless of role order", () => {
  assert.equal(
    dashboardForRoles(["tipster", "client", "administrator"]),
    "/admin/",
  );
});

test("does not expose a workspace navigation link for an unknown role", () => {
  assert.deepEqual(dashboardLinksForRoles(["blog_author"]), []);
});
