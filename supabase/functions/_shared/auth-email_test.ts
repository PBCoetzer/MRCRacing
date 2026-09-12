import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildAuthEmailJobs, type AuthEmailHookPayload } from "./auth-email.ts";

function payload(
  overrides: Partial<AuthEmailHookPayload["email_data"]> = {},
): AuthEmailHookPayload {
  return {
    user: {
      id: "6da8473c-62c1-4f28-9462-957f4fe4eb0d",
      email: "client@example.com",
    },
    email_data: {
      token: "123456",
      token_hash: "signup-token-hash",
      redirect_to: "https://www.mrcracing.co.za/login/",
      email_action_type: "signup",
      site_url: "https://www.mrcracing.co.za",
      token_new: "",
      token_hash_new: "",
      ...overrides,
    },
  };
}

Deno.test("builds a branded signup confirmation", () => {
  const jobs = buildAuthEmailJobs(
    payload(),
    "https://cjgfvqgiqrphmakruqnk.supabase.co",
  );

  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].recipient, "client@example.com");
  assertEquals(jobs[0].actionType, "signup");
  assertStringIncludes(jobs[0].html, "MRC RACING TIPS");
  assertStringIncludes(jobs[0].html, "token=signup-token-hash");
});

Deno.test("secure email change sends correctly mapped current and new email tokens", () => {
  const emailChangePayload = payload({
    email_action_type: "email_change",
    token: "111111",
    token_hash: "hash-for-new-email",
    token_new: "222222",
    token_hash_new: "hash-for-current-email",
  });
  emailChangePayload.user.new_email = "new@example.com";

  const jobs = buildAuthEmailJobs(
    emailChangePayload,
    "https://cjgfvqgiqrphmakruqnk.supabase.co",
  );

  assertEquals(jobs.length, 2);
  assertEquals(jobs[0].recipient, "client@example.com");
  assertStringIncludes(jobs[0].html, "token=hash-for-current-email");
  assertEquals(jobs[1].recipient, "new@example.com");
  assertStringIncludes(jobs[1].html, "token=hash-for-new-email");
});
