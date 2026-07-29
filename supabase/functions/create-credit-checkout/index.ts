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
  provider?: PaymentProvider;
};

type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
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
    const packageId = String(payload.packageId ?? "");
    const idempotencyKey =
      (request.headers.get("x-idempotency-key") ?? "").trim();

    if (!["payfast", "ozow"].includes(provider ?? "")) {
      return jsonResponse(request, { error: "Choose PayFast or Ozow." }, 400);
    }

    if (!packageId || !idempotencyKey || idempotencyKey.length > 200) {
      return jsonResponse(
        request,
        { error: "A valid package and idempotency key are required." },
        400,
      );
    }

    const { data: packageData, error: packageError } = await serviceClient
      .from("credit_packages")
      .select("id, name, credits, price_cents")
      .eq("id", packageId)
      .eq("is_active", true)
      .maybeSingle();

    if (packageError || !packageData) {
      return jsonResponse(request, { error: "Credit package not found." }, 404);
    }

    const creditPackage = packageData as CreditPackage;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const paymentInsert = {
      user_id: user.id,
      provider,
      amount_cents: creditPackage.price_cents,
      currency: "ZAR",
      credits: creditPackage.credits,
      status: "pending",
      idempotency_key: idempotencyKey,
      credit_package_id: creditPackage.id,
      checkout_expires_at: expiresAt,
      raw_event: {
        checkoutCreatedAt: new Date().toISOString(),
        packageName: creditPackage.name,
      },
    };
    const { data: insertedPayment, error: insertError } = await serviceClient
      .from("payments")
      .insert(paymentInsert)
      .select("id, user_id, provider, amount_cents, credits, status, credit_package_id")
      .single();
    let payment = insertedPayment;

    if (insertError?.code === "23505") {
      const { data: existingPayment, error: existingError } = await serviceClient
        .from("payments")
        .select("id, user_id, provider, amount_cents, credits, status, credit_package_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingError || !existingPayment) {
        throw new Error("Unable to resume this checkout.");
      }

      payment = existingPayment;
    } else if (insertError || !payment) {
      throw new Error(insertError?.message ?? "Unable to create checkout.");
    }

    if (
      payment.user_id !== user.id ||
      payment.provider !== provider ||
      payment.credit_package_id !== creditPackage.id ||
      payment.amount_cents !== creditPackage.price_cents ||
      payment.credits !== creditPackage.credits ||
      payment.status !== "pending"
    ) {
      return jsonResponse(
        request,
        { error: "This checkout request cannot be reused." },
        409,
      );
    }

    const configuration = checkoutConfiguration(provider as PaymentProvider);
    const amount = safeMoney(creditPackage.price_cents);
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
        ["item_name", `${creditPackage.credits} MRC Credits`],
        [
          "item_description",
          `MRC Racing ${creditPackage.name} Credit package`,
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
        ["Optional2", creditPackage.id],
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
