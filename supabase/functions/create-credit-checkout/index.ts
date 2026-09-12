import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  createServiceClient,
  isPaymentsEnabled,
  jsonResponse,
  paymentReturnUrl,
  PaymentProvider,
  requireUser,
  safeMoney,
  signOzow,
  validateOzowPostFields,
} from "../_shared/payments.ts";

type CheckoutRequest = {
  packageId?: string;
  items?: Array<{
    packageId?: string;
    quantity?: number;
  }>;
  provider?: PaymentProvider;
};

type CheckoutRecord = {
  id: string;
  userId: string;
  provider: PaymentProvider;
  amountCents: number;
  purchasedCredits: number;
  rewardCredits: number;
  credits: number;
  status: "pending";
  expiresAt: string;
  cartFingerprint: string;
  items: Array<{
    packageId: string;
    packageName: string;
    quantity: number;
    purchasedCreditsEach: number;
    rewardCreditsEach: number;
    unitPriceCents: number;
  }>;
};

function checkoutConfiguration(provider: PaymentProvider) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const returnFunctionUrl = `${supabaseUrl}/functions/v1/payment-return`;
  const siteUrl = Deno.env.get("PAYMENT_SITE_URL") ??
    "https://www.mrcracing.co.za";

  if (provider !== "ozow") {
    throw new Error("Only Ozow checkout is currently available.");
  }

  const siteCode = (Deno.env.get("OZOW_SITE_CODE") ?? "").trim();
  const privateKey = (
    Deno.env.get("OZOW_SECRET_KEY") ??
      Deno.env.get("OZOW_PRIVATE_KEY") ??
      ""
  ).trim();
  const apiKey = (Deno.env.get("OZOW_API_KEY") ?? "").trim();
  const mode = (Deno.env.get("OZOW_MODE") ?? "live").trim().toLowerCase();

  if (!siteCode || !privateKey || !apiKey) {
    throw new Error("Ozow merchant configuration is incomplete.");
  }

  if (mode !== "live" && mode !== "test") {
    throw new Error("OZOW_MODE must be either live or test.");
  }

  return {
    siteCode,
    privateKey,
    apiKey,
    mode,
    actionUrl: "https://pay.ozow.com",
    notificationUrl: `${supabaseUrl}/functions/v1/ozow-notification`,
    returnFunctionUrl,
    siteUrl,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  }

  try {
    if (!isPaymentsEnabled()) {
      return jsonResponse(
        request,
        {
          error:
            "Online Credit purchases are not yet enabled. Merchant setup is still in progress.",
          code: "payments_disabled",
        },
        503,
      );
    }

    const serviceClient = createServiceClient();
    const user = await requireUser(request, serviceClient);
    const payload = await request.json() as CheckoutRequest;
    const provider = payload.provider;
    const requestedItems = Array.isArray(payload.items)
      ? payload.items
      : payload.packageId
      ? [{ packageId: payload.packageId, quantity: 1 }]
      : [];
    const idempotencyKey =
      (request.headers.get("x-idempotency-key") ?? "").trim();

    if (provider !== "ozow") {
      return jsonResponse(request, { error: "Choose Ozow checkout." }, 400);
    }

    if (
      !requestedItems.length ||
      requestedItems.length > 20 ||
      requestedItems.some((item) =>
        !item.packageId ||
        !Number.isInteger(item.quantity) ||
        Number(item.quantity) < 1 ||
        Number(item.quantity) > 20
      ) ||
      !idempotencyKey ||
      idempotencyKey.length > 200
    ) {
      return jsonResponse(
        request,
        { error: "A valid basket and idempotency key are required." },
        400,
      );
    }

    const { data: paymentData, error: paymentError } = await serviceClient.rpc(
      "create_credit_checkout_record",
      {
        p_user_id: user.id,
        p_provider: provider,
        p_items: requestedItems.map((item) => ({
          packageId: String(item.packageId),
          quantity: Number(item.quantity),
        })),
        p_idempotency_key: idempotencyKey,
      },
    );

    if (paymentError || !paymentData) {
      throw new Error(paymentError?.message ?? "Unable to create checkout.");
    }

    const payment = paymentData as CheckoutRecord;
    const expiresAt = payment.expiresAt;

    const configuration = checkoutConfiguration(provider as PaymentProvider);
    const amount = safeMoney(payment.amountCents);
    const packageQuantity = payment.items.reduce(
      (total, item) => total + item.quantity,
      0,
    );
    const orderedFields: Array<[string, string]> = [
      ["SiteCode", configuration.siteCode],
      ["CountryCode", "ZA"],
      ["CurrencyCode", "ZAR"],
      ["Amount", amount],
      ["TransactionReference", payment.id],
      ["BankReference", `MRC-${payment.id.slice(0, 8)}`],
      ["Optional1", user.id],
      ["Optional2", payment.cartFingerprint],
      ["Optional3", ""],
      ["Optional4", ""],
      ["Optional5", ""],
      ["Customer", user.email ?? user.id],
      ["CancelUrl", `${configuration.siteUrl.replace(/\/+$/, "")}/pricing/`],
      [
        "ErrorUrl",
        paymentReturnUrl(
          configuration.returnFunctionUrl,
          payment.id,
          "error",
        ),
      ],
      [
        "SuccessUrl",
        paymentReturnUrl(
          configuration.returnFunctionUrl,
          payment.id,
          "success",
        ),
      ],
      ["NotifyUrl", configuration.notificationUrl],
      ["IsTest", String(configuration.mode !== "live").toLowerCase()],
    ];
    validateOzowPostFields(orderedFields);
    const hash = await signOzow(
      orderedFields.map(([, value]) => value),
      configuration.privateKey,
    );
    const fields = Object.fromEntries([
      ...orderedFields,
      ["HashCheck", hash],
    ]);

    return jsonResponse(request, {
      paymentId: payment.id,
      provider,
      actionUrl: configuration.actionUrl,
      fields,
      expiresAt,
      purchasedCredits: payment.purchasedCredits,
      rewardCredits: payment.rewardCredits,
      credits: payment.credits,
      itemCount: packageQuantity,
      returnUrl: `${configuration.siteUrl}/payment-status/?payment=${payment.id}`,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unable to create checkout.";
    const status = message.toLowerCase().includes("auth") ||
        message.toLowerCase().includes("session")
      ? 401
      : 500;
    console.error("Credit checkout failed", message);
    return jsonResponse(request, { error: message }, status);
  }
});
