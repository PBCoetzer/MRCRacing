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
  FileWarning,
  Flag,
  History,
  Loader2,
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
import { createClient } from "@/lib/supabase/client";

type AppRole = "client" | "tipster" | "administrator";
type AccountStatus = "active" | "flagged" | "suspended" | "banned";
type ModerationAction = "flag" | "suspend" | "ban" | "restore";

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
  tipsterVerified: boolean;
  blogPublish: boolean;
  testAccess: boolean;
  reason: string;
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

export function AdminUserDetailClient() {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [actorId, setActorId] = useState("");
  const [actorIsOwner, setActorIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
    tipsterVerified: false,
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

    const [detailResult, ownerResult, blogPermissionResult] = await Promise.all([
      supabase.rpc("admin_get_user_detail", { p_user_id: userId }),
      supabase
        .from("platform_owners")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("tipsters")
        .select("tipster_blog_permissions(can_publish)")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (detailResult.error || !detailResult.data) {
      setError(detailResult.error?.message ?? "User record not found.");
      setLoading(false);
      return;
    }

    if (ownerResult.error || blogPermissionResult.error) {
      setError(ownerResult.error?.message ?? blogPermissionResult.error?.message ?? "Could not load access controls.");
      setLoading(false);
      return;
    }

    const loadedDetail = detailResult.data as UserDetail;
    setDetail(loadedDetail);
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
      tipsterVerified: loadedDetail.access.tipsterVerified,
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

  const targetIsAdministrator = detail?.roles.includes("administrator") ?? false;
  const targetIsSelf = detail?.identity.userId === actorId;
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
      const { error: accessError } = await supabase.rpc("admin_configure_user_v2", {
        p_user_id: detail.identity.userId,
        p_client: accessDraft.client,
        p_tipster: accessDraft.tipster,
        p_administrator: accessDraft.administrator,
        p_tipster_display_name: accessDraft.tipsterDisplayName || null,
        p_tipster_biography: accessDraft.tipsterBiography || null,
        p_verify_tipster: accessDraft.tipster && accessDraft.tipsterVerified,
        p_test_access: accessDraft.testAccess,
        p_reason: accessDraft.reason,
      });

      if (accessError) {
        throw accessError;
      }

      if (accessDraft.tipster || detail.access.tipsterId) {
        const { error: blogPermissionError } = await supabase.rpc(
          "admin_set_tipster_blog_permission",
          {
            p_user_id: detail.identity.userId,
            p_can_publish:
              accessDraft.tipster && accessDraft.tipsterVerified && accessDraft.blogPublish,
            p_reason: accessDraft.reason,
          },
        );
        if (blogPermissionError) throw blogPermissionError;
      }

      setMessage("Roles, tipster verification, blog-author permission, and private test access were audit logged.");
      await loadDetail();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not update user access."));
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
            {detail.moderation.authSyncStatus !== "synced" ? (
              <Badge variant="destructive">Auth {detail.moderation.authSyncStatus}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{detail.identity.email}</p>
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

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Credit balance" value={formatCredits(detail.wallet.balance)} />
        <SummaryCard label="Roles" value={detail.roles.join(", ") || "None"} />
        <SummaryCard
          label="Email"
          value={detail.identity.emailConfirmed ? "Confirmed" : "Confirmation pending"}
        />
        <SummaryCard
          label="Last sign-in"
          value={
            detail.identity.lastSignInAt
              ? formatRaceDateTime(detail.identity.lastSignInAt)
              : "Never"
          }
        />
      </div>

      <Tabs defaultValue="identity">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="identity"><CircleUserRound className="size-4" />Identity</TabsTrigger>
          <TabsTrigger value="access"><UserCog className="size-4" />Access</TabsTrigger>
          <TabsTrigger value="credits"><Coins className="size-4" />Credits</TabsTrigger>
          <TabsTrigger value="moderation"><ShieldCheck className="size-4" />Moderation</TabsTrigger>
          <TabsTrigger value="notes"><NotebookPen className="size-4" />Notes</TabsTrigger>
          <TabsTrigger value="commerce"><Banknote className="size-4" />Commerce</TabsTrigger>
          <TabsTrigger value="tipster"><ClipboardList className="size-4" />Tipster</TabsTrigger>
          <TabsTrigger value="audit"><History className="size-4" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
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
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Roles and tipster access</CardTitle>
              <CardDescription>
                Only the platform owner can grant or remove administrator access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-4">
                <CheckboxField
                  label="Client"
                  checked={accessDraft.client}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, client: checked }))
                  }
                />
                <CheckboxField
                  label="Tipster"
                  checked={accessDraft.tipster}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, tipster: checked }))
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
                <CheckboxField
                  label="Verified tipster"
                  checked={accessDraft.tipsterVerified}
                  disabled={!accessDraft.tipster}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, tipsterVerified: checked }))
                  }
                />
                <CheckboxField
                  label="May publish blog posts"
                  checked={accessDraft.blogPublish}
                  disabled={!accessDraft.tipster || !accessDraft.tipsterVerified}
                  onChange={(checked) =>
                    setAccessDraft((current) => ({ ...current, blogPublish: checked }))
                  }
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipster display name">
                  <Input
                    disabled={!accessDraft.tipster}
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
                <Field label="Tipster biography" className="sm:col-span-2">
                  <Textarea
                    disabled={!accessDraft.tipster}
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
                Save access
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
                  Duplicate requests are idempotent and the balance can never become negative.
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
              title="Purchases"
              empty="No purchases."
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
              title="Subscriptions"
              empty="No tipster subscriptions."
              rows={detail.subscriptions.map((subscription) => ({
                id: subscription.id,
                title: `${subscription.tipsterName} — ${subscription.packageName}`,
                detail: `${subscription.status} · ends ${formatRaceDateTime(subscription.endsAt)}`,
                date: subscription.createdAt,
              }))}
            />
            <ActivityList
              title="Disputes"
              empty="No disputes."
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
