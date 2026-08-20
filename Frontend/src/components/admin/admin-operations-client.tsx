"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Gift,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatRaceDateTime } from "@/lib/racing/format";
import { professionalSourceName } from "@/lib/racing/source-brand";
import { createClient } from "@/lib/supabase/client";

type PlatformSettings = {
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

type TestMeeting = {
  id: string;
  venue: string;
  meeting_date: string;
  first_race_at: string;
  source_name: string;
};

type UserSearchResult = {
  total: number;
};

type AdminCreditPackage = {
  id: string;
  name: string;
  credits: number;
  reward_credits: number;
  price_cents: number;
  promotion_label: string | null;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
};

type AccessTraceResult = {
  accessCode: string;
  userId: string;
  email: string;
  displayName: string | null;
  tipCardId: string;
  cardTitle: string;
  accessedAt: string;
  termsVersion: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

export function AdminOperationsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState("");
  const [userCount, setUserCount] = useState(0);
  const [verifiedTipsters, setVerifiedTipsters] = useState(0);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [commissionRate, setCommissionRate] = useState("10");
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [disputeNotes, setDisputeNotes] = useState<Record<string, string>>({});
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [testMeetings, setTestMeetings] = useState<TestMeeting[]>([]);
  const [creditPackages, setCreditPackages] = useState<AdminCreditPackage[]>([]);
  const [packageDrafts, setPackageDrafts] = useState<Record<string, AdminCreditPackage>>({});
  const [newPackage, setNewPackage] = useState<Omit<AdminCreditPackage, "id" | "updated_at">>({
    name: "",
    credits: 100,
    reward_credits: 0,
    price_cents: 10000,
    promotion_label: "",
    is_active: true,
    sort_order: 60,
  });
  const [accessCode, setAccessCode] = useState("");
  const [accessTrace, setAccessTrace] = useState<AccessTraceResult | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState(
    "Move unused private meeting for continued workflow testing",
  );

  const loadOperations = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const [usersResult, tipstersResult, settingsResult, disputeResult, outboxResult, meetingResult, packageResult] =
      await Promise.all([
        supabase.rpc("admin_search_users", {
          p_page: 1,
          p_page_size: 1,
        }),
        supabase
          .from("tipsters")
          .select("id", { count: "exact", head: true })
          .eq("is_verified", true),
        supabase
          .from("platform_settings")
          .select("commission_rate,updated_at")
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
        supabase
          .from("race_meetings")
          .select("id,venue,meeting_date,first_race_at,source_name")
          .eq("is_test", true)
          .eq("status", "scheduled")
          .order("first_race_at"),
        supabase
          .from("credit_packages")
          .select("id,name,credits,reward_credits,price_cents,promotion_label,is_active,sort_order,updated_at")
          .order("sort_order"),
      ]);

    const firstError =
      usersResult.error ??
      tipstersResult.error ??
      settingsResult.error ??
      disputeResult.error ??
      outboxResult.error ??
      meetingResult.error ??
      packageResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const userSearch = usersResult.data as UserSearchResult | null;
    const loadedSettings = settingsResult.data as PlatformSettings | null;

    setUserCount(userSearch?.total ?? 0);
    setVerifiedTipsters(tipstersResult.count ?? 0);
    setSettings(loadedSettings);
    setCommissionRate(String(loadedSettings?.commission_rate ?? 10));
    setDisputes((disputeResult.data ?? []) as AdminDispute[]);
    setOutbox((outboxResult.data ?? []) as OutboxRow[]);
    setTestMeetings((meetingResult.data ?? []) as TestMeeting[]);
    const loadedPackages = (packageResult.data ?? []) as AdminCreditPackage[];
    setCreditPackages(loadedPackages);
    setPackageDrafts(Object.fromEntries(loadedPackages.map((item) => [item.id, item])));
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOperations();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadOperations]);

  async function processNotificationWorker() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    const { error: workerError } = await supabase.functions.invoke(
      "deliver-tip-notifications",
      { body: { source: "admin-dashboard" } },
    );

    if (workerError) {
      setMessage("Jobs remain queued; the notification worker reported a delivery issue.");
    }
  }

  async function resolveDispute(disputeId: string, approve: boolean) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessing(disputeId);
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

      setMessage(
        approve
          ? "Dispute approved and the exact Credit reversal was recorded."
          : "Dispute rejected with an immutable audit entry.",
      );
      await processNotificationWorker();
      await loadOperations();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not resolve the dispute."));
    } finally {
      setProcessing("");
    }
  }

  async function runOperations() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessing("operations");
    setError("");

    try {
      const { data: refundCount, error: refundError } = await supabase.rpc(
        "process_due_meeting_refunds",
      );

      if (refundError) {
        throw refundError;
      }

      await processNotificationWorker();
      setMessage(
        `${Number(refundCount ?? 0)} due meeting refund(s) processed. The email worker was invoked.`,
      );
      await loadOperations();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Operations could not be processed."));
    } finally {
      setProcessing("");
    }
  }

  async function savePlatformSettings() {
    const supabase = createClient();
    const commission = Number(commissionRate);

    if (!supabase) {
      return;
    }

    if (commission < 0 || commission > 100) {
      setError("Enter a commission between 0% and 100%.");
      return;
    }

    setProcessing("settings");
    setError("");

    try {
      const { error: settingsError } = await supabase
        .from("platform_settings")
        .update({ zar_per_coin: 1, commission_rate: commission })
        .eq("singleton", true);

      if (settingsError) {
        throw settingsError;
      }

      setMessage("Commission saved. The public conversion remains fixed at R1 = 1 Credit.");
      await loadOperations();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not save platform settings."));
    } finally {
      setProcessing("");
    }
  }

  function updatePackageDraft(
    packageId: string,
    changes: Partial<AdminCreditPackage>,
  ) {
    setPackageDrafts((current) => ({
      ...current,
      [packageId]: { ...current[packageId], ...changes },
    }));
  }

  async function saveCreditPackage(
    creditPackage: Omit<AdminCreditPackage, "updated_at" | "id"> & { id?: string },
    isNew = false,
  ) {
    const supabase = createClient();
    if (!supabase) return;

    if (!creditPackage.name.trim()) {
      setError("A Credit package name is required.");
      return;
    }
    if (creditPackage.credits < 1 || creditPackage.reward_credits < 0) {
      setError("Purchased and Reward Credit amounts must be valid positive values.");
      return;
    }

    const processingKey = isNew ? "package-new" : `package-${creditPackage.id ?? "unknown"}`;
    setProcessing(processingKey);
    setError("");

    try {
      const { error: packageError } = await supabase.rpc(
        "admin_upsert_credit_package",
        {
          p_package_id: isNew ? null : creditPackage.id,
          p_name: creditPackage.name.trim(),
          p_credits: Number(creditPackage.credits),
          p_reward_credits: Number(creditPackage.reward_credits),
          p_promotion_label: creditPackage.promotion_label?.trim() || null,
          p_is_active: creditPackage.is_active,
          p_sort_order: Number(creditPackage.sort_order),
        },
      );

      if (packageError) throw packageError;

      setMessage(
        isNew
          ? "Credit package created. Checkout will snapshot its current values."
          : "Credit package updated. Existing payment snapshots were not changed.",
      );
      if (isNew) {
        setNewPackage({
          name: "",
          credits: 100,
          reward_credits: 0,
          price_cents: 10000,
          promotion_label: "",
          is_active: true,
          sort_order: 60,
        });
      }
      await loadOperations();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not save the Credit package."));
    } finally {
      setProcessing("");
    }
  }

  async function lookupAccessCode() {
    const supabase = createClient();
    if (!supabase) return;

    setProcessing("access-trace");
    setError("");
    setAccessTrace(null);

    try {
      const { data, error: lookupError } = await supabase.rpc(
        "admin_lookup_tip_card_access",
        { p_access_code: accessCode.trim() },
      );
      if (lookupError) throw lookupError;
      if (!data) throw new Error("No premium-content access record matches that code.");
      setAccessTrace(data as AccessTraceResult);
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not trace the access code."));
    } finally {
      setProcessing("");
    }
  }

  async function rescheduleMeeting(meetingId: string, daysAhead: 3 | 7 | 14) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessing(`meeting-${meetingId}-${daysAhead}`);
    setError("");

    try {
      const { error: rescheduleError } = await supabase.rpc(
        "admin_reschedule_test_meeting",
        {
          p_meeting_id: meetingId,
          p_days_ahead: daysAhead,
          p_reason: rescheduleReason,
        },
      );

      if (rescheduleError) {
        throw rescheduleError;
      }

      setMessage(`Private test meeting moved ${daysAhead} days ahead with all race cutoffs.`);
      await loadOperations();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not reschedule the test meeting."));
    } finally {
      setProcessing("");
    }
  }

  const openDisputes = disputes.filter((item) => item.status === "open").length;
  const queuedEmails = outbox.filter(
    (item) => item.status === "pending" || item.status === "failed",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Alert className="sm:max-w-2xl" variant={error ? "destructive" : "default"}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : error ? (
            <AlertCircle className="size-4" />
          ) : (
            <Activity className="size-4" />
          )}
          <AlertTitle>{loading ? "Loading operations" : error ? "Operations issue" : "Admin V1 live"}</AlertTitle>
          <AlertDescription>
            {error || message || "Owner protection, user moderation, and audited Credits are active."}
          </AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={() => void loadOperations()}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Registered users", userCount, "Directory"],
          ["Verified tipsters", verifiedTipsters, "Profiles"],
          ["Open disputes", openDisputes, "Review"],
          ["Queued emails", queuedEmails, "Worker"],
        ].map(([label, value, action]) => (
          <Card key={String(label)}>
            <CardHeader className="space-y-0 pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="font-mono text-2xl">{Number(value).toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={action === "Review" ? "destructive" : "secondary"}>{action}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>User administration</CardTitle>
            <CardDescription>
              Search names, email, phone, status, roles, verification, and test access.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/admin/users/">
              <Users className="size-4" />
              Open directory
            </Link>
          </Button>
        </CardHeader>
      </Card>

      <Tabs defaultValue="meetings">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="meetings"><CalendarClock className="size-4" />Test meetings</TabsTrigger>
          <TabsTrigger value="disputes"><Banknote className="size-4" />Disputes</TabsTrigger>
          <TabsTrigger value="notifications"><BellRing className="size-4" />Notifications</TabsTrigger>
          <TabsTrigger value="packages"><Gift className="size-4" />Credit packages</TabsTrigger>
          <TabsTrigger value="system"><Settings className="size-4" />System</TabsTrigger>
        </TabsList>

        <TabsContent value="meetings">
          <Card>
            <CardHeader>
              <CardTitle>Private synthetic meetings</CardTitle>
              <CardDescription>
                Move an unused meeting to a new testing window. Published or purchased cards are protected.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="reschedule-reason">Audit reason</Label>
                <Input
                  id="reschedule-reason"
                  value={rescheduleReason}
                  onChange={(event) => setRescheduleReason(event.target.value)}
                />
              </div>
              {testMeetings.map((meeting) => (
                <div key={meeting.id} className="rounded-lg border bg-background/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{meeting.venue}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatRaceDateTime(meeting.first_race_at)} · {professionalSourceName(meeting.source_name)}
                      </p>
                    </div>
                    <Badge variant="outline">Private test</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {([3, 7, 14] as const).map((days) => (
                      <Button
                        key={days}
                        type="button"
                        variant="outline"
                        disabled={processing.startsWith(`meeting-${meeting.id}`)}
                        onClick={() => void rescheduleMeeting(meeting.id, days)}
                      >
                        {processing === `meeting-${meeting.id}-${days}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CalendarClock className="size-4" />
                        )}
                        Move {days} days ahead
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {!testMeetings.length ? (
                <p className="text-sm text-muted-foreground">No scheduled private meetings.</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent id="disputes" value="disputes">
          <Card>
            <CardHeader>
              <CardTitle>Purchase disputes</CardTitle>
              <CardDescription>Approve or reject against the immutable purchase trail.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Button asChild variant="link" className="h-auto p-0">
                        <Link href={`/admin/user/?user=${dispute.user_id}`}>Open client record</Link>
                      </Button>
                      <p className="mt-1 text-sm text-muted-foreground">{dispute.reason}</p>
                      <p className="mt-2 text-xs">{formatRaceDateTime(dispute.created_at)}</p>
                    </div>
                    <Badge variant={dispute.status === "open" ? "destructive" : "outline"}>
                      {dispute.status}
                    </Badge>
                  </div>
                  {dispute.status === "open" ? (
                    <div className="mt-4 space-y-2">
                      <Textarea
                        placeholder="Administrator decision notes"
                        value={disputeNotes[dispute.id] ?? ""}
                        onChange={(event) =>
                          setDisputeNotes((current) => ({
                            ...current,
                            [dispute.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          disabled={processing === dispute.id}
                          type="button"
                          onClick={() => void resolveDispute(dispute.id, true)}
                        >
                          <CheckCircle2 className="size-4" />
                          Approve refund
                        </Button>
                        <Button
                          disabled={processing === dispute.id}
                          type="button"
                          variant="destructive"
                          onClick={() => void resolveDispute(dispute.id, false)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              {!disputes.length ? <p className="text-sm text-muted-foreground">No disputes.</p> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent id="notifications" value="notifications">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Email notification outbox</CardTitle>
                <CardDescription>Delivery attempts and sanitized provider errors.</CardDescription>
              </div>
              <Button
                disabled={processing === "operations"}
                type="button"
                onClick={() => void runOperations()}
              >
                {processing === "operations" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BellRing className="size-4" />
                )}
                Process queue
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
                      <TableCell>
                        <Badge variant={item.status === "failed" ? "destructive" : "outline"}>
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.attempt_count}</TableCell>
                      <TableCell className="max-w-72 truncate">
                        {item.provider_message_id || item.last_error || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent id="packages" value="packages">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Purchased and Reward Credit packages</CardTitle>
                <CardDescription>
                  Purchased Credits remain R1 each. Bonus Reward Credits are promotional,
                  stay in the separate Reward wallet, and do not create tipster earnings or
                  charity accrual. Existing checkouts retain their original snapshot.
                </CardDescription>
              </CardHeader>
            </Card>

            {creditPackages.map((creditPackage) => {
              const draft = packageDrafts[creditPackage.id] ?? creditPackage;
              return (
                <Card key={creditPackage.id}>
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{draft.name}</CardTitle>
                      <CardDescription>
                        Updated {formatRaceDateTime(creditPackage.updated_at)}
                      </CardDescription>
                    </div>
                    <Badge variant={draft.is_active ? "default" : "secondary"}>
                      {draft.is_active ? "Active" : "Hidden"}
                    </Badge>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                    <div className="space-y-2 xl:col-span-2">
                      <Label htmlFor={`package-name-${draft.id}`}>Package name</Label>
                      <Input
                        id={`package-name-${draft.id}`}
                        value={draft.name}
                        onChange={(event) => updatePackageDraft(draft.id, { name: event.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`package-credits-${draft.id}`}>Purchased Credits</Label>
                      <Input
                        id={`package-credits-${draft.id}`}
                        min="1"
                        type="number"
                        value={draft.credits}
                        onChange={(event) => updatePackageDraft(draft.id, {
                          credits: Number(event.target.value),
                          price_cents: Number(event.target.value) * 100,
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`package-reward-${draft.id}`}>Reward Credits</Label>
                      <Input
                        id={`package-reward-${draft.id}`}
                        min="0"
                        type="number"
                        value={draft.reward_credits}
                        onChange={(event) => updatePackageDraft(draft.id, { reward_credits: Number(event.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`package-order-${draft.id}`}>Display order</Label>
                      <Input
                        id={`package-order-${draft.id}`}
                        min="0"
                        type="number"
                        value={draft.sort_order}
                        onChange={(event) => updatePackageDraft(draft.id, { sort_order: Number(event.target.value) })}
                      />
                    </div>
                    <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) => updatePackageDraft(draft.id, { is_active: event.target.checked })}
                      />
                      Available for sale
                    </label>
                    <div className="space-y-2 md:col-span-2 xl:col-span-4">
                      <Label htmlFor={`package-promo-${draft.id}`}>Promotion label</Label>
                      <Input
                        id={`package-promo-${draft.id}`}
                        maxLength={80}
                        placeholder="Example: Best value — 125 Reward Credits"
                        value={draft.promotion_label ?? ""}
                        onChange={(event) => updatePackageDraft(draft.id, { promotion_label: event.target.value })}
                      />
                    </div>
                    <div className="rounded-lg border bg-background/45 p-3 text-sm">
                      Price: <strong>{new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(draft.credits)}</strong>
                    </div>
                    <Button
                      type="button"
                      disabled={processing === `package-${draft.id}`}
                      onClick={() => void saveCreditPackage(draft)}
                    >
                      {processing === `package-${draft.id}` ? <Loader2 className="size-4 animate-spin" /> : <Settings className="size-4" />}
                      Save package
                    </Button>
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><PackagePlus className="size-5 text-brand-cyan" />Add Credit package</CardTitle>
                <CardDescription>Create another admin-controlled package without deleting historical packages.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <div className="space-y-2 xl:col-span-2">
                  <Label htmlFor="new-package-name">Package name</Label>
                  <Input id="new-package-name" value={newPackage.name} onChange={(event) => setNewPackage((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-package-credits">Purchased Credits</Label>
                  <Input id="new-package-credits" min="1" type="number" value={newPackage.credits} onChange={(event) => setNewPackage((current) => ({ ...current, credits: Number(event.target.value), price_cents: Number(event.target.value) * 100 }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-package-reward">Reward Credits</Label>
                  <Input id="new-package-reward" min="0" type="number" value={newPackage.reward_credits} onChange={(event) => setNewPackage((current) => ({ ...current, reward_credits: Number(event.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-package-order">Display order</Label>
                  <Input id="new-package-order" min="0" type="number" value={newPackage.sort_order} onChange={(event) => setNewPackage((current) => ({ ...current, sort_order: Number(event.target.value) }))} />
                </div>
                <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
                  <input type="checkbox" checked={newPackage.is_active} onChange={(event) => setNewPackage((current) => ({ ...current, is_active: event.target.checked }))} />
                  Available for sale
                </label>
                <div className="space-y-2 md:col-span-2 xl:col-span-5">
                  <Label htmlFor="new-package-promo">Promotion label</Label>
                  <Input id="new-package-promo" maxLength={80} value={newPackage.promotion_label ?? ""} onChange={(event) => setNewPackage((current) => ({ ...current, promotion_label: event.target.value }))} />
                </div>
                <Button type="button" disabled={processing === "package-new"} onClick={() => void saveCreditPackage(newPackage, true)}>
                  {processing === "package-new" ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
                  Create package
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent id="system" value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Credits and commission</CardTitle>
              <CardDescription>
                R1 always equals 1 Credit. Sale records snapshot the commission.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border bg-background/45 p-4">
                <p className="text-sm text-muted-foreground">Fixed public conversion</p>
                <p className="mt-1 font-mono text-2xl font-bold">R1 = 1 Credit</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="commission-rate">Platform commission %</Label>
                <Input
                  id="commission-rate"
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={commissionRate}
                  onChange={(event) => setCommissionRate(event.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  disabled={processing === "settings"}
                  type="button"
                  onClick={() => void savePlatformSettings()}
                >
                  {processing === "settings" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Settings className="size-4" />
                  )}
                  Save settings
                </Button>
                {settings ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last updated {formatRaceDateTime(settings.updated_at)}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Premium-content access trace</CardTitle>
              <CardDescription>
                Enter the visible MRC watermark code from a shared screenshot to identify
                the licensed account and original card-access event.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Premium content access code"
                  placeholder="MRC-XXXXXXXXXXXX"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
                />
                <Button
                  type="button"
                  disabled={!accessCode.trim() || processing === "access-trace"}
                  onClick={() => void lookupAccessCode()}
                >
                  {processing === "access-trace" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Trace access
                </Button>
              </div>
              {accessTrace ? (
                <div className="grid gap-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-4 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Account:</span> {accessTrace.displayName || "MRC Client"}</p>
                  <p><span className="text-muted-foreground">Email:</span> {accessTrace.email}</p>
                  <p><span className="text-muted-foreground">Card:</span> {accessTrace.cardTitle}</p>
                  <p><span className="text-muted-foreground">Opened:</span> {formatRaceDateTime(accessTrace.accessedAt)}</p>
                  <p><span className="text-muted-foreground">Code:</span> <span className="font-mono">{accessTrace.accessCode}</span></p>
                  <p><span className="text-muted-foreground">Terms:</span> {accessTrace.termsVersion}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
