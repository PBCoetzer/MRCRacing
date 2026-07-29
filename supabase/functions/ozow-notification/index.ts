import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  isPaymentsEnabled,
  safeEqual,
  safeMoney,
  sanitizeProviderEvent,
  signOzow,
  textResponse,
} from "../_shared/payments.ts";

function value(
  payload: Record<string, string>,
  key: string,
  fallbackKey = "",
) {
  return payload[key] ?? (fallbackKey ? payload[fallbackKey] : "") ?? "";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return textResponse("Method not allowed.", 405);
  }

  try {
    if (!isPaymentsEnabled()) {
      return textResponse("Payments disabled.", 503);
    }

    const contentType = request.headers.get("content-type") ?? "";
    let payload: Record<string, string>;

    if (contentType.includes("application/json")) {
      const json = await request.json() as Record<string, unknown>;
      payload = Object.fromEntries(
        Object.entries(json).map(([key, item]) => [key, String(item ?? "")]),
      );
    } else {
      payload = Object.fromEntries(new URLSearchParams(await request.text()));
    }

    const siteCode = Deno.env.get("OZOW_SITE_CODE") ?? "";
    const privateKey = Deno.env.get("OZOW_PRIVATE_KEY") ?? "";
    const apiKey = Deno.env.get("OZOW_API_KEY") ?? "";
    const transactionReference = value(
      payload,
      "TransactionReference",
      "transactionReference",
    );
    const transactionId = value(payload, "TransactionId", "transactionId");
    const suppliedHash = value(payload, "Hash", "hash");
    const orderedValues = [
      value(payload, "SiteCode", "siteCode"),
      transactionId,
      transactionReference,
      value(payload, "Amount", "amount"),
      value(payload, "Status", "status"),
      value(payload, "Optional1", "optional1"),
      value(payload, "Optional2", "optional2"),
      value(payload, "Optional3", "optional3"),
      value(payload, "Optional4", "optional4"),
      value(payload, "Optional5", "optional5"),
      value(payload, "CurrencyCode", "currencyCode"),
      value(payload, "IsTest", "isTest"),
      value(payload, "StatusMessage", "statusMessage"),
    ];

    if (
      !siteCode ||
      !privateKey ||
      !apiKey ||
      !transactionReference ||
      !transactionId ||
      !suppliedHash
    ) {
      return textResponse("Invalid request.", 400);
    }

    const expectedHash = await signOzow(orderedValues, privateKey);

    if (!safeEqual(suppliedHash, expectedHash)) {
      return textResponse("Invalid hash.", 400);
    }

    if (!safeEqual(value(payload, "SiteCode", "siteCode"), siteCode)) {
      return textResponse("Invalid site code.", 400);
    }

    const serviceClient = createServiceClient();
    const { data: payment, error: paymentError } = await serviceClient
      .from("payments")
      .select("id, amount_cents, status, provider")
      .eq("id", transactionReference)
      .maybeSingle();

    if (paymentError || !payment || payment.provider !== "ozow") {
      return textResponse("Payment not found.", 404);
    }

    if (value(payload, "Amount", "amount") !== safeMoney(payment.amount_cents)) {
      return textResponse("Invalid amount.", 400);
    }

    const verificationUrl = new URL(
      "https://api.ozow.com/GetTransactionByReference",
    );
    verificationUrl.searchParams.set("siteCode", siteCode);
    verificationUrl.searchParams.set(
      "transactionReference",
      transactionReference,
    );
    const verificationResponse = await fetch(verificationUrl, {
      headers: { ApiKey: apiKey },
    });
    const verification = await verificationResponse.json().catch(() => ({})) as
      Record<string, unknown>;
    const verifiedStatus = String(
      verification.status ?? verification.Status ?? "",
    );
    const verifiedAmount = Number(
      verification.amount ?? verification.Amount ?? Number.NaN,
    );
    const verifiedReference = String(
      verification.transactionReference ??
        verification.TransactionReference ??
        "",
    );

    if (
      !verificationResponse.ok ||
      verifiedReference !== transactionReference ||
      verifiedAmount.toFixed(2) !== safeMoney(payment.amount_cents)
    ) {
      return textResponse("Provider confirmation failed.", 400);
    }

    const notificationStatus = value(payload, "Status", "status");

    if (
      !safeEqual(notificationStatus, "Complete") ||
      !safeEqual(verifiedStatus, "Complete")
    ) {
      return textResponse("Acknowledged.", 200);
    }

    const sanitizedEvent = sanitizeProviderEvent(payload, [
      "SiteCode",
      "TransactionId",
      "TransactionReference",
      "Amount",
      "Status",
      "CurrencyCode",
      "IsTest",
      "StatusMessage",
    ]);
    const { error: completionError } = await serviceClient.rpc(
      "complete_credit_payment",
      {
        p_payment_id: payment.id,
        p_provider: "ozow",
        p_provider_reference: transactionId,
        p_sanitized_event: sanitizedEvent,
      },
    );

    if (completionError) {
      throw new Error(completionError.message);
    }

    return textResponse("OK");
  } catch (error) {
    console.error(
      "Ozow notification failed",
      error instanceof Error ? error.message : error,
    );
    return textResponse("Processing failed.", 500);
  }
});
