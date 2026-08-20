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
  signPayFast,
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

  if (provider === "payfast") {
    const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") ?? "";
    const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "";
    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
    const mode = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").toLowerCase();

    if (!merchantId || !merchantKey || !passphrase) {
      throw new Error("PayFast merchant configuration is incomplete.");
    }

    return {
      merchantId,
      merchantKey,
      passphrase,
      mode,
      actionUrl: mode === "live"
        ? "https://www.payfast.co.za/eng/process"
        : "https://sandbox.payfast.co.za/eng/process",
      notificationUrl: `${supabaseUrl}/functions/v1/payfast-itn`,
      returnFunctionUrl,
      siteUrl,
    };
  }

  const siteCode = Deno.env.get("OZOW_SITE_CODE") ?? "";
  const privateKey = Deno.env.get("OZOW_PRIVATE_KEY") ?? "";
  const apiKey = Deno.env.get("OZOW_API_KEY") ?? "";
  const mode = (Deno.env.get("OZOW_MODE") ?? "test").toLowerCase();

  if (!siteCode || !privateKey || !apiKey) {
    throw new Error("Ozow merchant configuration is incomplete.");
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

    if (!["payfast", "ozow"].includes(provider ?? "")) {
      return jsonResponse(request, { error: "Choose PayFast or Ozow." }, 400);
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
    const cartDescription = payment.items
      .map((item) => `${item.quantity}× ${item.packageName}`)
      .join(", ")
      .slice(0, 250);
    const userName = String(
      user.user_metadata?.display_name ??
        user.user_metadata?.full_name ??
        "MRC Client",
    ).trim();
    const [firstName, ...surnameParts] = userName.split(/\s+/);
    let actionUrl = configuration.actionUrl;
    let fields: Record<string, string>;

    if (provider === "payfast" && "merchantId" in configuration) {
      const orderedFields: Array<[string, string]> = [
        ["merchant_id", configuration.merchantId],
        ["merchant_key", configuration.merchantKey],
        [
          "return_url",
          paymentReturnUrl(
            configuration.returnFunctionUrl,
            payment.id,
            "success",
          ),
        ],
        [
          "cancel_url",
          paymentReturnUrl(
            configuration.returnFunctionUrl,
            payment.id,
            "cancelled",
          ),
        ],
        ["notify_url", configuration.notificationUrl],
        ["name_first", firstName || "MRC"],
        ["name_last", surnameParts.join(" ") || "Client"],
        ["email_address", user.email ?? ""],
        ["m_payment_id", payment.id],
        ["amount", amount],
        [
          "item_name",
          `${payment.purchasedCredits} MRC Credits + ${payment.rewardCredits} Reward Credits`,
        ],
        [
          "item_description",
          `MRC Racing basket (${packageQuantity} package${packageQuantity === 1 ? "" : "s"}): ${cartDescription}`,
        ],
      ];
      const signature = signPayFast(
        orderedFields,
        configuration.passphrase,
      );
      fields = Object.fromEntries([...orderedFields, ["signature", signature]]);
    } else if (provider === "ozow" && "siteCode" in configuration) {
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
        [
          "CancelUrl",
          paymentReturnUrl(
            configuration.returnFunctionUrl,
            payment.id,
            "cancelled",
          ),
        ],
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
      const hash = await signOzow(
        orderedFields.map(([, value]) => value),
        configuration.privateKey,
      );
      fields = Object.fromEntries([...orderedFields, ["HashCheck", hash]]);
    } else {
      throw new Error("The selected provider is not configured.");
    }

    return jsonResponse(request, {
      paymentId: payment.id,
      provider,
      actionUrl,
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
