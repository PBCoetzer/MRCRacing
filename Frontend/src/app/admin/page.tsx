import { Activity, Banknote, Settings, Users } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminMetrics, transactions } from "@/lib/mock-data";

const adminNav = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin" },
  { label: "Tipsters", href: "/admin" },
  { label: "Fixtures", href: "/admin" },
  { label: "Payments", href: "/admin" },
  { label: "Audit Logs", href: "/admin" },
];

export default function AdminPage() {
  return (
    <DashboardShell
      title="Admin dashboard"
      description="Operational control for users, tipsters, fixtures, credits, payments, announcements, API keys, roles, permissions, and audit logs."
      nav={adminNav}
    >
      <div className="grid gap-4 md:grid-cols-4">
        {adminMetrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="space-y-0 pb-2">
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="font-mono text-2xl">{metric.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={metric.change === "Review" ? "destructive" : "secondary"}>{metric.change}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="payments" className="mt-6">
        <TabsList>
          <TabsTrigger value="payments"><Banknote className="size-4" />Payments</TabsTrigger>
          <TabsTrigger value="users"><Users className="size-4" />Users</TabsTrigger>
          <TabsTrigger value="system"><Settings className="size-4" />System</TabsTrigger>
        </TabsList>
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Credit ledger activity</CardTitle>
              <CardDescription>Every credit movement must be traceable.</CardDescription>
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
                      <TableCell><Badge variant="outline">{transaction.status}</Badge></TableCell>
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
                  <p className="text-sm text-muted-foreground">Audit logging required before launch.</p>
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
    </DashboardShell>
  );
}
