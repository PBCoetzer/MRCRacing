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
  Loader2,
  RefreshCw,
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

    const [usersResult, tipstersResult, settingsResult, disputeResult, outboxResult, meetingResult] =
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
      ]);

    const firstError =
      usersResult.error ??
      tipstersResult.error ??
      settingsResult.error ??
      disputeResult.error ??
      outboxResult.error ??
      meetingResult.error;

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
      "process-tip-notifications",
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
                        {formatRaceDateTime(meeting.first_race_at)} · {meeting.source_name}
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

        <TabsContent id="system" value="system">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
