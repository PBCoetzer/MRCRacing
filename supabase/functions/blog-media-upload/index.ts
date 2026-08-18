import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders as supabaseCorsHeaders } from "@supabase/supabase-js/cors";

const maxBytes = 5 * 1024 * 1024;
const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);

function headers(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const {
    "Access-Control-Allow-Origin": _allowOrigin,
    ...sdkCorsHeaders
  } = supabaseCorsHeaders;
  return {
    ...sdkCorsHeaders,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(
  request: Request,
  body: unknown,
  status = 200,
  requestId = crypto.randomUUID(),
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(request), "X-Request-Id": requestId },
  });
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Cover upload failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(request) });
  }
  if (request.method !== "POST") {
    return json(request, {
      status: "failed",
      code: "METHOD_NOT_ALLOWED",
      error: "Method not allowed.",
      requestId,
    }, 405, requestId);
  }

  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return json(request, {
      status: "failed",
      code: "ORIGIN_NOT_ALLOWED",
      error: "This upload origin is not allowed.",
      requestId,
    }, 403, requestId);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const accessToken = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, {
      status: "failed",
      code: "UPLOAD_CONFIGURATION_INCOMPLETE",
      error: "Authenticated upload configuration is incomplete.",
      requestId,
    }, 500, requestId);
  }
  if (!accessToken) {
    return json(request, {
      status: "failed",
      code: "AUTHENTICATION_REQUIRED",
      error: "Authentication required.",
      requestId,
    }, 401, requestId);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser(
      accessToken,
    );
    if (authError || !authData.user) {
      return json(request, {
        status: "failed",
        code: "AUTHENTICATION_REQUIRED",
        error: "Authentication required.",
        requestId,
      }, 401, requestId);
    }

    const form = await request.formData();
    const postId = String(form.get("postId") ?? "").trim();
    const file = form.get("file");
    if (!/^[0-9a-f-]{36}$/i.test(postId) || !(file instanceof File)) {
      return json(request, {
        status: "failed",
        code: "INVALID_UPLOAD_REQUEST",
        error: "A draft post and WebP cover file are required.",
        requestId,
      }, 400, requestId);
    }
    if (file.type !== "image/webp" || file.size <= 0 || file.size > maxBytes) {
      return json(request, {
        status: "failed",
        code: "INVALID_COVER_SIZE_OR_TYPE",
        error: "Cover images must be WebP and no larger than 5 MB.",
        requestId,
      }, 400, requestId);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isWebp(bytes)) {
      return json(request, {
        status: "failed",
        code: "INVALID_WEBP_SIGNATURE",
        error: "The file signature is not a valid WebP image.",
        requestId,
      }, 400, requestId);
    }

    const { data: tipster, error: tipsterError } = await serviceClient
      .from("tipsters")
      .select("id,is_verified,tipster_blog_permissions(can_publish)")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (tipsterError) throw tipsterError;

    const { data: accountControl, error: accountError } = await serviceClient
      .from("user_account_controls")
      .select("status,suspension_until")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (accountError) throw accountError;

    const permission = Array.isArray(tipster?.tipster_blog_permissions)
      ? tipster.tipster_blog_permissions[0]
      : tipster?.tipster_blog_permissions;
    const accountActive = !accountControl ||
      ["active", "flagged"].includes(accountControl.status) ||
      (accountControl.status === "suspended" &&
        accountControl.suspension_until &&
        Date.parse(accountControl.suspension_until) <= Date.now());
    if (
      !tipster?.id || tipster.is_verified !== true ||
      permission?.can_publish !== true || !accountActive
    ) {
      return json(
        request,
        {
          status: "failed",
          code: "BLOG_PERMISSION_REQUIRED",
          error: "Blog publishing permission is required.",
          requestId,
        },
        403,
        requestId,
      );
    }

    const { data: post, error: postError } = await serviceClient
      .from("blog_posts")
      .select("id,tipster_id,status")
      .eq("id", postId)
      .eq("tipster_id", tipster.id)
      .maybeSingle();
    if (postError) throw postError;
    if (!post || !["draft", "published"].includes(post.status)) {
      return json(request, {
        status: "failed",
        code: "EDITABLE_DRAFT_REQUIRED",
        error: "An editable draft owned by this tipster is required.",
        requestId,
      }, 403, requestId);
    }

    const path = `${tipster.id}/${post.id}/cover-${Date.now()}.webp`;
    const { error: uploadError } = await serviceClient.storage
      .from("blog-media")
      .upload(path, bytes, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    const { data: publicUrl } = serviceClient.storage.from("blog-media")
      .getPublicUrl(path);
    return json(request, {
      status: "succeeded",
      path,
      publicUrl: publicUrl.publicUrl,
      requestId,
    }, 200, requestId);
  } catch (error) {
    const errorMessage = safeError(error);
    console.error(JSON.stringify({
      event: "blog_media_upload_failed",
      requestId,
      error: errorMessage,
    }));
    return json(request, {
      status: "failed",
      code: "COVER_UPLOAD_FAILED",
      error: errorMessage,
      requestId,
    }, 500, requestId);
  }
});
