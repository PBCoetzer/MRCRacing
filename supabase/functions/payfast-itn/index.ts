import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  isPayFastSource,
  isPaymentsEnabled,
  providerReferenceFromPayload,
  safeEqual,
  safeMoney,
  sanitizeProviderEvent,
  signPayFast,
  textResponse,
} from "../_shared/payments.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return textResponse("Method not allowed.", 405);
  }

  try {
    if (!isPaymentsEnabled()) {
      return textResponse("Payments disabled.", 503);
    }

    const rawBody = await request.text();
    const formData = new URLSearchParams(rawBody);
    const orderedFields = Array.from(formData.entries());
    const payload = Object.fromEntries(orderedFields);
    const paymentId = payload.m_payment_id ?? "";
    const signature = payload.signature ?? "";
    const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") ?? "";
    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
    const mode = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").toLowerCase();
    const allowSandboxSource = (
      Deno.env.get("PAYFAST_ALLOW_UNVERIFIED_SANDBOX_SOURCE") ?? ""
    ).toLowerCase() === "true";

    if (!paymentId || !signature || !merchantId || !passphrase) {
      return textResponse("Invalid request.", 400);
    }

    if (
      !isPayFastSource(request) &&
      !(mode !== "live" && allowSandboxSource)
    ) {
      return textResponse("Invalid source.", 403);
    }

    const expectedSignature = signPayFast(orderedFields, passphrase);

    if (!safeEqual(signature, expectedSignature)) {
      return textResponse("Invalid signature.", 400);
    }

    if (payload.merchant_id !== merchantId) {
      return textResponse("Invalid merchant.", 400);
    }

    const validationUrl = mode === "live"
      ? "https://www.payfast.co.za/eng/query/validate"
      : "https://sandbox.payfast.co.za/eng/query/validate";
    const validationResponse = await fetch(validationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const validationBody = (await validationResponse.text()).trim();

    if (!validationResponse.ok || validationBody !== "VALID") {
      return textResponse("Provider validation failed.", 400);
    }

    const serviceClient = createServiceClient();
    const { data: payment, error: paymentError } = await serviceClient
      .from("payments")
      .select("id, amount_cents, status, provider")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentError || !payment || payment.provider !== "payfast") {
      return textResponse("Payment not found.", 404);
    }

    if (payload.amount_gross !== safeMoney(payment.amount_cents)) {
      return textResponse("Invalid amount.", 400);
    }

    if ((payload.payment_status ?? "").toUpperCase() !== "COMPLETE") {
      return textResponse("Acknowledged.", 200);
    }

    const sanitizedEvent = sanitizeProviderEvent(payload, [
      "m_payment_id",
      "pf_payment_id",
      "payment_status",
      "amount_gross",
      "amount_fee",
      "amount_net",
      "item_name",
      "merchant_id",
    ]);
    const { error: completionError } = await serviceClient.rpc(
      "complete_credit_payment",
      {
        p_payment_id: payment.id,
        p_provider: "payfast",
        p_provider_reference: providerReferenceFromPayload(payload),
        p_sanitized_event: sanitizedEvent,
      },
    );

    if (completionError) {
      throw new Error(completionError.message);
    }

    return textResponse("OK");
  } catch (error) {
    console.error(
      "PayFast ITN failed",
      error instanceof Error ? error.message : error,
    );
    return textResponse("Processing failed.", 500);
  }
});
