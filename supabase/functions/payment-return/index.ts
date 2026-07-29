import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (request: Request) => {
  const requestUrl = new URL(request.url);
  const siteUrl = Deno.env.get("PAYMENT_SITE_URL") ??
    "https://www.mrcracing.co.za";
  let paymentId = requestUrl.searchParams.get("payment") ?? "";
  const outcome = requestUrl.searchParams.get("outcome") ?? "pending";

  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await request.json().catch(() => ({})) as Record<string, unknown>
      : Object.fromEntries(new URLSearchParams(await request.text()));
    paymentId = paymentId ||
      String(
        payload.TransactionReference ??
          payload.transactionReference ??
          payload.m_payment_id ??
          "",
      );
  }

  const redirectUrl = new URL("/payment-status/", siteUrl);

  if (paymentId) {
    redirectUrl.searchParams.set("payment", paymentId);
  }

  redirectUrl.searchParams.set("outcome", outcome);

  return Response.redirect(redirectUrl, 303);
});
