import { assertEquals } from "jsr:@std/assert@1";
import { jwtHasAal2 } from "./mfa.ts";

function token(payload: Record<string, unknown>) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${encoded}.signature`;
}

Deno.test("jwtHasAal2 accepts only an AAL2 access token claim", () => {
  assertEquals(jwtHasAal2(token({ aal: "aal2" })), true);
  assertEquals(jwtHasAal2(token({ aal: "aal1" })), false);
  assertEquals(jwtHasAal2(token({})), false);
  assertEquals(jwtHasAal2("invalid"), false);
});

Deno.test("jwtHasAal2 fails closed for malformed or type-confused claims", () => {
  assertEquals(jwtHasAal2(token({ aal: 2 })), false);
  assertEquals(jwtHasAal2(token({ aal: "AAL2" })), false);
  assertEquals(jwtHasAal2("header.@@@.signature"), false);
});
