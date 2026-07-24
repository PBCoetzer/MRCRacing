"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, AlertCircle, Banknote, Loader2, Settings, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";
import { transactions } from "@/lib/mock-data";

type DashboardState = "loading" | "configured" | "signed-out" | "forbidden" | "ready" | "error";

type AdminMetric = {
  label: string;
  value: string;
  change: string;
};

type RoleRow = {
  role: string;
};

const initialMetrics: AdminMetric[] = [
  { label: "Active users", value: "0", change: "Live" },
  { label: "Tipsters", value: "0", change: "Live" },
  { label: "Pending payments", value: "0", change: "Live" },
  { label: "Audit events", value: "0", change: "Live" },
];

export function AdminDashboardClient() {
  const router = useRouter();
  const [dashboardState, setDashboardState] = useState<DashboardState>("loading");
  const [message, setMessage] = useState("");
  const [metrics, setMetrics] = useState<AdminMetric[]>(initialMetrics);

  useEffect(() => {
    let isMounted = true;

    async function loadAdminDashboard() {
      const supabase = createClient();

      if (!supabase) {
        setDashboardState("configured");
        setMessage(supabaseConfigMessage);
        return;
      }

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
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

        const roleRows = (roles ?? []) as RoleRow[];

        if (!roleRows.some((row) => row.role === "administrator")) {
          setDashboardState("forbidden");
          setMessage("This account is signed in, but it is not marked as an administrator.");
          return;
        }

        const [profiles, tipsters, pendingPayments, auditLogs] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("tipsters").select("id", { count: "exact", head: true }),
          supabase
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase.from("audit_logs").select("id", { count: "exact", head: true }),
        ]);

        const firstError =
          profiles.error ?? tipsters.error ?? pendingPayments.error ?? auditLogs.error;

        if (firstError) {
          throw firstError;
        }

        if (!isMounted) {
          return;
        }

        setMetrics([
          {
            label: "Active users",
            value: (profiles.count ?? 0).toLocaleString(),
            change: "Live",
          },
          {
            label: "Tipsters",
            value: (tipsters.count ?? 0).toLocaleString(),
            change: "Live",
          },
          {
            label: "Pending payments",
            value: (pendingPayments.count ?? 0).toLocaleString(),
            change: "Review",
          },
          {
            label: "Audit events",
            value: (auditLogs.count ?? 0).toLocaleString(),
            change: "Live",
          },
        ]);
        setDashboardState("ready");
        setMessage("Connected to the live MRCRacing Supabase project.");
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setDashboardState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load the live admin dashboard.",
        );
      }
    }

    loadAdminDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    router.push("/login/");
    router.refresh();
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
              ? "Live Supabase admin"
              : dashboardState === "loading"
                ? "Loading live admin data"
                : "Admin access check"}
          </AlertTitle>
          <AlertDescription>{message || "Checking your Supabase session and admin role."}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          {dashboardState === "signed-out" ? (
            <Button asChild>
              <Link href="/login/">Login</Link>
            </Button>
          ) : null}
          {dashboardState === "ready" || dashboardState === "forbidden" ? (
            <Button type="button" variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          ) : null}
        </div>
      </div>

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

      <Tabs defaultValue="payments" className="mt-6">
        <TabsList>
          <TabsTrigger value="payments">
            <Banknote className="size-4" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="size-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="system">
            <Settings className="size-4" />
            System
          </TabsTrigger>
        </TabsList>
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Credit ledger activity</CardTitle>
              <CardDescription>
                Live payment counts load from Supabase; sample ledger rows remain until payment
                adapters are built.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={`${transaction.user}-${transaction.type}`}>
                      <TableCell className="font-mono">{transaction.user}</TableCell>
                      <TableCell>{transaction.type}</TableCell>
                      <TableCell className="font-mono">{transaction.amount}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{transaction.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>User and role queue</CardTitle>
              <CardDescription>Placeholder for client, tipster, and administrator management.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {["Client approvals", "Tipster verification", "Admin role changes"].map((item) => (
                <div key={item} className="border p-4">
                  <Activity className="mb-3 size-5 text-primary" />
                  <p className="font-semibold">{item}</p>
                  <p className="text-sm text-muted-foreground">
                    Audit logging required before launch.
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>System configuration</CardTitle>
              <CardDescription>Payment gateways, sports data keys, roles, and API settings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {["PayFast", "Ozow", "PayGate", "Peach Payments"].map((gateway) => (
                <div key={gateway} className="flex items-center justify-between border p-3">
                  <span>{gateway}</span>
                  <Badge variant="secondary">Adapter planned</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
