"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Banknote,
  BellRing,
  CheckCircle2,
  Coins,
  Loader2,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";
import { formatCoins, formatRaceDateTime } from "@/lib/racing/format";

type DashboardState = "loading" | "configured" | "signed-out" | "forbidden" | "ready" | "error";
type AppRole = "client" | "tipster" | "administrator";

type AdminUser = {
  user_id: string;
  email: string;
  display_name: string | null;
  phone: string | null;
  roles: AppRole[];
  wallet_balance: number;
  tipster_id: string | null;
  tipster_display_name: string | null;
  tipster_verified: boolean;
  test_access: boolean;
  created_at: string;
};

type UserDraft = {
  client: boolean;
  tipster: boolean;
  administrator: boolean;
  tipsterDisplayName: string;
  tipsterVerified: boolean;
  testAccess: boolean;
  walletAmount: string;
  walletReason: string;
};

type PlatformSettings = {
  zar_per_coin: number;
  commission_rate: number;
  updated_at: string;
};

type AdminDispute = {
  id: string;
  purchase_id: string;
  user_id: string;
  reason: string;
  status: "open" | "approved" | "rejected";
  admin_notes: string | null;
  created_at: string;
};

type OutboxRow = {
  id: string;
  event_type: string;
  status: "pending" | "processing" | "delivered" | "failed";
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string;
};

type AdminMetric = {
  label: string;
  value: string;
  change: string;
};

const initialMetrics: AdminMetric[] = [
  { label: "Registered users", value: "0", change: "Live" },
  { label: "Verified tipsters", value: "0", change: "Live" },
  { label: "Open disputes", value: "0", change: "Review" },
  { label: "Queued emails", value: "0", change: "Worker" },
];

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

export function AdminDashboardClient() {
  const router = useRouter();
  const [dashboardState, setDashboardState] = useState<DashboardState>("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<AdminMetric[]>(initialMetrics);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [zarPerCoin, setZarPerCoin] = useState("1");
  const [commissionRate, setCommissionRate] = useState("10");
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [disputeNotes, setDisputeNotes] = useState<Record<string, string>>({});
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [processingId, setProcessingId] = useState("");

  const loadAdminDashboard = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setDashboardState("configured");
      setMessage(supabaseConfigMessage);
      return;
    }

    setDashboardState("loading");
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setDashboardState("signed-out");
        setMessage("Please log in with an administrator account to view live operations.");
        return;
      }

      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (roleError) {
        throw roleError;
      }

      if (!(roles ?? []).some((row: { role: string }) => row.role === "administrator")) {
        setDashboardState("forbidden");
        setMessage("This account is signed in, but it is not marked as an administrator.");
        return;
      }

      const [userResult, settingsResult, disputeResult, outboxResult] = await Promise.all([
        supabase.rpc("admin_list_users"),
        supabase
          .from("platform_settings")
          .select("zar_per_coin,commission_rate,updated_at")
          .eq("singleton", true)
          .maybeSingle(),
        supabase
          .from("purchase_disputes")
          .select("id,purchase_id,user_id,reason,status,admin_notes,created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("notification_outbox")
          .select("id,event_type,status,attempt_count,provider_message_id,last_error,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const firstError =
        userResult.error ?? settingsResult.error ?? disputeResult.error ?? outboxResult.error;

      if (firstError) {
        throw firstError;
      }

      const loadedUsers = (userResult.data ?? []) as AdminUser[];
      const loadedSettings = settingsResult.data as PlatformSettings | null;
      const loadedDisputes = (disputeResult.data ?? []) as AdminDispute[];
      const loadedOutbox = (outboxResult.data ?? []) as OutboxRow[];
      const nextDrafts: Record<string, UserDraft> = {};

      for (const adminUser of loadedUsers) {
        nextDrafts[adminUser.user_id] = {
          client: adminUser.roles.includes("client"),
          tipster: adminUser.roles.includes("tipster"),
          administrator: adminUser.roles.includes("administrator"),
          tipsterDisplayName:
            adminUser.tipster_display_name ?? adminUser.display_name ?? adminUser.email.split("@")[0],
          tipsterVerified: adminUser.tipster_verified,
          testAccess: adminUser.test_access,
          walletAmount: "",
          walletReason: "Administrator test credit adjustment",
        };
      }

      setUsers(loadedUsers);
      setUserDrafts(nextDrafts);
      setSettings(loadedSettings);
      setZarPerCoin(String(loadedSettings?.zar_per_coin ?? 1));
      setCommissionRate(String(loadedSettings?.commission_rate ?? 10));
      setDisputes(loadedDisputes);
      setOutbox(loadedOutbox);
      setMetrics([
        { label: "Registered users", value: loadedUsers.length.toLocaleString(), change: "Live" },
        {
          label: "Verified tipsters",
          value: loadedUsers.filter((item) => item.tipster_verified).length.toLocaleString(),
          change: "Live",
        },
        {
          label: "Open disputes",
          value: loadedDisputes.filter((item) => item.status === "open").length.toLocaleString(),
          change: "Review",
        },
        {
          label: "Queued emails",
          value: loadedOutbox
            .filter((item) => item.status === "pending" || item.status === "failed")
            .length.toLocaleString(),
          change: "Worker",
        },
      ]);
      setDashboardState("ready");
      setMessage("Connected to the live MRCRacing Supabase operations layer.");
    } catch (loadError) {
      setDashboardState("error");
      setError(errorMessage(loadError, "Could not load the live admin dashboard."));
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAdminDashboard();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadAdminDashboard]);

  const userById = useMemo(
    () => new Map(users.map((adminUser) => [adminUser.user_id, adminUser])),
    [users],
  );

  async function handleLogout() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    router.push("/login/");
    router.refresh();
  }

  function updateUserDraft(userId: string, patch: Partial<UserDraft>) {
    setUserDrafts((current) => ({
      ...current,
      [userId]: {
        ...current[userId],
        ...patch,
      },
    }));
  }

  async function configureUser(userId: string) {
    const supabase = createClient();
    const draft = userDrafts[userId];

    if (!supabase || !draft) {
      return;
    }

    setProcessingId(userId);
    setError("");

    try {
      const { error: configureError } = await supabase.rpc("admin_configure_user", {
        p_user_id: userId,
        p_client: draft.client,
        p_tipster: draft.tipster,
        p_administrator: draft.administrator,
        p_tipster_display_name: draft.tipsterDisplayName,
        p_tipster_biography: null,
        p_verify_tipster: draft.tipster && draft.tipsterVerified,
        p_test_access: draft.testAccess,
      });

      if (configureError) {
        throw configureError;
      }

      setMessage("User roles, verification, and private test access were updated.");
      await loadAdminDashboard();
    } catch (configureError) {
      setError(errorMessage(configureError, "Could not update this user."));
    } finally {
      setProcessingId("");
    }
  }

  async function adjustWallet(userId: string) {
    const supabase = createClient();
    const draft = userDrafts[userId];
    const amount = Number(draft?.walletAmount ?? 0);

    if (!supabase || !draft) {
      return;
    }

    if (!Number.isInteger(amount) || amount === 0) {
      setError("Enter a non-zero whole-coin wallet adjustment.");
      return;
    }

    setProcessingId(`wallet-${userId}`);
    setError("");

    try {
      const { error: walletError } = await supabase.rpc("admin_adjust_wallet", {
        p_user_id: userId,
        p_amount: amount,
        p_reason: draft.walletReason,
      });

      if (walletError) {
        throw walletError;
      }

      setMessage("Wallet balance and immutable credit ledger were updated.");
      await loadAdminDashboard();
    } catch (walletError) {
      setError(errorMessage(walletError, "Could not adjust the wallet."));
    } finally {
      setProcessingId("");
    }
  }

  async function savePlatformSettings() {
    const supabase = createClient();
    const coinRate = Number(zarPerCoin);
    const commission = Number(commissionRate);

    if (!supabase) {
      return;
    }

    if (!(coinRate > 0) || commission < 0 || commission > 100) {
      setError("Enter a positive ZAR-to-coin rate and commission between 0% and 100%.");
      return;
    }

    setProcessingId("settings");
    setError("");

    try {
      const { error: settingsError } = await supabase
        .from("platform_settings")
        .update({
          zar_per_coin: coinRate,
          commission_rate: commission,
        })
        .eq("singleton", true);

      if (settingsError) {
        throw settingsError;
      }

      setMessage("Platform pricing and commission settings were saved.");
      await loadAdminDashboard();
    } catch (settingsError) {
      setError(errorMessage(settingsError, "Could not save platform settings."));
    } finally {
      setProcessingId("");
    }
  }

  async function resolveDispute(disputeId: string, approve: boolean) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessingId(disputeId);
    setError("");

    try {
      const { error: disputeError } = await supabase.rpc("resolve_purchase_dispute", {
        p_dispute_id: disputeId,
        p_approve_refund: approve,
        p_admin_notes: disputeNotes[disputeId] ?? "",
      });

      if (disputeError) {
        throw disputeError;
      }

      setMessage(approve ? "Dispute approved and exact refund reversal recorded." : "Dispute rejected with an immutable audit entry.");
      await processNotificationWorker();
      await loadAdminDashboard();
    } catch (disputeError) {
      setError(errorMessage(disputeError, "Could not resolve the dispute."));
    } finally {
      setProcessingId("");
    }
  }

  async function processNotificationWorker() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    const { error: workerError } = await supabase.functions.invoke("process-tip-notifications", {
      body: { source: "admin-dashboard" },
    });

    if (workerError) {
      setMessage("Database action succeeded. Email jobs remain queued until RESEND_API_KEY is configured.");
    }
  }

  async function runOperations() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessingId("operations");
    setError("");

    try {
      const { data: refundCount, error: refundError } = await supabase.rpc("process_due_meeting_refunds");

      if (refundError) {
        throw refundError;
      }

      await processNotificationWorker();
      setMessage(`${Number(refundCount ?? 0)} due meeting purchase refund(s) processed. Notification worker invoked.`);
      await loadAdminDashboard();
    } catch (operationError) {
      setError(errorMessage(operationError, "Operations could not be processed."));
    } finally {
      setProcessingId("");
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Alert
          className="sm:max-w-2xl"
          variant={dashboardState === "error" || dashboardState === "forbidden" ? "destructive" : "default"}
        >
          {dashboardState === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : dashboardState === "ready" ? (
            <Activity className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          <AlertTitle>
            {dashboardState === "ready"
              ? "Live Supabase administration"
              : dashboardState === "loading"
                ? "Loading live operations"
                : "Admin access check"}
          </AlertTitle>
          <AlertDescription>{error || message || "Checking your session and administrator role."}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          {dashboardState === "signed-out" ? (
            <Button asChild><Link href="/login/">Login</Link></Button>
          ) : null}
          {dashboardState === "ready" ? (
            <Button type="button" variant="outline" onClick={() => void loadAdminDashboard()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          ) : null}
          {dashboardState === "ready" || dashboardState === "forbidden" ? (
            <Button type="button" variant="outline" onClick={handleLogout}>Logout</Button>
          ) : null}
        </div>
      </div>

      {dashboardState === "ready" ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label}>
                <CardHeader className="space-y-0 pb-2">
                  <CardDescription>{metric.label}</CardDescription>
                  <CardTitle className="font-mono text-2xl">{metric.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant={metric.change === "Review" ? "destructive" : "secondary"}>
                    {metric.change}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="users">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="users"><Users className="size-4" />Users</TabsTrigger>
              <TabsTrigger value="disputes"><Banknote className="size-4" />Disputes</TabsTrigger>
              <TabsTrigger value="notifications"><BellRing className="size-4" />Notifications</TabsTrigger>
              <TabsTrigger value="system"><Settings className="size-4" />System</TabsTrigger>
            </TabsList>

            <TabsContent id="users" value="users">
              <Card>
                <CardHeader>
                  <CardTitle>User access and test wallets</CardTitle>
                  <CardDescription>
                    Every change is role-checked and audit logged. Verified tipsters may create cards for visible meetings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {users.map((adminUser) => {
                    const draft = userDrafts[adminUser.user_id];

                    if (!draft) {
                      return null;
                    }

                    return (
                      <div key={adminUser.user_id} className="rounded-lg border bg-background/40 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{adminUser.display_name || adminUser.email}</p>
                            <p className="text-sm text-muted-foreground">{adminUser.email}</p>
                          </div>
                          <Badge variant="outline">{formatCoins(adminUser.wallet_balance)}</Badge>
                        </div>
                        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-4 text-sm">
                              {([
                                ["client", "Client"],
                                ["tipster", "Tipster"],
                                ["administrator", "Administrator"],
                              ] as const).map(([key, label]) => (
                                <label key={key} className="flex items-center gap-2">
                                  <input
                                    checked={draft[key]}
                                    type="checkbox"
                                    onChange={(event) => updateUserDraft(adminUser.user_id, { [key]: event.target.checked })}
                                  />
                                  {label}
                                </label>
                              ))}
                              <label className="flex items-center gap-2">
                                <input
                                  checked={draft.testAccess}
                                  type="checkbox"
                                  onChange={(event) => updateUserDraft(adminUser.user_id, { testAccess: event.target.checked })}
                                />
                                Private test meetings
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  checked={draft.tipsterVerified}
                                  disabled={!draft.tipster}
                                  type="checkbox"
                                  onChange={(event) => updateUserDraft(adminUser.user_id, { tipsterVerified: event.target.checked })}
                                />
                                Verified tipster
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <Input
                                placeholder="Tipster display name"
                                value={draft.tipsterDisplayName}
                                onChange={(event) => updateUserDraft(adminUser.user_id, { tipsterDisplayName: event.target.value })}
                              />
                              <Button
                                disabled={processingId === adminUser.user_id}
                                type="button"
                                onClick={() => void configureUser(adminUser.user_id)}
                              >
                                {processingId === adminUser.user_id ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                                Save access
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Audited wallet adjustment</Label>
                            <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
                              <Input
                                placeholder="+/- coins"
                                type="number"
                                value={draft.walletAmount}
                                onChange={(event) => updateUserDraft(adminUser.user_id, { walletAmount: event.target.value })}
                              />
                              <Input
                                placeholder="Required reason"
                                value={draft.walletReason}
                                onChange={(event) => updateUserDraft(adminUser.user_id, { walletReason: event.target.value })}
                              />
                              <Button
                                disabled={processingId === `wallet-${adminUser.user_id}`}
                                type="button"
                                variant="outline"
                                onClick={() => void adjustWallet(adminUser.user_id)}
                              >
                                <Coins className="size-4" />
                                Adjust
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent id="disputes" value="disputes">
              <Card>
                <CardHeader>
                  <CardTitle>Purchase disputes</CardTitle>
                  <CardDescription>Approve a full refund or reject against the immutable purchase and earnings trail.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {disputes.map((dispute) => (
                    <div key={dispute.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{userById.get(dispute.user_id)?.email ?? "Client"}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{dispute.reason}</p>
                          <p className="mt-2 text-xs">{formatRaceDateTime(dispute.created_at)}</p>
                        </div>
                        <Badge variant={dispute.status === "open" ? "destructive" : "outline"}>{dispute.status}</Badge>
                      </div>
                      {dispute.status === "open" ? (
                        <div className="mt-4 space-y-2">
                          <Textarea
                            placeholder="Administrator decision notes"
                            value={disputeNotes[dispute.id] ?? ""}
                            onChange={(event) => setDisputeNotes((current) => ({
                              ...current,
                              [dispute.id]: event.target.value,
                            }))}
                          />
                          <div className="flex gap-2">
                            <Button disabled={processingId === dispute.id} type="button" onClick={() => void resolveDispute(dispute.id, true)}>
                              <CheckCircle2 className="size-4" />
                              Approve full refund
                            </Button>
                            <Button disabled={processingId === dispute.id} type="button" variant="destructive" onClick={() => void resolveDispute(dispute.id, false)}>
                              Reject dispute
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!disputes.length ? <p className="text-sm text-muted-foreground">No purchase disputes.</p> : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent id="notifications" value="notifications">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Email notification outbox</CardTitle>
                    <CardDescription>Idempotent delivery status, retry attempts, and sanitized provider errors.</CardDescription>
                  </div>
                  <Button disabled={processingId === "operations"} type="button" onClick={() => void runOperations()}>
                    {processingId === "operations" ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
                    Process refunds and queue
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Provider / error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outbox.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{formatRaceDateTime(item.created_at)}</TableCell>
                          <TableCell>{item.event_type.replaceAll("_", " ")}</TableCell>
                          <TableCell><Badge variant={item.status === "failed" ? "destructive" : "outline"}>{item.status}</Badge></TableCell>
                          <TableCell>{item.attempt_count}</TableCell>
                          <TableCell className="max-w-72 truncate">{item.provider_message_id || item.last_error || "—"}</TableCell>
                        </TableRow>
                      ))}
                      {!outbox.length ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No notification jobs yet.</TableCell></TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="system">
              <Card>
                <CardHeader>
                  <CardTitle>Coins and commission</CardTitle>
                  <CardDescription>
                    Tipster sales snapshot this commission at purchase time. Monetary coin values round to two decimals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="zar-per-coin">ZAR per coin</Label>
                    <Input id="zar-per-coin" min="0.01" step="0.01" type="number" value={zarPerCoin} onChange={(event) => setZarPerCoin(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="commission-rate">Platform commission %</Label>
                    <Input id="commission-rate" min="0" max="100" step="0.01" type="number" value={commissionRate} onChange={(event) => setCommissionRate(event.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Button disabled={processingId === "settings"} type="button" onClick={() => void savePlatformSettings()}>
                      {processingId === "settings" ? <Loader2 className="size-4 animate-spin" /> : <Settings className="size-4" />}
                      Save platform settings
                    </Button>
                    {settings ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Last updated {formatRaceDateTime(settings.updated_at)}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </>
  );
}
