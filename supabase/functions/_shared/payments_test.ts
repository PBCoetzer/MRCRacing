import {
  corsHeaders,
  createOzowPaymentRequest,
  selectOzowVerificationRecord,
  validateOzowPostFields,
} from "./payments.ts";

Deno.test("payment CORS permits Supabase browser client headers", () => {
  const request = new Request("https://example.com", {
    headers: { Origin: "https://www.mrcracing.co.za" },
  });
  const headers = corsHeaders(request);

  if (!headers["Access-Control-Allow-Headers"].includes("x-client-info")) {
    throw new Error("x-client-info must be permitted.");
  }

  if (!headers["Access-Control-Allow-Headers"].includes("x-idempotency-key")) {
    throw new Error("x-idempotency-key must be permitted.");
  }
});

Deno.test("Ozow verification selects a matching array record", () => {
  const record = selectOzowVerificationRecord(
    [
      {
        TransactionReference: "other-reference",
        TransactionId: "other-transaction",
      },
      {
        TransactionReference: "payment-reference",
        TransactionId: "ozow-transaction",
        Status: "Complete",
      },
    ],
    "payment-reference",
    "ozow-transaction",
  );

  if (record?.Status !== "Complete") {
    throw new Error("Expected the matching Ozow record.");
  }
});

Deno.test("Ozow verification rejects a mismatched transaction id", () => {
  const record = selectOzowVerificationRecord(
    {
      TransactionReference: "payment-reference",
      TransactionId: "unexpected-transaction",
    },
    "payment-reference",
    "ozow-transaction",
  );

  if (record !== null) {
    throw new Error("A mismatched transaction id must be rejected.");
  }
});

Deno.test("Ozow post fields reject an oversized cancel URL", () => {
  let rejected = false;

  try {
    validateOzowPostFields([
      ["CancelUrl", `https://example.com/${"x".repeat(40)}`],
    ]);
  } catch {
    rejected = true;
  }

  if (!rejected) {
    throw new Error("An oversized CancelUrl must be rejected.");
  }
});

Deno.test("Ozow post fields accept the production callback lengths", () => {
  validateOzowPostFields([
    ["SiteCode", "MRC"],
    ["TransactionReference", "00aae271-3bf8-4d7a-9a36-12c4e8f225f6"],
    ["BankReference", "MRC-00aae271"],
    [
      "SuccessUrl",
      "https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/payment-return?payment=00aae271-3bf8-4d7a-9a36-12c4e8f225f6&outcome=success",
    ],
    [
      "NotifyUrl",
      "https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/ozow-notification",
    ],
  ]);
});

Deno.test("Ozow payment request returns only a trusted secure URL", async () => {
  const result = await createOzowPaymentRequest(
    { SiteCode: "MRC", HashCheck: "signed" },
    "api-key",
    async (input, init) => {
      if (String(input) !== "https://api.ozow.com/PostPaymentRequest") {
        throw new Error("Unexpected Ozow payment endpoint.");
      }

      if (new Headers(init?.headers).get("ApiKey") !== "api-key") {
        throw new Error("Ozow API key header was not supplied.");
      }

      return new Response(JSON.stringify({
        errorMessage: null,
        paymentRequestId: "payment-request-id",
        url: "https://pay.ozow.com/payment-request-id/Secure",
      }), { status: 200 });
    },
  );

  if (result.url !== "https://pay.ozow.com/payment-request-id/Secure") {
    throw new Error("Expected the trusted Ozow payment URL.");
  }
});

Deno.test("Ozow payment request surfaces a sanitized provider error", async () => {
  let message = "";

  try {
    await createOzowPaymentRequest(
      { SiteCode: "MRC", HashCheck: "signed" },
      "api-key",
      () =>
        Promise.resolve(new Response(JSON.stringify({
          errorMessage: "Invalid site code.\nPlease retry.",
        }), { status: 400 })),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }

  if (message !== "Ozow rejected checkout: Invalid site code. Please retry.") {
    throw new Error("Expected the sanitized Ozow provider error.");
  }
});

Deno.test("Ozow payment request surfaces validation details", async () => {
  let message = "";

  try {
    await createOzowPaymentRequest(
      { SiteCode: "MRC", HashCheck: "signed" },
      "api-key",
      () =>
        Promise.resolve(new Response(JSON.stringify({
          title: "One or more validation errors occurred.",
          errors: {
            HashCheck: ["Hash Check invalid"],
          },
        }), { status: 400 })),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }

  if (message !== "Ozow rejected checkout: HashCheck: Hash Check invalid") {
    throw new Error("Expected Ozow validation details.");
  }
});

Deno.test("Ozow payment request rejects an untrusted redirect URL", async () => {
  let rejected = false;

  try {
    await createOzowPaymentRequest(
      { SiteCode: "MRC", HashCheck: "signed" },
      "api-key",
      () =>
        Promise.resolve(new Response(JSON.stringify({
          errorMessage: null,
          paymentRequestId: "payment-request-id",
          url: "https://example.com/not-ozow",
        }), { status: 200 })),
    );
  } catch {
    rejected = true;
  }

  if (!rejected) {
    throw new Error("An untrusted Ozow redirect must be rejected.");
  }
});
