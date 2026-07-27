"use client";

import { Bell, CreditCard, History, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { premiumTips } from "@/lib/mock-data";

export function ClientDashboardClient() {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Credit balance", value: "42", icon: Wallet },
          { label: "Unlocked tips", value: "18", icon: History },
          { label: "Notifications", value: "3", icon: Bell },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="flex items-center gap-2 font-mono text-3xl">
                <stat.icon className="size-5 text-primary" />
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Upcoming premium tips</CardTitle>
          <CardDescription>Credits are deducted only when the user unlocks a premium tip.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fixture</TableHead>
                <TableHead>Prediction</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {premiumTips.map((tip) => (
                <TableRow key={tip.fixture}>
                  <TableCell>{tip.fixture}</TableCell>
                  <TableCell>{tip.prediction}</TableCell>
                  <TableCell>{tip.confidence}/10</TableCell>
                  <TableCell>
                    <Badge>
                      <CreditCard className="size-3" />
                      {tip.credits}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
