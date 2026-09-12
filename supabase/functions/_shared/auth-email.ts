export type AuthEmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email"
  | "reauthentication"
  | "password_changed_notification"
  | "email_changed_notification"
  | "phone_changed_notification"
  | "identity_linked_notification"
  | "identity_unlinked_notification"
  | "mfa_factor_enrolled_notification"
  | "mfa_factor_unenrolled_notification";

export type AuthEmailHookPayload = {
  user: {
    id: string;
    email?: string | null;
    new_email?: string | null;
  };
  email_data: {
    token?: string | null;
    token_hash?: string | null;
    redirect_to?: string | null;
    email_action_type: AuthEmailActionType;
    site_url?: string | null;
    token_new?: string | null;
    token_hash_new?: string | null;
    old_email?: string | null;
    old_phone?: string | null;
    provider?: string | null;
    factor_type?: string | null;
  };
};

export type AuthEmailJob = {
  recipient: string;
  subject: string;
  html: string;
  actionType: AuthEmailActionType;
  actionVariant: string;
  tokenHash: string;
};

type EmailContent = {
  subject: string;
  heading: string;
  introduction: string;
  actionLabel?: string;
  tokenLabel?: string;
  securityNotice: string;
};

const logoUrl = "https://www.mrcracing.co.za/images/mrc-racing-tips-logo.jpeg";

const contentByAction: Record<AuthEmailActionType, EmailContent> = {
  signup: {
    subject: "Confirm your MRC Racing Tips account",
    heading: "Confirm your account",
    introduction:
      "Confirm your email address to finish creating your MRC Racing Tips account.",
    actionLabel: "Confirm email address",
    securityNotice: "If you did not create this account, you can safely ignore this email.",
  },
  invite: {
    subject: "You have been invited to MRC Racing Tips",
    heading: "Your invitation is ready",
    introduction:
      "You have been invited to create an MRC Racing Tips account. Confirm the invitation to continue.",
    actionLabel: "Accept invitation",
    securityNotice: "If you were not expecting this invitation, you can safely ignore this email.",
  },
  magiclink: {
    subject: "Your MRC Racing Tips sign-in link",
    heading: "Sign in securely",
    introduction: "Use the secure link or one-time code below to sign in.",
    actionLabel: "Sign in securely",
    tokenLabel: "One-time sign-in code",
    securityNotice: "If you did not request this sign-in, you can safely ignore this email.",
  },
  email: {
    subject: "Your MRC Racing Tips sign-in code",
    heading: "Sign in securely",
    introduction: "Use the one-time code below to sign in.",
    actionLabel: "Sign in securely",
    tokenLabel: "One-time sign-in code",
    securityNotice: "If you did not request this sign-in, you can safely ignore this email.",
  },
  recovery: {
    subject: "Reset your MRC Racing Tips password",
    heading: "Reset your password",
    introduction: "Use the secure link below to choose a new password.",
    actionLabel: "Reset password",
    securityNotice:
      "If you did not request a password reset, ignore this email. Your current password remains unchanged.",
  },
  email_change: {
    subject: "Confirm your MRC Racing Tips email change",
    heading: "Confirm your email change",
    introduction: "Confirm this request to update the email address on your account.",
    actionLabel: "Confirm email change",
    tokenLabel: "Email-change verification code",
    securityNotice:
      "If you did not request this change, secure your account and contact MRC Racing Tips support.",
  },
  reauthentication: {
    subject: "Your MRC Racing Tips verification code",
    heading: "Verify your identity",
    introduction: "Use this one-time code to continue the secure account action.",
    tokenLabel: "Verification code",
    securityNotice: "If you did not request this action, secure your account and contact support.",
  },
  password_changed_notification: {
    subject: "Your MRC Racing Tips password was changed",
    heading: "Password changed",
    introduction: "The password for your MRC Racing Tips account was changed successfully.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  email_changed_notification: {
    subject: "Your MRC Racing Tips email was changed",
    heading: "Email address changed",
    introduction: "The email address for your MRC Racing Tips account was changed successfully.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  phone_changed_notification: {
    subject: "Your MRC Racing Tips phone number was changed",
    heading: "Phone number changed",
    introduction: "The phone number for your MRC Racing Tips account was changed successfully.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  identity_linked_notification: {
    subject: "A sign-in identity was linked to your MRC Racing Tips account",
    heading: "Sign-in identity linked",
    introduction: "A new sign-in identity was linked to your MRC Racing Tips account.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  identity_unlinked_notification: {
    subject: "A sign-in identity was removed from your MRC Racing Tips account",
    heading: "Sign-in identity removed",
    introduction: "A sign-in identity was removed from your MRC Racing Tips account.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  mfa_factor_enrolled_notification: {
    subject: "Additional verification was enabled on your MRC Racing Tips account",
    heading: "Additional verification enabled",
    introduction: "An additional verification method was enabled on your account.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
  mfa_factor_unenrolled_notification: {
    subject: "Additional verification was removed from your MRC Racing Tips account",
    heading: "Additional verification removed",
    introduction: "An additional verification method was removed from your account.",
    securityNotice: "If you did not make this change, contact support immediately.",
  },
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizedEmail(value: string | null | undefined) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function verificationUrl(
  supabaseUrl: string,
  actionType: AuthEmailActionType,
  tokenHash: string,
  redirectTo: string,
) {
  if (!tokenHash) return "";

  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", actionType);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function renderEmail(
  content: EmailContent,
  confirmationUrl: string,
  token: string,
) {
  const action = confirmationUrl && content.actionLabel
    ? `<p style="margin:28px 0;"><a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;background:#f6aa1c;color:#1b0d35;text-decoration:none;font-weight:900;font-size:16px;padding:14px 22px;border-radius:999px;border:2px solid #ffd36b;">${escapeHtml(content.actionLabel)}</a></p><p style="margin:0 0 12px;color:#bfb2dd;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p><p style="margin:0;word-break:break-all;color:#10c4d3;font-size:12px;line-height:1.6;">${escapeHtml(confirmationUrl)}</p>`
    : "";
  const code = token && content.tokenLabel
    ? `<p style="margin:22px 0 8px;color:#bfb2dd;font-size:13px;line-height:1.6;">${escapeHtml(content.tokenLabel)}</p><p style="margin:0 0 22px;padding:18px 20px;background:#241046;border:1px solid rgba(16,196,211,.5);border-radius:16px;color:#ffffff;font-size:30px;font-weight:900;letter-spacing:.16em;text-align:center;">${escapeHtml(token)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
  <body style="margin:0;background:#12051f;color:#f8f5ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.introduction)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#12051f;margin:0;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#1b0d35;border:1px solid rgba(246,170,28,.35);border-radius:22px;overflow:hidden;">
          <tr><td style="padding:24px 28px 18px;border-bottom:2px solid #f6aa1c;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
              <td><p style="margin:0 0 6px;color:#ffffff;font-size:24px;font-weight:900;letter-spacing:.04em;">MRC RACING TIPS</p><p style="margin:0;color:#10c4d3;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">Horse Racing Intelligence</p></td>
              <td width="96" align="right"><img src="${logoUrl}" width="76" height="76" alt="MRC Racing Tips" style="display:block;border:1px solid #f6aa1c;border-radius:14px;object-fit:cover;"></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 18px;color:#ffffff;font-size:28px;line-height:1.2;font-weight:900;">${escapeHtml(content.heading)}</h1>
            <p style="margin:0;color:#dfd6f7;font-size:16px;line-height:1.6;">${escapeHtml(content.introduction)}</p>
            ${code}${action}
          </td></tr>
          <tr><td style="background:#150829;padding:20px 28px;border-top:1px solid rgba(246,170,28,.22);">
            <p style="margin:0;color:#9f92bd;font-size:12px;line-height:1.6;">${escapeHtml(content.securityNotice)}<br><br>MRC Racing Tips provides South African horse-racing analysis, factual race information, and independent digital tipster content.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function createJob(
  payload: AuthEmailHookPayload,
  supabaseUrl: string,
  recipient: string,
  tokenHash: string,
  token: string,
  actionVariant: string,
  overrides: Partial<EmailContent> = {},
): AuthEmailJob {
  const actionType = payload.email_data.email_action_type;
  const content = { ...contentByAction[actionType], ...overrides };
  const redirectTo = String(payload.email_data.redirect_to ?? "").trim();
  const confirmationUrl = verificationUrl(supabaseUrl, actionType, tokenHash, redirectTo);

  return {
    recipient,
    subject: content.subject,
    html: renderEmail(content, confirmationUrl, token),
    actionType,
    actionVariant,
    tokenHash,
  };
}

export function buildAuthEmailJobs(
  payload: AuthEmailHookPayload,
  supabaseUrl: string,
) {
  const actionType = payload.email_data.email_action_type;
  if (!contentByAction[actionType]) {
    throw new Error("Unsupported authentication email action.");
  }

  const currentEmail = normalizedEmail(payload.user.email);
  const newEmail = normalizedEmail(payload.user.new_email);
  const token = String(payload.email_data.token ?? "").trim();
  const tokenHash = String(payload.email_data.token_hash ?? "").trim();
  const tokenNew = String(payload.email_data.token_new ?? "").trim();
  const tokenHashNew = String(payload.email_data.token_hash_new ?? "").trim();

  if (actionType === "email_change") {
    if (currentEmail && newEmail && tokenHash && tokenHashNew) {
      return [
        createJob(
          payload,
          supabaseUrl,
          currentEmail,
          tokenHashNew,
          token,
          "current_email",
          {
            heading: "Approve your email change",
            introduction: `Approve the request to replace ${currentEmail} with ${newEmail}.`,
            actionLabel: "Approve email change",
          },
        ),
        createJob(
          payload,
          supabaseUrl,
          newEmail,
          tokenHash,
          tokenNew,
          "new_email",
          {
            heading: "Confirm your new email",
            introduction: `Confirm ${newEmail} as the new email address for your account.`,
            actionLabel: "Confirm new email",
          },
        ),
      ];
    }

    const recipient = newEmail || currentEmail;
    if (!recipient) throw new Error("Authentication email recipient is missing.");
    return [
      createJob(
        payload,
        supabaseUrl,
        recipient,
        tokenHash || tokenHashNew,
        tokenNew || token,
        newEmail ? "new_email" : "current_email",
      ),
    ];
  }

  if (!currentEmail) throw new Error("Authentication email recipient is missing.");
  return [
    createJob(payload, supabaseUrl, currentEmail, tokenHash, token, "primary"),
  ];
}
