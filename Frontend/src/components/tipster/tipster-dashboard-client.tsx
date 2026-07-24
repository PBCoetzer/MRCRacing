"use client";

import { BadgeCheck, LineChart, Trophy, Users } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { premiumTips, tipsters } from "@/lib/mock-data";

export function TipsterDashboardClient() {
  const primaryTipster = tipsters[0];

  return (
    <RoleGate
      allowedRoles={["tipster", "administrator"]}
      description="the tipster dashboard"
      title="Tipster access check"
    >
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "ROI", value: primaryTipster.roi, icon: LineChart },
          { label: "Win rate", value: primaryTipster.winRate, icon: Trophy },
          { label: "Followers", value: primaryTipster.followers, icon: Users },
          { label: "Status", value: primaryTipster.badge, icon: BadgeCheck },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="space-y-0">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="flex items-center gap-2 font-mono text-2xl">
                <stat.icon className="size-5 text-primary" />
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {premiumTips.map((tip) => (
          <Card key={tip.fixture}>
            <CardHeader>
              <CardTitle className="text-lg">{tip.fixture}</CardTitle>
              <CardDescription>{tip.prediction}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <Badge variant="outline">{tip.status}</Badge>
              <span className="font-mono text-sm">{tip.confidence}/10 confidence</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </RoleGate>
  );
}
