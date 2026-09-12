"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Banknote,
  CheckCircle2,
  CircleUserRound,
  ClipboardList,
  Coins,
  Download,
  FileCheck2,
  FileWarning,
  Flag,
  History,
  Loader2,
  MailPlus,
  Newspaper,
  NotebookPen,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCredits, formatRaceDateTime } from "@/lib/racing/format";
import {
  tipsterApplicationStatusLabel,
  type TipsterApplication,
  type TipsterApplicationDocument,
} from "@/lib/tipster-application";
import { createClient } from "@/lib/supabase/client";

type AppRole = "client" | "tipster" | "administrator";
type AccountStatus = "active" | "flagged" | "suspended" | "banned";
type ModerationAction = "flag" | "suspend" | "ban" | "restore";

type EmailConfirmationActionRecord = {
  id: string;
  action: "resend_confirmation" | "verify_email";
  reason: string;
  status: "processing" | "succeeded" | "failed";
  sanitized_error: string | null;
  completed_at: string | null;
  created_at: string;
};

type RegistrationDeliveryState =
  | "manually_verified"
  | "confirmed"
  | "dispatched_unverified"
  | "not_dispatched";

type AuthEmailProviderStatus =
  | "pending"
  | "accepted"
  | "sent"
  | "delivery_delayed"
  | "delivered"
  | "bounced"
  | "complained"
  | "suppressed"
  | "failed";

type AuthEmailDeliveryMessage = {
  id: string;
  provider: string;
  providerMessageId: string | null;
  recipientEmail: string;
  emailActionType: string;
  actionVariant: string;
  subject: string;
  status: AuthEmailProviderStatus;
  attemptCount: number;
  acceptedAt: string | null;
  latestEventAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  suppressedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
};

type AuthEmailDeliveryEvent = {
  providerEventId: string;
  messageId: string | null;
  provider: string;
  providerEmailId: string;
  eventType: string;
  eventAt: string;
  details: Record<string, unknown>;
};

type AuthEmailDeliveryDiagnostics = {
  providerTracked: boolean;
  latestSignup: Omit<
    AuthEmailDeliveryMessage,
    "id" | "recipientEmail" | "emailActionType" | "actionVariant" | "subject" | "attemptCount" | "createdAt"
  > | null;
  messages: AuthEmailDeliveryMessage[];
  events: AuthEmailDeliveryEvent[];
};

type RegistrationDiagnostics = {
  auth: {
    userId: string;
    email: string;
    phone: string | null;
    audience: string | null;
    authRole: string | null;
    createdAt: string;
    updatedAt: string;
    invitedAt: string | null;
    confirmationSentAt: string | null;
    emailConfirmedAt: string | null;
    recoverySentAt: string | null;
    emailChangeSentAt: string | null;
    emailChangePending: string | null;
    reauthenticationSentAt: string | null;
    phoneConfirmedAt: string | null;
    lastSignInAt: string | null;
    bannedUntil: string | null;
    deletedAt: string | null;
    isSsoUser: boolean;
    isAnonymous: boolean;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    phone: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    acceptedTermsAt: string | null;
    acceptedTermsVersion: string | null;
    confirmedOver18At: string | null;
    emailNotificationsEnabled: boolean | null;
  };
  providers: {
    id: string;
    provider: string;
    email: string | null;
    createdAt: string;
    updatedAt: string;
    lastSignInAt: string | null;
  }[];
  delivery: {
    state: RegistrationDeliveryState;
    providerDeliveryTracked: boolean;
    providerDeliveryStatus: string | null;
    note: string;
  };
  events: {
    id: string;
    eventType: string;
    source:
      | "auth_trigger"
      | "auth_snapshot_backfill"
      | "auth_email_hook"
      | "email_provider_webhook";
    email: string | null;
    eventAt: string;
    details: Record<string, unknown>;
  }[];
  confirmationActions: {
    id: string;
    requestId: string;
    action: "resend_confirmation" | "verify_email";
    reason: string;
    status: "processing" | "succeeded" | "failed";
    sanitizedError: string | null;
    createdAt: string;
    completedAt: string | null;
    actorId: string;
    actorName: string | null;
    actorEmail: string | null;
  }[];
};

type UserDetail = {
  identity: {
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    phone: string | null;
    emailConfirmed: boolean;
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
    createdAt: string;
    isOwner: boolean;
  };
  roles: AppRole[];
  moderation: {
    status: AccountStatus;
    category: string | null;
    internalReason: string | null;
    publicMessage: string | null;
    suspensionUntil: string | null;
    authSyncStatus: "synced" | "pending" | "failed";
    authBannedUntil: string | null;
    lastAuthSyncError: string | null;
    pendingAction: string | null;
    updatedAt: string | null;
  };
  access: {
    testAccess: boolean;
    tipsterId: string | null;
    tipsterDisplayName: string | null;
    tipsterBiography: string | null;
    tipsterVerified: boolean;
  };
  wallet: {
    balance: number;
    transactions: {
      id: string;
      type: string;
      amount: number;
      balanceAfter: number;
      reason: string | null;
      createdBy: string | null;
      createdAt: string;
    }[];
  };
  purchases: {
    id: string;
    type: string;
    status: string;
    credits: number;
    tipsterName: string | null;
    meetingCard: string | null;
    subscriptionPackage: string | null;
    refundedAt: string | null;
    createdAt: string;
  }[];
  subscriptions: {
    id: string;
    status: string;
    tipsterName: string;
    packageName: string;
    startsAt: string;
    endsAt: string;
    createdAt: string;
  }[];
  disputes: {
    id: string;
    purchaseId: string;
    reason: string;
    status: string;
    adminNotes: string | null;
    resolvedAt: string | null;
    createdAt: string;
  }[];
  tipsterActivity: {
    cards: {
      id: string;
      title: string;
      status: string;
      creditPrice: number;
      revision: number;
      publishedAt: string | null;
      createdAt: string;
    }[];
    earnings: {
      id: string;
      type: string;
      grossCredits: number;
      platformFeeCredits: number;
      netCredits: number;
      createdAt: string;
    }[];
  };
  notes: {
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    createdAt: string;
  }[];
  auditHistory: {
    id: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }[];
};

type TipsterWorkspace = {
  loadedAt: string;
  tipsterId: string | null;
  packages: {
    id: string;
    name: string;
    durationMonths: number;
    priceCredits: number;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  sales: {
    id: string;
    type: "meeting" | "subscription";
    status: string;
    totalCredits: number;
    purchasedCredits: number;
    rewardCredits: number;
    buyerEmail: string;
    buyerName: string | null;
    sourceLabel: string;
    refundedAt: string | null;
    createdAt: string;
  }[];
};

type ProfileDraft = {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  reason: string;
};

type AccessDraft = {
  client: boolean;
  tipster: boolean;
  administrator: boolean;
  tipsterDisplayName: string;
  tipsterBiography: string;
  tipsterPublic: boolean;
  blogPublish: boolean;
  testAccess: boolean;
  reason: string;
};

type BlogAuthorRequest = {
  id: string;
  status: "requested" | "approved" | "rejected" | "revoked";
  request_reason: string;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

type WalletDraft = {
  amount: string;
  reason: string;
};

type ModerationDraft = {
  action: ModerationAction;
  category: string;
  internalReason: string;
  publicMessage: string;
  suspensionUntil: string;
  confirmation: string;
};

function statusVariant(status: AccountStatus) {
  if (status === "banned" || status === "suspended") {
    return "destructive" as const;
  }

  if (status === "flagged") {
    return "secondary" as const;
  }

  return "outline" as const;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

function registrationStatusLabel(state: RegistrationDeliveryState) {
  if (state === "manually_verified") return "Manually verified";
  if (state === "confirmed") return "Email confirmed";
  if (state === "dispatched_unverified") return "Dispatch recorded; delivery unverified";
  return "No dispatch recorded";
}

function registrationEventLabel(eventType: string) {
  return eventType
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function registrationEventSourceLabel(source: RegistrationDiagnostics["events"][number]["source"]) {
  if (source === "auth_trigger") return "Live Auth event";
  if (source === "auth_email_hook") return "Auth email sender";
  if (source === "email_provider_webhook") return "Signed provider webhook";
  return "Historical Auth timestamp";
}

function providerDeliveryLabel(status: AuthEmailProviderStatus) {
  if (status === "delivery_delayed") return "Delivery delayed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function providerDeliveryVariant(status: AuthEmailProviderStatus) {
  if (["bounced", "complained", "suppressed", "failed"].includes(status)) {
    return "destructive" as const;
  }
  if (status === "delivered") return "default" as const;
  return "outline" as const;
}

const userWorkspaceTabs = new Set([
  "identity",
  "registration",
  "access",
  "credits",
  "moderation",
  "notes",
  "commerce",
  "tipster",
  "audit",
]);

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  const context = typeof error === "object" && error && "context" in error
    ? error.context
    : null;

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string };
      if (payload.error) {
        return payload.error;
      }
    } catch {
      return errorMessage(error, fallback);
    }
  }

  return errorMessage(error, fallback);
}

export function AdminUserDetailClient() {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [actorId, setActorId] = useState("");
  const [actorIsOwner, setActorIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("identity");
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    firstName: "",
    lastName: "",
    displayName: "",
    phone: "",
    reason: "Administrator identity correction",
  });
  const [accessDraft, setAccessDraft] = useState<AccessDraft>({
    client: true,
    tipster: false,
    administrator: false,
    tipsterDisplayName: "",
    tipsterBiography: "",
    tipsterPublic: false,
    blogPublish: false,
    testAccess: false,
    reason: "Administrator access configuration",
  });
  const [walletDraft, setWalletDraft] = useState<WalletDraft>({
    amount: "",
    reason: "Administrator Credit adjustment for verified account support",
  });
  const [noteBody, setNoteBody] = useState("");
  const [moderationDraft, setModerationDraft] = useState<ModerationDraft>({
    action: "flag",
    category: "account_review",
    internalReason: "",
    publicMessage: "",
    suspensionUntil: "",
    confirmation: "",
  });
  const [largeCreditDialogOpen, setLargeCreditDialogOpen] = useState(false);
  const [verifyEmailDialogOpen, setVerifyEmailDialogOpen] = useState(false);
  const [verifyEmailConfirmation, setVerifyEmailConfirmation] = useState("");
  const [emailActionError, setEmailActionError] = useState("");
  const [emailConfirmationActions, setEmailConfirmationActions] = useState<
    EmailConfirmationActionRecord[]
  >([]);
  const [registrationDiagnostics, setRegistrationDiagnostics] = useState<
    RegistrationDiagnostics | null
  >(null);
  const [registrationDiagnosticsError, setRegistrationDiagnosticsError] = useState("");
  const [emailDeliveryDiagnostics, setEmailDeliveryDiagnostics] = useState<
    AuthEmailDeliveryDiagnostics | null
  >(null);
  const [emailDeliveryDiagnosticsError, setEmailDeliveryDiagnosticsError] = useState("");
  const [resendConfirmationReason, setResendConfirmationReason] = useState(
    "Administrator requested confirmation email resend after reported non-delivery",
  );
  const [manualVerificationReason, setManualVerificationReason] = useState(
    "Administrator independently verified ownership of this email address",
  );
  const [tipsterApplication, setTipsterApplication] = useState<TipsterApplication | null>(null);
  const [tipsterApplicationDocuments, setTipsterApplicationDocuments] = useState<TipsterApplicationDocument[]>([]);
  const [tipsterWorkspace, setTipsterWorkspace] = useState<TipsterWorkspace | null>(null);
  const [blogAuthorRequest, setBlogAuthorRequest] = useState<BlogAuthorRequest | null>(null);

  const loadDetail = useCallback(async () => {
    const userId = new URLSearchParams(window.location.search).get("user");
    const supabase = createClient();

    if (!supabase || !userId) {
      setError("Choose a valid user record.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setError("Administrator authentication is required.");
      setLoading(false);
      return;
    }

    const [
      detailResult,
      ownerResult,
      blogPermissionResult,
      blogAuthorRequestResult,
      tipsterApplicationResult,
      tipsterDocumentResult,
      tipsterWorkspaceResult,
      emailConfirmationActionResult,
      registrationDiagnosticsResult,
      emailDeliveryDiagnosticsResult,
    ] = await Promise.all([
      supabase.rpc("admin_get_user_detail", { p_user_id: userId }),
      supabase
        .from("platform_owners")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("tipsters")
        .select("id,is_public,tipster_blog_permissions(can_publish)")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("blog_author_requests")
        .select("id,status,request_reason,review_note,created_at,reviewed_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("tipster_applications")
        .select("id,user_id,status,legal_name,display_name,phone,experience_summary,biography,contract_version,contract_content_hash,signature_name,acceptance_confirmations,contract_accepted_at,submitted_at,reviewed_at,reviewed_by,review_reason,approved_commission_rate,created_at,updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("tipster_application_documents")
        .select("id,application_id,user_id,document_type,storage_path,original_file_name,mime_type,size_bytes,sha256,created_at")
        .eq("user_id", userId)
        .order("created_at"),
      supabase.rpc("admin_get_user_tipster_workspace", { p_user_id: userId }),
      supabase
        .from("admin_email_confirmation_actions")
        .select("id,action,reason,status,sanitized_error,completed_at,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.rpc("admin_get_user_registration_diagnostics", { p_user_id: userId }),
      supabase.rpc("admin_get_user_email_delivery", { p_user_id: userId }),
    ]);

    if (detailResult.error || !detailResult.data) {
      setError(detailResult.error?.message ?? "User record not found.");
      setLoading(false);
      return;
    }

    if (
      ownerResult.error ||
      blogPermissionResult.error ||
      blogAuthorRequestResult.error ||
      tipsterApplicationResult.error ||
      tipsterDocumentResult.error ||
      tipsterWorkspaceResult.error ||
      emailConfirmationActionResult.error
    ) {
      setError(
          ownerResult.error?.message ??
          blogPermissionResult.error?.message ??
          blogAuthorRequestResult.error?.message ??
          tipsterApplicationResult.error?.message ??
          tipsterDocumentResult.error?.message ??
          tipsterWorkspaceResult.error?.message ??
          emailConfirmationActionResult.error?.message ??
          "Could not load access controls.",
      );
      setLoading(false);
      return;
    }

    const loadedDetail = detailResult.data as UserDetail;
    setDetail(loadedDetail);
    setTipsterApplication((tipsterApplicationResult.data as TipsterApplication | null) ?? null);
    setBlogAuthorRequest((blogAuthorRequestResult.data as BlogAuthorRequest | null) ?? null);
    setTipsterApplicationDocuments((tipsterDocumentResult.data ?? []) as TipsterApplicationDocument[]);
    setTipsterWorkspace(tipsterWorkspaceResult.data as TipsterWorkspace);
    setEmailConfirmationActions(
      (emailConfirmationActionResult.data ?? []) as EmailConfirmationActionRecord[],
    );
    if (registrationDiagnosticsResult.error) {
      setRegistrationDiagnostics(null);
      setRegistrationDiagnosticsError(
        "Enhanced Auth event history will activate when the approved database migration is deployed.",
      );
    } else {
      setRegistrationDiagnostics(
        registrationDiagnosticsResult.data as RegistrationDiagnostics,
      );
      setRegistrationDiagnosticsError("");
    }
    if (emailDeliveryDiagnosticsResult.error) {
      setEmailDeliveryDiagnostics(null);
      setEmailDeliveryDiagnosticsError(
        "Tracked provider delivery will activate after the Auth email delivery migration and hook are enabled.",
      );
    } else {
      setEmailDeliveryDiagnostics(
        emailDeliveryDiagnosticsResult.data as AuthEmailDeliveryDiagnostics,
      );
      setEmailDeliveryDiagnosticsError("");
    }
    setActorId(user.id);
    setActorIsOwner(Boolean(ownerResult.data));
    setProfileDraft({
      firstName: loadedDetail.identity.firstName ?? "",
      lastName: loadedDetail.identity.lastName ?? "",
      displayName: loadedDetail.identity.displayName ?? "",
      phone: loadedDetail.identity.phone ?? "",
      reason: "Administrator identity correction",
    });
    setAccessDraft({
      client: loadedDetail.roles.includes("client"),
      tipster: loadedDetail.roles.includes("tipster"),
      administrator: loadedDetail.roles.includes("administrator"),
      tipsterDisplayName:
        loadedDetail.access.tipsterDisplayName ??
        loadedDetail.identity.displayName ??
        loadedDetail.identity.email.split("@")[0],
      tipsterBiography: loadedDetail.access.tipsterBiography ?? "",
      tipsterPublic: blogPermissionResult.data?.is_public === true,
      blogPublish: (() => {
        const permission = blogPermissionResult.data?.tipster_blog_permissions;
        const value = Array.isArray(permission) ? permission[0] : permission;
        return value?.can_publish === true;
      })(),
      testAccess: loadedDetail.access.testAccess,
      reason: "Administrator access configuration",
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDetail();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDetail]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const requestedTab = window.location.hash.slice(1);
      if (userWorkspaceTabs.has(requestedTab)) {
        setActiveTab(requestedTab);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function changeActiveTab(value: string) {
    setActiveTab(value);
    const nextUrl = `${window.location.pathname}${window.location.search}#${value}`;
    window.history.replaceState(null, "", nextUrl);
  }

  const targetIsAdministrator = detail?.roles.includes("administrator") ?? false;
  const targetIsSelf = detail?.identity.userId === actorId;
  const latestManualVerification = emailConfirmationActions.find(
    (action) => action.action === "verify_email" && action.status === "succeeded",
  );
  const latestConfirmationResend = emailConfirmationActions.find(
    (action) => action.action === "resend_confirmation" && action.status === "succeeded",
  );
  const effectiveRegistrationState: RegistrationDeliveryState =
    registrationDiagnostics?.delivery.state ??
    (detail?.identity.emailConfirmed
      ? latestManualVerification
        ? "manually_verified"
        : "confirmed"
      : latestConfirmationResend
        ? "dispatched_unverified"
        : "not_dispatched");
  const latestSignupDelivery = emailDeliveryDiagnostics?.latestSignup ?? null;
  const providerDeliveryFailed = Boolean(
    latestSignupDelivery &&
      ["bounced", "complained", "suppressed", "failed"].includes(
        latestSignupDelivery.status,
      ),
  );
  const registrationAlertIsDestructive =
    effectiveRegistrationState === "not_dispatched" || providerDeliveryFailed;
  const registrationDeliveryNote = latestSignupDelivery
    ? latestSignupDelivery.status === "delivered"
      ? "The tracked provider reports that the recipient mail server accepted the confirmation email. Account confirmation remains recorded separately."
      : providerDeliveryFailed
        ? `The tracked provider reported ${providerDeliveryLabel(latestSignupDelivery.status).toLowerCase()}. Review the provider error and event timeline before resending.`
        : `The tracked provider currently reports ${providerDeliveryLabel(latestSignupDelivery.status).toLowerCase()}. Delivery events will update automatically.`
    : registrationDiagnostics?.delivery.note ??
      "This account predates tracked provider delivery or the provider hook is not active yet.";
  const canModerate = Boolean(
    detail &&
      !detail.identity.isOwner &&
      !targetIsSelf &&
      (!targetIsAdministrator || actorIsOwner),
  );
  const userTitle = useMemo(() => {
    if (!detail) {
      return "User record";
    }

    return (
      detail.identity.displayName ||
      [detail.identity.firstName, detail.identity.lastName].filter(Boolean).join(" ") ||
      detail.identity.email
    );
  }, [detail]);

  async function saveProfile() {
    const supabase = createClient();

    if (!supabase || !detail) {
      return;
    }

    setProcessing("profile");
    setError("");

    try {
      const { error: profileError } = await supabase.rpc("admin_update_user_profile", {
        p_user_id: detail.identity.userId,
        p_first_name: profileDraft.firstName,
        p_last_name: profileDraft.lastName,
        p_display_name: profileDraft.displayName || null,
        p_phone: profileDraft.phone || null,
        p_reason: profileDraft.reason,
      });

      if (profileError) {
        throw profileError;
      }

      setMessage("Identity fields were corrected and audit logged.");
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not update the user profile."));
    } finally {
      setProcessing("");
    }
  }

  async function saveAccess() {
    const supabase = createClient();

    if (!supabase || !detail) {
      return;
    }

    setProcessing("access");
    setError("");

    try {
      const { error: accessError } = await supabase.rpc("admin_configure_user_v3", {
        p_user_id: detail.identity.userId,
        p_client: accessDraft.client,
        p_tipster: accessDraft.tipster,
        p_administrator: accessDraft.administrator,
        p_tipster_display_name: accessDraft.tipsterDisplayName || null,
        p_tipster_biography: accessDraft.tipsterBiography || null,
        p_tipster_public: accessDraft.tipster && accessDraft.tipsterPublic,
        p_blog_publish: accessDraft.blogPublish,
        p_test_access: accessDraft.testAccess,
        p_reason: accessDraft.reason,
      });

      if (accessError) {
        throw accessError;
      }

      setMessage("Roles, Tipster access, public visibility, blog-author permission, and private test access were audit logged.");
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not update user access."));
    } finally {
      setProcessing("");
    }
  }

  async function runEmailConfirmationAction(
    action: "resend_confirmation" | "verify_email",
  ) {
    const supabase = createClient();
    const reason = action === "resend_confirmation"
      ? resendConfirmationReason.trim()
      : manualVerificationReason.trim();

    if (!supabase || !detail) {
      return;
    }

    if (detail.identity.emailConfirmed) {
      setError("This email address is already confirmed.");
      return;
    }

    if (reason.length < 10) {
      setError("Enter an audit reason of at least ten characters.");
      return;
    }

    if (action === "verify_email" && verifyEmailConfirmation !== "VERIFY") {
      setError('Type "VERIFY" to confirm manual email verification.');
      return;
    }

    setProcessing(`email:${action}`);
    setError("");
    setMessage("");
    setEmailActionError("");

    try {
      const requestId = crypto.randomUUID();
      const { data, error: functionError } = await supabase.functions.invoke(
        "admin-user-control",
        {
          headers: { "x-idempotency-key": requestId },
          body: {
            userId: detail.identity.userId,
            action,
            internalReason: reason,
            confirmation: action === "verify_email"
              ? verifyEmailConfirmation
              : undefined,
            requestId,
          },
        },
      );

      if (functionError) {
        throw new Error(
          await edgeFunctionErrorMessage(
            functionError,
            "The administrator email action could not be completed.",
          ),
        );
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (action === "verify_email") {
        setVerifyEmailDialogOpen(false);
        setVerifyEmailConfirmation("");
        setMessage(`${detail.identity.email} was manually verified and audit logged.`);
      } else {
        setMessage(
          `Supabase accepted a new confirmation email request for ${detail.identity.email}. Provider delivery status will update in the registration diagnostics.`,
        );
      }

      await loadDetail();
    } catch (caughtError) {
      const actionError = errorMessage(
        caughtError,
        action === "resend_confirmation"
          ? "The confirmation email could not be resent."
          : "The email address could not be verified manually.",
      );
      setError(actionError);
      setEmailActionError(actionError);
      await loadDetail();
    } finally {
      setProcessing("");
    }
  }

  async function reviewTipsterApplication(
    action: "start_review" | "request_changes" | "approve" | "reject" | "revoke",
  ) {
    const supabase = createClient();
    if (!supabase || !tipsterApplication) return;

    setProcessing(`tipster:${action}`);
    setError("");
    setMessage("");
    try {
      const { error: reviewError } = await supabase.rpc("admin_review_tipster_application", {
        p_application_id: tipsterApplication.id,
        p_action: action,
        p_reason: accessDraft.reason,
      });
      if (reviewError) throw reviewError;
      setMessage(`Tipster application ${action.replaceAll("_", " ")} completed and audit logged.`);
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not review the tipster application."));
    } finally {
      setProcessing("");
    }
  }

  async function downloadTipsterDocument(document: TipsterApplicationDocument) {
    const supabase = createClient();
    if (!supabase) return;

    setProcessing(`tipster-document:${document.id}`);
    setError("");
    try {
      const { data, error: downloadError } = await supabase.storage
        .from("tipster-applications")
        .download(document.storage_path);
      if (downloadError || !data) throw downloadError ?? new Error("Document could not be downloaded.");
      const url = URL.createObjectURL(data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.original_file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not download the application document."));
    } finally {
      setProcessing("");
    }
  }

  async function executeCreditAdjustment() {
    const supabase = createClient();
    const amount = Number(walletDraft.amount);

    if (!supabase || !detail) {
      return;
    }

    setLargeCreditDialogOpen(false);
    setProcessing("wallet");
    setError("");

    try {
      const { error: walletError } = await supabase.rpc("admin_adjust_wallet_v2", {
        p_user_id: detail.identity.userId,
        p_amount: amount,
        p_reason: walletDraft.reason,
        p_idempotency_key: crypto.randomUUID(),
      });

      if (walletError) {
        throw walletError;
      }

      setWalletDraft((current) => ({ ...current, amount: "" }));
      setMessage("Credit balance and immutable ledger were updated exactly once.");
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not adjust the Credit balance."));
    } finally {
      setProcessing("");
    }
  }

  function requestCreditAdjustment() {
    const amount = Number(walletDraft.amount);

    if (!Number.isInteger(amount) || amount === 0) {
      setError("Enter a non-zero whole-Credit adjustment.");
      return;
    }

    if (walletDraft.reason.trim().length < 10) {
      setError("Enter an audit reason of at least ten characters.");
      return;
    }

    if (Math.abs(amount) >= 1000) {
      setLargeCreditDialogOpen(true);
      return;
    }

    void executeCreditAdjustment();
  }

  async function addNote() {
    const supabase = createClient();

    if (!supabase || !detail) {
      return;
    }

    setProcessing("note");
    setError("");

    try {
      const { error: noteError } = await supabase.rpc("admin_add_user_note", {
        p_user_id: detail.identity.userId,
        p_body: noteBody,
      });

      if (noteError) {
        throw noteError;
      }

      setNoteBody("");
      setMessage("Internal note appended. Existing notes remain immutable.");
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not append the internal note."));
    } finally {
      setProcessing("");
    }
  }

  async function applyModeration() {
    const supabase = createClient();

    if (!supabase || !detail || !canModerate) {
      return;
    }

    if (
      moderationDraft.action === "ban" &&
      moderationDraft.confirmation !== "BAN"
    ) {
      setError('Type "BAN" to confirm a permanent ban.');
      return;
    }

    setProcessing("moderation");
    setError("");

    try {
      const requestId = crypto.randomUUID();
      const suspensionUntil = moderationDraft.suspensionUntil
        ? new Date(moderationDraft.suspensionUntil).toISOString()
        : null;
      const { data, error: moderationError } = await supabase.functions.invoke(
        "admin-user-control",
        {
          headers: { "x-idempotency-key": requestId },
          body: {
            userId: detail.identity.userId,
            action: moderationDraft.action,
            category: moderationDraft.category,
            internalReason: moderationDraft.internalReason,
            publicMessage: moderationDraft.publicMessage,
            suspensionUntil,
            confirmation: moderationDraft.confirmation,
            requestId,
          },
        },
      );

      if (moderationError) {
        throw moderationError;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setMessage("Moderation state and Supabase Auth were synchronized and audit logged.");
      setModerationDraft((current) => ({
        ...current,
        internalReason: "",
        publicMessage: "",
        suspensionUntil: "",
        confirmation: "",
      }));
      await supabase.functions.invoke("deliver-tip-notifications", {
        body: { source: "admin-user-control" },
      });
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not update account moderation."));
      await loadDetail();
    } finally {
      setProcessing("");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Loading user workspace
      </div>
    );
  }

  if (!detail) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>User record unavailable</AlertTitle>
        <AlertDescription>{error || "Choose a user from the admin directory."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="link" className="h-auto p-0">
            <Link href="/admin/users/">
              <ArrowLeft className="size-4" />
              Back to user directory
            </Link>
          </Button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-2xl text-white">{userTitle}</h2>
            <Badge variant={statusVariant(detail.moderation.status)}>
              {detail.moderation.status}
            </Badge>
            {detail.identity.isOwner ? <Badge>Platform owner</Badge> : null}
            {detail.identity.emailConfirmed ? (
              <Badge className="border-emerald-400/40 bg-emerald-400/15 text-emerald-100">
                {latestManualVerification ? "Email manually verified" : "Email confirmed"}
              </Badge>
            ) : (
              <Badge variant="destructive">Email pending</Badge>
            )}
            {detail.moderation.authSyncStatus !== "synced" ? (
              <Badge variant="destructive">Auth {detail.moderation.authSyncStatus}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{detail.identity.email}</p>
          {tipsterWorkspace ? (
            <p className="mt-1 text-xs text-brand-cyan">
              Live Supabase snapshot · loaded {formatRaceDateTime(tipsterWorkspace.loadedAt)}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={() => void loadDetail()}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {error || message ? (
        <Alert variant={error ? "destructive" : "default"}>
          {error ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
          <AlertTitle>{error ? "Action needs attention" : "Update complete"}</AlertTitle>
          <AlertDescription>{error || message}</AlertDescription>
        </Alert>
      ) : null}

      {detail.moderation.authSyncStatus === "failed" ? (
        <Alert variant="destructive">
          <FileWarning className="size-4" />
          <AlertTitle>Auth synchronization needs retry</AlertTitle>
          <AlertDescription>
            The MRC account remains restricted. Repeat the same moderation action to retry Supabase Auth safely.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Credit balance" value={formatCredits(detail.wallet.balance)} />
        <SummaryCard label="Roles" value={detail.roles.join(", ") || "None"} />
        <SummaryCard
          label="Email"
          value={
            detail.identity.emailConfirmed
              ? latestManualVerification
                ? "Manually verified"
                : "Confirmed"
              : "Confirmation pending"
          }
        />
        <SummaryCard
          label="Last sign-in"
          value={
            detail.identity.lastSignInAt
              ? formatRaceDateTime(detail.identity.lastSignInAt)
            : "Never"
          }
        />
        {tipsterWorkspace?.tipsterId ? (
          <SummaryCard
            label="Tipster packages"
            value={`${tipsterWorkspace.packages.length} live record${tipsterWorkspace.packages.length === 1 ? "" : "s"}`}
          />
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={changeActiveTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="identity"><CircleUserRound className="size-4" />Identity</TabsTrigger>
          <TabsTrigger value="registration"><MailPlus className="size-4" />Registration</TabsTrigger>
          <TabsTrigger value="access"><UserCog className="size-4" />Access</TabsTrigger>
          <TabsTrigger value="credits"><Coins className="size-4" />Credits</TabsTrigger>
          <TabsTrigger value="moderation"><ShieldCheck className="size-4" />Moderation</TabsTrigger>
          <TabsTrigger value="notes"><NotebookPen className="size-4" />Notes</TabsTrigger>
          <TabsTrigger value="commerce"><Banknote className="size-4" />Commerce</TabsTrigger>
          <TabsTrigger value="tipster"><ClipboardList className="size-4" />Tipster</TabsTrigger>
          <TabsTrigger value="audit"><History className="size-4" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <div className="space-y-4">
            <Card
              className={
                detail.identity.emailConfirmed
                  ? "border-emerald-400/35"
                  : "border-amber-400/35"
              }
            >
              <CardHeader>
                <CardTitle>Email verification status</CardTitle>
                <CardDescription>
                  Confirmation state and administrator email actions from the live database.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border bg-background/45 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Account status
                    </p>
                    <div className="mt-2">
                      {detail.identity.emailConfirmed ? (
                        <Badge className="border-emerald-400/40 bg-emerald-400/15 text-emerald-100">
                          {latestManualVerification ? "Manually verified" : "Verified"}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Pending verification</Badge>
                      )}
                    </div>
                    {detail.identity.emailConfirmedAt ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Confirmed {formatRaceDateTime(detail.identity.emailConfirmedAt)}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-background/45 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Manual verification
                    </p>
                    <p className="mt-2 font-medium">
                      {latestManualVerification ? "Completed" : "Not recorded"}
                    </p>
                    {latestManualVerification ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatRaceDateTime(
                          latestManualVerification.completed_at ??
                            latestManualVerification.created_at,
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-background/45 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Verification email sent
                    </p>
                    <p className="mt-2 font-medium">
                      {latestConfirmationResend ? "Recorded" : "No administrator resend recorded"}
                    </p>
                    {latestConfirmationResend ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatRaceDateTime(
                          latestConfirmationResend.completed_at ??
                            latestConfirmationResend.created_at,
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>

                {emailConfirmationActions.length ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Recent verification actions</p>
                    {emailConfirmationActions.slice(0, 5).map((action) => (
                      <div
                        key={action.id}
                        className="flex flex-col gap-2 rounded-lg border bg-background/35 p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div>
                          <p className="font-medium">
                            {action.action === "verify_email"
                              ? "Manual verification"
                              : "Verification email sent"}
                          </p>
                          <p className="text-sm text-muted-foreground">{action.reason}</p>
                          {action.sanitized_error ? (
                            <p className="mt-1 text-sm text-destructive">
                              {action.sanitized_error}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <Badge
                            variant={action.status === "failed" ? "destructive" : "outline"}
                          >
                            {action.status}
                          </Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatRaceDateTime(action.completed_at ?? action.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {!detail.identity.emailConfirmed ? (
              <Card className="border-amber-400/35">
                <CardHeader>
                  <CardTitle>Email confirmation pending</CardTitle>
                  <CardDescription>
                    Resend the Supabase confirmation link, or manually verify only after independently confirming that the client owns this address.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-background/45 p-4">
                    <p className="font-medium">{detail.identity.email}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A successful resend confirms that Supabase accepted the request, not that the recipient inbox delivered it. Manual verification bypasses the email-link ownership check and is permanently audit logged.
                    </p>
                  </div>
                  <Field label="Required resend audit reason">
                    <Input
                      value={resendConfirmationReason}
                      onChange={(event) => setResendConfirmationReason(event.target.value)}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={processing.startsWith("email:")}
                      onClick={() => void runEmailConfirmationAction("resend_confirmation")}
                    >
                      {processing === "email:resend_confirmation" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <MailPlus className="size-4" />
                      )}
                      Resend confirmation email
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={processing.startsWith("email:")}
                      onClick={() => setVerifyEmailDialogOpen(true)}
                    >
                      <ShieldCheck className="size-4" />
                      Verify manually
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
            <CardHeader>
              <CardTitle>Identity and Auth status</CardTitle>
              <CardDescription>
                Existing legacy accounts remain blank until corrected; new registrations require legal names.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <Input
                  value={profileDraft.firstName}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, firstName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Surname">
                <Input
                  value={profileDraft.lastName}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, lastName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Public display name">
                <Input
                  value={profileDraft.displayName}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Cell number">
                <Input
                  value={profileDraft.phone}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </Field>
              <Field label="Required audit reason" className="sm:col-span-2">
                <Input
                  value={profileDraft.reason}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  disabled={processing === "profile"}
                  onClick={() => void saveProfile()}
                >
                  {processing === "profile" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save identity
                </Button>
              </div>
            </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent id="registration" value="registration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registration and confirmation diagnostics</CardTitle>
              <CardDescription>
                Live Supabase Auth state, profile declarations, identity providers, email
                timestamps, and immutable account events for this client.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert variant={registrationAlertIsDestructive ? "destructive" : "default"}>
                {registrationAlertIsDestructive ? (
                  <AlertCircle className="size-4" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                <AlertTitle>{registrationStatusLabel(effectiveRegistrationState)}</AlertTitle>
                <AlertDescription>{registrationDeliveryNote}</AlertDescription>
              </Alert>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DiagnosticValue
                  label="Account registered"
                  value={formatRaceDateTime(
                    registrationDiagnostics?.auth.createdAt ?? detail.identity.createdAt,
                  )}
                />
                <DiagnosticValue
                  label="Confirmation requested"
                  value={
                    registrationDiagnostics?.auth.confirmationSentAt
                      ? formatRaceDateTime(registrationDiagnostics.auth.confirmationSentAt)
                      : "No Supabase timestamp"
                  }
                />
                <DiagnosticValue
                  label="Email confirmed"
                  value={
                    registrationDiagnostics?.auth.emailConfirmedAt || detail.identity.emailConfirmedAt
                      ? formatRaceDateTime(
                          registrationDiagnostics?.auth.emailConfirmedAt ??
                            detail.identity.emailConfirmedAt ??
                            detail.identity.createdAt,
                        )
                      : "Pending"
                  }
                />
                <DiagnosticValue
                  label="Last sign-in"
                  value={
                    registrationDiagnostics?.auth.lastSignInAt || detail.identity.lastSignInAt
                      ? formatRaceDateTime(
                          registrationDiagnostics?.auth.lastSignInAt ??
                            detail.identity.lastSignInAt ??
                            detail.identity.createdAt,
                        )
                      : "Never"
                  }
                />
                <DiagnosticValue
                  label="Provider delivery"
                  value={
                    latestSignupDelivery
                      ? providerDeliveryLabel(latestSignupDelivery.status)
                      : "Legacy / untracked"
                  }
                />
                <DiagnosticValue
                  label="Provider event"
                  value={
                    latestSignupDelivery?.latestEventAt || latestSignupDelivery?.acceptedAt
                      ? formatRaceDateTime(
                          latestSignupDelivery.latestEventAt ??
                            latestSignupDelivery.acceptedAt ??
                            detail.identity.createdAt,
                        )
                      : "No tracked event"
                  }
                />
                <DiagnosticValue
                  label="Provider message ID"
                  value={latestSignupDelivery?.providerMessageId ?? "Not available"}
                  mono
                />
              </div>

              {registrationDiagnosticsError ? (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>Enhanced timeline pending deployment</AlertTitle>
                  <AlertDescription>{registrationDiagnosticsError}</AlertDescription>
                </Alert>
              ) : null}

              {emailDeliveryDiagnosticsError ? (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>Provider delivery tracking pending</AlertTitle>
                  <AlertDescription>{emailDeliveryDiagnosticsError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="bg-background/25">
                  <CardHeader>
                    <CardTitle>Auth account snapshot</CardTitle>
                    <CardDescription>Non-secret fields only. Tokens and credentials are never returned.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <DiagnosticValue label="Auth user ID" value={detail.identity.userId} mono />
                    <DiagnosticValue
                      label="Auth provider"
                      value={
                        registrationDiagnostics?.providers.map((provider) => provider.provider).join(", ") ||
                        "Available after migration"
                      }
                    />
                    <DiagnosticValue
                      label="Auth updated"
                      value={
                        registrationDiagnostics?.auth.updatedAt
                          ? formatRaceDateTime(registrationDiagnostics.auth.updatedAt)
                          : "Available after migration"
                      }
                    />
                    <DiagnosticValue
                      label="Profile created"
                      value={
                        registrationDiagnostics?.profile.createdAt
                          ? formatRaceDateTime(registrationDiagnostics.profile.createdAt)
                          : "Not recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Profile updated"
                      value={
                        registrationDiagnostics?.profile.updatedAt
                          ? formatRaceDateTime(registrationDiagnostics.profile.updatedAt)
                          : "Not recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Invitation sent"
                      value={
                        registrationDiagnostics?.auth.invitedAt
                          ? formatRaceDateTime(registrationDiagnostics.auth.invitedAt)
                          : "Not an invited account"
                      }
                    />
                    <DiagnosticValue
                      label="Recovery email requested"
                      value={
                        registrationDiagnostics?.auth.recoverySentAt
                          ? formatRaceDateTime(registrationDiagnostics.auth.recoverySentAt)
                          : "None recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Email-change request"
                      value={
                        registrationDiagnostics?.auth.emailChangeSentAt
                          ? `${formatRaceDateTime(registrationDiagnostics.auth.emailChangeSentAt)}${registrationDiagnostics.auth.emailChangePending ? ` · ${registrationDiagnostics.auth.emailChangePending}` : ""}`
                          : "None recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Reauthentication requested"
                      value={
                        registrationDiagnostics?.auth.reauthenticationSentAt
                          ? formatRaceDateTime(registrationDiagnostics.auth.reauthenticationSentAt)
                          : "None recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Phone confirmed"
                      value={
                        registrationDiagnostics?.auth.phoneConfirmedAt
                          ? formatRaceDateTime(registrationDiagnostics.auth.phoneConfirmedAt)
                          : "Not confirmed"
                      }
                    />
                    <DiagnosticValue
                      label="Account restrictions"
                      value={
                        registrationDiagnostics?.auth.deletedAt
                          ? `Deleted ${formatRaceDateTime(registrationDiagnostics.auth.deletedAt)}`
                          : registrationDiagnostics?.auth.bannedUntil
                            ? `Restricted until ${formatRaceDateTime(registrationDiagnostics.auth.bannedUntil)}`
                            : "None recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Account type"
                      value={
                        registrationDiagnostics
                          ? `${registrationDiagnostics.auth.isSsoUser ? "SSO" : "Standard"}${registrationDiagnostics.auth.isAnonymous ? " · anonymous" : ""}`
                          : "Available after migration"
                      }
                    />
                  </CardContent>
                </Card>

                <Card className="bg-background/25">
                  <CardHeader>
                    <CardTitle>Registration declarations</CardTitle>
                    <CardDescription>Profile values copied from the original registration metadata.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <DiagnosticValue
                      label="First name"
                      value={registrationDiagnostics?.profile.firstName ?? detail.identity.firstName ?? "Missing"}
                    />
                    <DiagnosticValue
                      label="Surname"
                      value={registrationDiagnostics?.profile.lastName ?? detail.identity.lastName ?? "Missing"}
                    />
                    <DiagnosticValue
                      label="Display name"
                      value={registrationDiagnostics?.profile.displayName ?? detail.identity.displayName ?? "Missing"}
                    />
                    <DiagnosticValue
                      label="Cell number"
                      value={registrationDiagnostics?.profile.phone ?? detail.identity.phone ?? "Missing"}
                    />
                    <DiagnosticValue
                      label="Terms accepted"
                      value={
                        registrationDiagnostics?.profile.acceptedTermsAt
                          ? formatRaceDateTime(registrationDiagnostics.profile.acceptedTermsAt)
                          : "No timestamp recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Terms version"
                      value={registrationDiagnostics?.profile.acceptedTermsVersion ?? "Not recorded"}
                    />
                    <DiagnosticValue
                      label="Age declaration"
                      value={
                        registrationDiagnostics?.profile.confirmedOver18At
                          ? formatRaceDateTime(registrationDiagnostics.profile.confirmedOver18At)
                          : "No timestamp recorded"
                      }
                    />
                    <DiagnosticValue
                      label="Account emails"
                      value={
                        registrationDiagnostics?.profile.emailNotificationsEnabled === false
                          ? "Disabled"
                          : registrationDiagnostics?.profile.emailNotificationsEnabled === true
                            ? "Enabled"
                            : "Not recorded"
                      }
                    />
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-background/25">
                <CardHeader>
                  <CardTitle>Identity providers</CardTitle>
                  <CardDescription>Supabase identities linked to this Auth account.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(registrationDiagnostics?.providers ?? []).map((provider) => (
                    <div key={provider.id} className="grid gap-2 rounded-lg border p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <p><span className="text-muted-foreground">Provider:</span> {provider.provider}</p>
                      <p><span className="text-muted-foreground">Email:</span> {provider.email ?? "Not returned"}</p>
                      <p><span className="text-muted-foreground">Created:</span> {formatRaceDateTime(provider.createdAt)}</p>
                      <p><span className="text-muted-foreground">Last sign-in:</span> {provider.lastSignInAt ? formatRaceDateTime(provider.lastSignInAt) : "Never"}</p>
                    </div>
                  ))}
                  {!registrationDiagnostics?.providers.length ? (
                    <p className="text-sm text-muted-foreground">
                      Provider details will appear after the approved migration is deployed.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="bg-background/25">
                <CardHeader>
                  <CardTitle>Immutable registration timeline</CardTitle>
                  <CardDescription>
                    Historical Auth timestamps are backfilled once; future dispatches,
                    confirmations, sign-ins, address changes, and recovery requests are captured automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(registrationDiagnostics?.events ?? []).map((event) => (
                    <div key={event.id} className="rounded-lg border bg-background/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{registrationEventLabel(event.eventType)}</p>
                          <p className="text-sm text-muted-foreground">
                            {event.email || detail.identity.email} · {registrationEventSourceLabel(event.source)}
                          </p>
                        </div>
                        <Badge variant="outline">{formatRaceDateTime(event.eventAt)}</Badge>
                      </div>
                      {Object.keys(event.details ?? {}).length ? (
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-black/20 p-3 text-xs text-muted-foreground">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                  {!registrationDiagnostics?.events.length ? (
                    <p className="text-sm text-muted-foreground">
                      No enhanced Auth events are available in the local approval build yet.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="bg-background/25">
                <CardHeader>
                  <CardTitle>Tracked Auth email delivery</CardTitle>
                  <CardDescription>
                    Provider acceptance, mail-server delivery, delays, bounces, suppressions,
                    complaints, and send failures. Signed webhook events are deduplicated and immutable.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Created</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Provider reference</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(emailDeliveryDiagnostics?.messages ?? []).map((emailMessage) => (
                          <TableRow key={emailMessage.id}>
                            <TableCell className="whitespace-nowrap">
                              {formatRaceDateTime(emailMessage.createdAt)}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">{registrationEventLabel(emailMessage.emailActionType)}</p>
                              <p>{emailMessage.recipientEmail}</p>
                              <p className="text-xs text-muted-foreground">
                                {emailMessage.subject} · attempt {emailMessage.attemptCount}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant={providerDeliveryVariant(emailMessage.status)}>
                                {providerDeliveryLabel(emailMessage.status)}
                              </Badge>
                              {emailMessage.latestEventAt ? (
                                <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                                  {formatRaceDateTime(emailMessage.latestEventAt)}
                                </p>
                              ) : null}
                              {emailMessage.lastErrorMessage ? (
                                <p className="mt-2 max-w-80 text-xs text-destructive">
                                  {emailMessage.lastErrorMessage}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <p>{emailMessage.provider}</p>
                              <code className="text-xs text-muted-foreground">
                                {emailMessage.providerMessageId ?? "Awaiting provider ID"}
                              </code>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!emailDeliveryDiagnostics?.messages.length ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                              No tracked provider messages exist for this account.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-medium">Signed provider events</h3>
                    {(emailDeliveryDiagnostics?.events ?? []).slice(0, 20).map((event) => (
                      <div key={event.providerEventId} className="rounded-lg border bg-background/35 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{registrationEventLabel(event.eventType)}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.provider} · {event.providerEmailId}
                            </p>
                          </div>
                          <Badge variant="outline">{formatRaceDateTime(event.eventAt)}</Badge>
                        </div>
                        {Object.keys(event.details ?? {}).length ? (
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-black/20 p-3 text-xs text-muted-foreground">
                            {JSON.stringify(event.details, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                    {!emailDeliveryDiagnostics?.events.length ? (
                      <p className="text-sm text-muted-foreground">
                        No provider webhook events have been recorded for this account.
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-background/25">
                <CardHeader>
                  <CardTitle>Administrator confirmation actions</CardTitle>
                  <CardDescription>Every resend and manual verification request with its actor and outcome.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(registrationDiagnostics?.confirmationActions ?? []).map((action) => (
                    <div key={action.id} className="rounded-lg border bg-background/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {action.action === "verify_email" ? "Manual verification" : "Confirmation resend"}
                          </p>
                          <p className="text-sm text-muted-foreground">{action.reason}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {action.actorName || action.actorEmail || action.actorId} · request {action.requestId}
                          </p>
                          {action.sanitizedError ? (
                            <p className="mt-2 text-sm text-destructive">{action.sanitizedError}</p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <Badge variant={action.status === "failed" ? "destructive" : "outline"}>
                            {action.status}
                          </Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatRaceDateTime(action.completedAt ?? action.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!registrationDiagnostics?.confirmationActions.length ? (
                    <p className="text-sm text-muted-foreground">
                      No enhanced administrator action details are available. Existing actions remain visible on the Identity tab.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Roles, Tipster access, and publishing</CardTitle>
              <CardDescription>
                Tipster applications retain their review history. Administrators can separately
                configure Tipster workspace access, public visibility, and blog-author approval;
                only the platform owner can grant or remove administrator access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-brand-cyan/25 bg-background/35 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-white">
                      <FileCheck2 className="size-4 text-brand-cyan" />
                      Tipster application
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Identity documents, signed agreement, racing experience, and approval history.
                    </p>
                  </div>
                  <Badge variant={tipsterApplication?.status === "approved" ? "default" : "outline"}>
                    {tipsterApplication
                      ? tipsterApplicationStatusLabel(tipsterApplication.status)
                      : "No application"}
                  </Badge>
                </div>

                {tipsterApplication ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <p><span className="text-muted-foreground">Legal name:</span> {tipsterApplication.legal_name || "Not provided"}</p>
                      <p><span className="text-muted-foreground">Public name:</span> {tipsterApplication.display_name || "Not provided"}</p>
                      <p><span className="text-muted-foreground">Contact:</span> {tipsterApplication.phone || "Not provided"}</p>
                      <p><span className="text-muted-foreground">Commission:</span> {tipsterApplication.approved_commission_rate == null ? "Not accepted" : `${Number(tipsterApplication.approved_commission_rate).toLocaleString("en-ZA")}%`}</p>
                      <p><span className="text-muted-foreground">Contract:</span> {tipsterApplication.contract_version || "Legacy approval"}</p>
                      <p><span className="text-muted-foreground">Signed:</span> {tipsterApplication.contract_accepted_at ? formatRaceDateTime(tipsterApplication.contract_accepted_at) : "Legacy approval"}</p>
                    </div>
                    {tipsterApplication.experience_summary ? <div><p className="text-xs font-semibold uppercase text-muted-foreground">Experience</p><p className="mt-1 whitespace-pre-wrap text-sm">{tipsterApplication.experience_summary}</p></div> : null}
                    {tipsterApplication.review_reason ? <Alert><FileWarning className="size-4" /><AlertTitle>Review record</AlertTitle><AlertDescription>{tipsterApplication.review_reason}</AlertDescription></Alert> : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {tipsterApplicationDocuments.map((document) => (
                        <div key={document.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                          <div className="min-w-0"><p className="font-medium capitalize">{document.document_type.replaceAll("_", " ")}</p><p className="truncate text-xs text-muted-foreground">{document.original_file_name}</p></div>
                          <Button type="button" size="sm" variant="outline" disabled={processing === `tipster-document:${document.id}`} onClick={() => void downloadTipsterDocument(document)}><Download className="size-4" />Download</Button>
                        </div>
                      ))}
                    </div>
                    {!tipsterApplicationDocuments.length && tipsterApplication.contract_version ? <p className="text-sm text-destructive">No supporting documents are attached.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {tipsterApplication.status === "submitted" ? <Button type="button" variant="outline" disabled={processing.startsWith("tipster:")} onClick={() => void reviewTipsterApplication("start_review")}>Start review</Button> : null}
                      {["submitted", "under_review"].includes(tipsterApplication.status) ? <><Button type="button" disabled={processing.startsWith("tipster:")} onClick={() => void reviewTipsterApplication("approve")}><ShieldCheck className="size-4" />Approve as Tipster</Button><Button type="button" variant="outline" disabled={processing.startsWith("tipster:")} onClick={() => void reviewTipsterApplication("request_changes")}>Request changes</Button><Button type="button" variant="destructive" disabled={processing.startsWith("tipster:")} onClick={() => void reviewTipsterApplication("reject")}>Reject</Button></> : null}
                      {tipsterApplication.status === "approved" ? <Button type="button" variant="destructive" disabled={processing.startsWith("tipster:")} onClick={() => void reviewTipsterApplication("revoke")}>Revoke Tipster approval</Button> : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">This user has not started a Tipster application.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <CheckboxField
                  label="Client"
                  checked={accessDraft.client}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, client: checked }))
                  }
                />
                <CheckboxField
                  label="Tipster workspace access"
                  checked={accessDraft.tipster}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({
                      ...current,
                      tipster: checked,
                      tipsterPublic: checked ? current.tipsterPublic : false,
                    }))
                  }
                />
                <CheckboxField
                  label="Show Tipster publicly"
                  checked={accessDraft.tipsterPublic}
                  disabled={!accessDraft.tipster}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, tipsterPublic: checked }))
                  }
                />
                <CheckboxField
                  label="Administrator"
                  checked={accessDraft.administrator}
                  disabled={!actorIsOwner || detail.identity.isOwner}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, administrator: checked }))
                  }
                />
                <CheckboxField
                  label="Private test meetings"
                  checked={accessDraft.testAccess}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, testAccess: checked }))
                  }
                />
                {accessDraft.tipster ? (
                  <Badge className="h-6 self-center">Approved Tipster</Badge>
                ) : null}
                <CheckboxField
                  label="May publish blog posts"
                  checked={accessDraft.blogPublish}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, blogPublish: checked }))
                  }
                />
                {blogAuthorRequest ? (
                  <Badge variant="outline" className="h-6 self-center capitalize">
                    Author request: {blogAuthorRequest.status.replaceAll("_", " ")}
                  </Badge>
                ) : null}
              </div>
              {blogAuthorRequest ? (
                <Alert>
                  <Newspaper className="size-4" />
                  <AlertTitle>Blog author request</AlertTitle>
                  <AlertDescription>
                    {blogAuthorRequest.request_reason}
                    {blogAuthorRequest.review_note ? ` Review: ${blogAuthorRequest.review_note}` : ""}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipster or author display name">
                  <Input
                    disabled={!accessDraft.tipster && !accessDraft.blogPublish}
                    value={accessDraft.tipsterDisplayName}
                    onChange={(event) =>
                      setAccessDraft((current) => ({
                        ...current,
                        tipsterDisplayName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Audit reason">
                  <Input
                    value={accessDraft.reason}
                    onChange={(event) =>
                      setAccessDraft((current) => ({ ...current, reason: event.target.value }))
                    }
                  />
                </Field>
                <Field label="Tipster or author biography" className="sm:col-span-2">
                  <Textarea
                    disabled={!accessDraft.tipster && !accessDraft.blogPublish}
                    value={accessDraft.tipsterBiography}
                    onChange={(event) =>
                      setAccessDraft((current) => ({
                        ...current,
                        tipsterBiography: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Button
                type="button"
                disabled={processing === "access"}
                onClick={() => void saveAccess()}
              >
                {processing === "access" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Save account access and approved profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Audited Credit adjustment</CardTitle>
                <CardDescription>
                  Positive administrator adjustments add promotional Reward Credits. They grant access but never create tipster earnings or an ECHCU contribution. Negative adjustments remove Reward Credits first, then Purchased Credits. Duplicate requests are idempotent and the balance can never become negative.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
                <Input
                  type="number"
                  placeholder="+/- Credits"
                  value={walletDraft.amount}
                  onChange={(event) =>
                    setWalletDraft((current) => ({ ...current, amount: event.target.value }))
                  }
                />
                <Input
                  placeholder="Required audit reason"
                  value={walletDraft.reason}
                  onChange={(event) =>
                    setWalletDraft((current) => ({ ...current, reason: event.target.value }))
                  }
                />
                <Button
                  type="button"
                  disabled={processing === "wallet"}
                  onClick={requestCreditAdjustment}
                >
                  {processing === "wallet" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Coins className="size-4" />
                  )}
                  Adjust
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent Credit ledger</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.wallet.transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>{formatRaceDateTime(transaction.createdAt)}</TableCell>
                        <TableCell>{transaction.type.replaceAll("_", " ")}</TableCell>
                        <TableCell className={transaction.amount < 0 ? "text-brand-red" : "text-brand-cyan"}>
                          {transaction.amount > 0 ? "+" : ""}{transaction.amount}
                        </TableCell>
                        <TableCell>{formatCredits(transaction.balanceAfter)}</TableCell>
                        <TableCell>{transaction.reason || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="moderation">
          <Card>
            <CardHeader>
              <CardTitle>Account moderation</CardTitle>
              <CardDescription>
                Flags are internal. Suspensions and bans synchronize to Supabase Auth before email is queued.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canModerate ? (
                <Alert>
                  <ShieldCheck className="size-4" />
                  <AlertTitle>Protected account</AlertTitle>
                  <AlertDescription>
                    The owner, your own account, and administrators outside owner control cannot be moderated here.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Action">
                  <Select
                    value={moderationDraft.action}
                    onValueChange={(value) =>
                      setModerationDraft((current) => ({
                        ...current,
                        action: value as ModerationAction,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flag">Flag for review</SelectItem>
                      <SelectItem value="suspend">Temporary suspension</SelectItem>
                      <SelectItem value="ban">Permanent ban</SelectItem>
                      <SelectItem value="restore">Restore / unban</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Category">
                  <Input
                    disabled={moderationDraft.action === "restore"}
                    value={moderationDraft.category}
                    onChange={(event) =>
                      setModerationDraft((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  />
                </Field>
                {moderationDraft.action === "suspend" ? (
                  <Field label="Suspension expires">
                    <Input
                      type="datetime-local"
                      value={moderationDraft.suspensionUntil}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          suspensionUntil: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : null}
                {moderationDraft.action === "ban" ? (
                  <Field label='Type "BAN" to confirm'>
                    <Input
                      value={moderationDraft.confirmation}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          confirmation: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : null}
                <Field label="Internal reason" className="sm:col-span-2">
                  <Textarea
                    placeholder="Never sent to the user"
                    value={moderationDraft.internalReason}
                    onChange={(event) =>
                      setModerationDraft((current) => ({
                        ...current,
                        internalReason: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Public message (optional)" className="sm:col-span-2">
                  <Textarea
                    placeholder="Safe message included in the status email"
                    value={moderationDraft.publicMessage}
                    onChange={(event) =>
                      setModerationDraft((current) => ({
                        ...current,
                        publicMessage: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant={
                  moderationDraft.action === "ban" ||
                  moderationDraft.action === "suspend"
                    ? "destructive"
                    : "default"
                }
                disabled={!canModerate || processing === "moderation"}
                onClick={() => void applyModeration()}
              >
                {processing === "moderation" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : moderationDraft.action === "ban" ? (
                  <Ban className="size-4" />
                ) : (
                  <Flag className="size-4" />
                )}
                Apply {moderationDraft.action}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardHeader>
              <CardTitle>Append-only internal notes</CardTitle>
              <CardDescription>
                Notes are never sent to clients. Corrections are added as a new note.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Add an internal support, risk, or account note"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
              />
              <Button
                type="button"
                disabled={processing === "note" || noteBody.trim().length < 3}
                onClick={() => void addNote()}
              >
                {processing === "note" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <NotebookPen className="size-4" />
                )}
                Append note
              </Button>
              <div className="space-y-3">
                {detail.notes.map((note) => (
                  <div key={note.id} className="rounded-lg border bg-background/45 p-4">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {note.authorName} · {formatRaceDateTime(note.createdAt)}
                    </p>
                  </div>
                ))}
                {!detail.notes.length ? (
                  <p className="text-sm text-muted-foreground">No internal notes.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commerce">
          <div className="grid gap-4 xl:grid-cols-2">
            <ActivityList
              title="Client purchases"
              empty="This account has made no client purchases."
              rows={detail.purchases.map((purchase) => ({
                id: purchase.id,
                title:
                  purchase.meetingCard ||
                  purchase.subscriptionPackage ||
                  purchase.type,
                detail: `${purchase.tipsterName ?? "Tipster"} · ${formatCredits(Number(purchase.credits))} · ${purchase.status}`,
                date: purchase.createdAt,
              }))}
            />
            <ActivityList
              title="Client subscriptions"
              empty="This account has no client subscriptions."
              rows={detail.subscriptions.map((subscription) => ({
                id: subscription.id,
                title: `${subscription.tipsterName} — ${subscription.packageName}`,
                detail: `${subscription.status} · ends ${formatRaceDateTime(subscription.endsAt)}`,
                date: subscription.createdAt,
              }))}
            />
            <ActivityList
              title="Client refund requests"
              empty="This account has submitted no refund requests."
              rows={detail.disputes.map((dispute) => ({
                id: dispute.id,
                title: dispute.reason,
                detail: dispute.status,
                date: dispute.createdAt,
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="tipster">
          <div className="grid gap-4 xl:grid-cols-2">
            <ActivityList
              title="Packages offered"
              empty="This tipster has no subscription packages in the database."
              rows={(tipsterWorkspace?.packages ?? []).map((tipsterPackage) => ({
                id: tipsterPackage.id,
                title: tipsterPackage.name,
                detail: `${tipsterPackage.durationMonths} month${tipsterPackage.durationMonths === 1 ? "" : "s"} · ${formatCredits(Number(tipsterPackage.priceCredits))} · ${tipsterPackage.active ? "active" : "inactive"}`,
                date: tipsterPackage.updatedAt,
              }))}
            />
            <ActivityList
              title="Tipster sales"
              empty="This tipster has no client sales in the database."
              rows={(tipsterWorkspace?.sales ?? []).map((sale) => ({
                id: sale.id,
                title: `${sale.sourceLabel} — ${sale.buyerName || sale.buyerEmail}`,
                detail: `${sale.type} · ${sale.status} · ${formatCredits(Number(sale.totalCredits))} (${formatCredits(Number(sale.purchasedCredits))} Purchased + ${formatCredits(Number(sale.rewardCredits))} Reward)`,
                date: sale.createdAt,
              }))}
            />
            <ActivityList
              title="Meeting cards"
              empty="No tipster meeting cards."
              rows={detail.tipsterActivity.cards.map((card) => ({
                id: card.id,
                title: card.title,
                detail: `${card.status} · ${formatCredits(Number(card.creditPrice))} · revision ${card.revision}`,
                date: card.createdAt,
              }))}
            />
            <ActivityList
              title="Earnings ledger"
              empty="No tipster earnings."
              rows={detail.tipsterActivity.earnings.map((earning) => ({
                id: earning.id,
                title: `${earning.type} — ${formatCredits(Number(earning.netCredits))} net`,
                detail: `${formatCredits(Number(earning.grossCredits))} gross · ${formatCredits(Number(earning.platformFeeCredits))} fee`,
                date: earning.createdAt,
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Immutable audit history</CardTitle>
              <CardDescription>Latest 100 user and administrator events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.auditHistory.map((entry) => (
                <div key={entry.id} className="rounded-lg border bg-background/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{entry.action.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRaceDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.entityType} · actor {entry.actorId ?? "system"}
                  </p>
                  {entry.metadata ? (
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-black/20 p-3 text-xs text-muted-foreground">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={largeCreditDialogOpen} onOpenChange={setLargeCreditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm large Credit adjustment</DialogTitle>
            <DialogDescription>
              You are about to adjust this wallet by {walletDraft.amount} Credits. This action creates an immutable ledger and audit entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLargeCreditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void executeCreditAdjustment()}>
              Confirm adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={verifyEmailDialogOpen}
        onOpenChange={(open) => {
          setVerifyEmailDialogOpen(open);
          if (open) {
            setEmailActionError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify email manually</DialogTitle>
            <DialogDescription>
              This bypasses the confirmation link for {detail.identity.email}. Use it only after independently verifying ownership of the address.
            </DialogDescription>
          </DialogHeader>
          {emailActionError ? (
            <Alert variant="destructive" aria-live="assertive">
              <AlertCircle className="size-4" />
              <AlertTitle>Verification did not complete</AlertTitle>
              <AlertDescription>{emailActionError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-4">
            <Field label="Required audit reason">
              <Input
                value={manualVerificationReason}
                onChange={(event) => setManualVerificationReason(event.target.value)}
              />
            </Field>
            <Field label='Type "VERIFY" to confirm'>
              <Input
                value={verifyEmailConfirmation}
                onChange={(event) => setVerifyEmailConfirmation(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={processing === "email:verify_email"}
              onClick={() => setVerifyEmailDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                processing === "email:verify_email" ||
                verifyEmailConfirmation !== "VERIFY" ||
                manualVerificationReason.trim().length < 10
              }
              onClick={() => void runEmailConfirmationAction("verify_email")}
            >
              {processing === "email:verify_email" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              Confirm manual verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type FieldProps = {
  label: string;
  className?: string;
  children: React.ReactNode;
};

function Field({ label, className, children }: FieldProps) {
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

type CheckboxFieldProps = {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

function CheckboxField({ label, checked, disabled, onChange }: CheckboxFieldProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-base">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function DiagnosticValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

type ActivityListProps = {
  title: string;
  empty: string;
  rows: {
    id: string;
    title: string;
    detail: string;
    date: string;
  }[];
};

function ActivityList({ title, empty, rows }: ActivityListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border bg-background/45 p-4">
            <p className="font-semibold">{row.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
            <p className="mt-2 text-xs text-muted-foreground">{formatRaceDateTime(row.date)}</p>
          </div>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      </CardContent>
    </Card>
  );
}
