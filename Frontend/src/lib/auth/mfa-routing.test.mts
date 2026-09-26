import assert from "node:assert/strict";
import test from "node:test";
import {
  destinationAfterPrimaryLogin,
  safeInternalDestination,
} from "./mfa-routing.ts";
import {
  resolveMfaProfileStatus,
  resolveMfaVerificationError,
} from "./mfa-status.ts";

test("routes enrolled users to the MFA challenge", () => {
  assert.equal(
    destinationAfterPrimaryLogin({
      currentLevel: "aal1",
      nextLevel: "aal2",
      isAdministrator: false,
      destination: "/client/#purchases",
    }),
    "/account/security/?mode=challenge&next=%2Fclient%2F%23purchases",
  );
});

test("routes administrators without a factor to MFA setup", () => {
  assert.equal(
    destinationAfterPrimaryLogin({
      currentLevel: "aal1",
      nextLevel: "aal1",
      isAdministrator: true,
      destination: "/admin/",
    }),
    "/account/security/?mode=setup&next=%2Fadmin%2F",
  );
});

test("allows AAL2 and ordinary client sessions to continue", () => {
  assert.equal(
    destinationAfterPrimaryLogin({
      currentLevel: "aal2",
      nextLevel: "aal2",
      isAdministrator: true,
      destination: "/admin/",
    }),
    "/admin/",
  );
  assert.equal(
    destinationAfterPrimaryLogin({
      currentLevel: "aal1",
      nextLevel: "aal1",
      isAdministrator: false,
      destination: "/client/",
    }),
    "/client/",
  );
});

test("rejects external and protocol-relative destinations", () => {
  assert.equal(safeInternalDestination("//example.com", "/client/"), "/client/");
  assert.equal(safeInternalDestination("https://example.com", "/client/"), "/client/");
});

test("shows optional and mandatory enrollment states", () => {
  assert.equal(
    resolveMfaProfileStatus({ currentLevel: "aal1", verifiedFactorCount: 0, required: false }).badge,
    "Not enabled",
  );
  assert.equal(
    resolveMfaProfileStatus({ currentLevel: "aal1", verifiedFactorCount: 0, required: true }).badge,
    "Required",
  );
});

test("distinguishes enrolled and verified browser sessions", () => {
  assert.equal(
    resolveMfaProfileStatus({ currentLevel: "aal1", verifiedFactorCount: 1, required: false }).action,
    "Verify this browser",
  );
  assert.equal(
    resolveMfaProfileStatus({ currentLevel: "aal2", verifiedFactorCount: 1, required: false }).badge,
    "Enabled · browser verified",
  );
});

test("turns invalid TOTP responses into actionable recovery guidance", () => {
  const result = resolveMfaVerificationError(new Error("Invalid TOTP code entered"));

  assert.equal(result.invalidCode, true);
  assert.match(result.message, /automatic date\/time/i);
  assert.match(result.message, /new QR code/i);
});

test("preserves unexpected MFA errors", () => {
  const result = resolveMfaVerificationError(new Error("MFA service unavailable"));

  assert.equal(result.invalidCode, false);
  assert.equal(result.message, "MFA service unavailable");
});
