"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCredits, formatRaceDateTime } from "@/lib/racing/format";

export type PurchaseConfirmation =
  | {
      kind: "meeting";
      id: string;
      title: string;
      seller: string;
      credits: number;
      alreadyOwned: boolean;
    }
  | {
      kind: "subscription";
      id: string;
      title: string;
      seller: string;
      credits: number;
      durationMonths: number;
      activeUntil: string | null;
    };

type PurchaseConfirmationDialogProps = {
  request: PurchaseConfirmation | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function PurchaseConfirmationDialog({
  request,
  busy,
  onOpenChange,
  onConfirm,
}: PurchaseConfirmationDialogProps) {
  const duplicateMeeting = request?.kind === "meeting" && request.alreadyOwned;
  const extendingSubscription =
    request?.kind === "subscription" && Boolean(request.activeUntil);

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {duplicateMeeting
              ? "Meeting card already owned"
              : extendingSubscription
                ? "Extend your active subscription?"
                : request?.kind === "subscription"
                  ? "Confirm subscription purchase"
                  : "Confirm meeting-card purchase"}
          </DialogTitle>
          <DialogDescription>
            {duplicateMeeting
              ? "You already have access to this meeting card and cannot purchase the same card from this tipster twice."
              : extendingSubscription
                ? "This subscription will be added after your current access period. It will not renew automatically."
                : "Review the purchase below. Credits are deducted only after you confirm."}
          </DialogDescription>
        </DialogHeader>

        {request ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-background/50 p-4">
              <p className="font-heading text-lg text-white">{request.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">By {request.seller}</p>
              {!duplicateMeeting ? (
                <p className="mt-4 font-mono text-xl font-semibold text-brand-gold">
                  {formatCredits(request.credits)}
                </p>
              ) : null}
            </div>

            {request.kind === "subscription" && request.activeUntil ? (
              <div className="rounded-lg border border-brand-cyan/35 bg-brand-cyan/5 p-4 text-sm">
                <p>
                  Your current subscription is active until{" "}
                  <strong>{formatRaceDateTime(request.activeUntil)}</strong>.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Confirming adds {request.durationMonths} more month
                  {request.durationMonths === 1 ? "" : "s"} from that expiry date.
                </p>
              </div>
            ) : null}

            {duplicateMeeting ? (
              <div className="flex gap-3 rounded-lg border border-brand-gold/35 bg-brand-gold/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-gold" />
                <p>Open the card from My Meeting Cards &amp; History in your client dashboard.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {duplicateMeeting ? "Close" : "Cancel"}
          </Button>
          {!duplicateMeeting && request ? (
            <Button type="button" disabled={busy} onClick={onConfirm}>
              <ShieldCheck className="size-4" />
              {busy ? "Processing…" : `Confirm and pay ${formatCredits(request.credits)}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
