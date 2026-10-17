"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Coins,
  CreditCard,
  Eye,
  Heart,
  History,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  TicketCheck,
  Trophy,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ProfileSettingsClient } from "@/components/account/profile-settings-client";
import { MfaProfileCard } from "@/components/auth/mfa-profile-card";
import { MfaSettingsClient } from "@/components/auth/mfa-settings-client";
import { TipsterApplicationClient } from "@/components/tipster/tipster-application-client";
import { TipsterBlogClient } from "@/components/tipster/tipster-blog-client";
import { dashboardViewChangeEvent } from "@/lib/dashboard-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PurchaseConfirmationDialog,
  type PurchaseConfirmation,
} from "@/components/purchases/purchase-confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatCredits, formatMeetingCardPrice, formatRaceDateTime } from "@/lib/racing/format";
import { meetingCardSalesOpen } from "@/lib/racing/availability";
import { raceSelectionLabel } from "@/lib/racing/selection-display";
import {
  entitlementIsActive,
  subscriptionDaysRemaining,
} from "@/lib/racing/subscription-access";
import {
  tipsterThemeAccentStyle,
  tipsterThemeButtonStyle,
  tipsterThemeCardStyle,
  tipsterThemePanelStyle,
} from "@/lib/racing/tipster-theme";
import type {
  ClientTipsterFavourite,
  MeetingBetOption,
  RaceEntry,
  RaceFixture,
  RaceMeeting,
  RaceTipSelection,
  TipCard,
  TipCardMultiple,
  TipCardMultipleSelection,
  TipsterPackage,
  TipsterPerformanceStats,
  TipsterProfile,
} from "@/lib/racing/types";

type PurchaseRow = {
  id: string;
  purchase_type: "meeting" | "subscription";
  tip_card_id: string | null;
  tipster_package_id: string | null;
  gross_coins: number;
  status: "active" | "refunded" | "disputed";
  created_at: string;
};

type SubscriptionRow = {
  id: string;
  tipster_id: string;
  package_id: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "expired" | "refunded";
};

type SubscriptionSummary = SubscriptionRow & {
  segment_count: number;
};

type EntitlementRow = {
  id: string;
  tip_card_id: string;
  source_type: "meeting" | "subscription";
  source_subscription_id: string | null;
  revoked_at: string | null;
};

type DisputeRow = {
  id: string;
  purchase_id: string;
  status: "open" | "approved" | "rejected";
  reason: string;
  created_at: string;
};

type WalletRow = {
  balance: number;
  purchased_balance: number;
  reward_balance: number;
};

type ProfileNotificationRow = {
  display_name: string | null;
  phone: string | null;
  sms_notifications_enabled: boolean;
  email_marketing_consented_at: string | null;
  email_marketing_withdrawn_at: string | null;
};

type PremiumTermsStatus = {
  currentVersion: string;
  hasAcceptedCurrent: boolean;
  acceptedAt: string | null;
  acceptedVia: string | null;
};

type CardAccessLicense = {
  accessCode: string;
  displayName: string;
  accessedAt: string;
  termsVersion: string;
};

type CardOutcome = {
  tip_card_id: string;
  fixture_id: string;
  selected_winner_position: number | null;
  winner_hit: boolean | null;
  selected_place_position: number | null;
  result_summary: string | null;
  evidence_hash: string;
  settled_at: string;
};

type ClientWorkspaceView =
  | "overview"
  | "subscriptions"
  | "meeting-cards"
  | "discover-tipsters"
  | "marketplace"
  | "purchases"
  | "write-for-mrc"
  | "profile"
  | "become-tipster";

const clientWorkspaceViews = new Set<ClientWorkspaceView>([
  "overview",
  "subscriptions",
  "meeting-cards",
  "discover-tipsters",
  "marketplace",
  "purchases",
  "write-for-mrc",
  "profile",
  "become-tipster",
]);

function clientWorkspaceViewFromLocation(): ClientWorkspaceView {
  if (typeof window === "undefined") {
    return "overview";
  }

  if (new URLSearchParams(window.location.search).has("card")) {
    return "meeting-cards";
  }

  const hash = window.location.hash.replace(/^#/, "");
  const aliases: Record<string, ClientWorkspaceView> = {
    "unlocked-tips": "meeting-cards",
    "author-tools": "write-for-mrc",
    "security": "profile",
  };
  const candidate = aliases[hash] ?? hash;

  return clientWorkspaceViews.has(candidate as ClientWorkspaceView)
    ? candidate as ClientWorkspaceView
    : "overview";
}

function clientWorkspaceViewFromEvent(event: Event): ClientWorkspaceView | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
    return null;
  }

  return clientWorkspaceViews.has(event.detail as ClientWorkspaceView)
    ? event.detail as ClientWorkspaceView
    : null;
}

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

function raceMeetingHref(meeting: RaceMeeting) {
  const venueSlug = meeting.venue_slug?.trim() || meeting.venue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `/horse-racing/meeting/?venue=${encodeURIComponent(venueSlug)}&date=${encodeURIComponent(meeting.meeting_date)}`;
}

export function ClientDashboardClient() {
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [phone, setPhone] = useState("");
  const [smsNotificationsEnabled, setSmsNotificationsEnabled] = useState(false);
  const [emailMarketingEnabled, setEmailMarketingEnabled] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState("");
  const [requestedCardId, setRequestedCardId] = useState("");
  const [pendingCardId, setPendingCardId] = useState("");
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [termsDialogError, setTermsDialogError] = useState("");
  const [pendingPurchase, setPendingPurchase] = useState<PurchaseConfirmation | null>(null);
  const [hasAcceptedCurrentTerms, setHasAcceptedCurrentTerms] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState("MRC Client");
  const [cardAccessLicenses, setCardAccessLicenses] = useState<Record<string, CardAccessLicense>>({});
  const [cards, setCards] = useState<TipCard[]>([]);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);
  const [tipsters, setTipsters] = useState<TipsterProfile[]>([]);
  const [packages, setPackages] = useState<TipsterPackage[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [fixtures, setFixtures] = useState<RaceFixture[]>([]);
  const [entries, setEntries] = useState<RaceEntry[]>([]);
  const [raceSelections, setRaceSelections] = useState<RaceTipSelection[]>([]);
  const [multiples, setMultiples] = useState<TipCardMultiple[]>([]);
  const [multipleSelections, setMultipleSelections] = useState<TipCardMultipleSelection[]>([]);
  const [betOptions, setBetOptions] = useState<MeetingBetOption[]>([]);
  const [performanceStats, setPerformanceStats] = useState<TipsterPerformanceStats[]>([]);
  const [favourites, setFavourites] = useState<ClientTipsterFavourite[]>([]);
  const [cardOutcomes, setCardOutcomes] = useState<CardOutcome[]>([]);
  const [userId, setUserId] = useState("");
  const [disputeReasons, setDisputeReasons] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<ClientWorkspaceView>("overview");

  useEffect(() => {
    const syncView = () => setActiveView(clientWorkspaceViewFromLocation());
    const syncDashboardView = (event: Event) => {
      const requestedView = clientWorkspaceViewFromEvent(event);
      if (requestedView) {
        setActiveView(requestedView);
      }
    };

    syncView();
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    window.addEventListener(dashboardViewChangeEvent, syncDashboardView);

    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
      window.removeEventListener(dashboardViewChangeEvent, syncDashboardView);
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(userError?.message ?? "Please sign in again.");
      }

      const [
        walletResult,
        profileResult,
        cardResult,
        meetingResult,
        tipsterResult,
        packageResult,
        purchaseResult,
        subscriptionResult,
        entitlementResult,
        disputeResult,
        performanceResult,
        favouriteResult,
        termsStatusResult,
      ] = await Promise.all([
        supabase
          .from("wallets")
          .select("balance,purchased_balance,reward_balance")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name,phone,sms_notifications_enabled,email_marketing_consented_at,email_marketing_withdrawn_at")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("tip_cards")
          .select("id,tipster_id,meeting_id,title,summary,coin_price,status,revision,confirmed_revision_count,listed_at,published_at,voided_at,updated_at")
          .in("status", ["coming_soon", "published", "settled"])
          .order("updated_at", { ascending: false }),
        supabase
          .from("race_meetings")
          .select("id,venue,venue_slug,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url")
          .order("first_race_at"),
        supabase
          .from("tipsters")
          .select("id,slug,user_id,display_name,biography,is_verified,is_public,commission_rate_override,theme_primary_color,theme_secondary_color,theme_surface_color")
          .eq("is_verified", true)
          .eq("is_public", true),
        supabase
          .from("tipster_packages")
          .select("id,tipster_id,name,duration_months,coin_price,is_active,created_at")
          .eq("is_active", true)
          .order("duration_months"),
        supabase
          .from("content_purchases")
          .select("id,purchase_type,tip_card_id,tipster_package_id,gross_coins,status,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tipster_subscriptions")
          .select("id,tipster_id,package_id,starts_at,ends_at,status")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tip_card_entitlements")
          .select("id,tip_card_id,source_type,source_subscription_id,revoked_at")
          .eq("user_id", user.id)
          .is("revoked_at", null),
        supabase
          .from("purchase_disputes")
          .select("id,purchase_id,status,reason,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tipster_performance_stats")
          .select(
            "tipster_id,published_winner_tips,settled_winner_tips,winner_hits,winner_strike_rate,published_place_tips,settled_place_tips,place_hits,place_strike_rate,roi_percent,updated_at",
          ),
        supabase
          .from("client_tipster_favourites")
          .select("user_id,tipster_id,created_at")
          .eq("user_id", user.id),
        supabase.rpc("get_premium_terms_status"),
      ]);

      const firstError =
        walletResult.error ??
        profileResult.error ??
        cardResult.error ??
        meetingResult.error ??
        tipsterResult.error ??
        packageResult.error ??
        purchaseResult.error ??
        subscriptionResult.error ??
        entitlementResult.error ??
        disputeResult.error ??
        performanceResult.error ??
        favouriteResult.error ??
        termsStatusResult.error;

      if (firstError) {
        throw firstError;
      }

      const loadedCards = (cardResult.data ?? []) as TipCard[];
      const loadedMeetings = (meetingResult.data ?? []) as RaceMeeting[];
      const dashboardLoadedAt = Date.now();
      const loadedSubscriptions = (subscriptionResult.data ?? []) as SubscriptionRow[];
      const subscriptionsById = new Map(
        loadedSubscriptions.map((subscription) => [subscription.id, subscription]),
      );
      const loadedEntitlements = ((entitlementResult.data ?? []) as EntitlementRow[])
        .filter((entitlement) =>
          entitlementIsActive(entitlement, subscriptionsById, dashboardLoadedAt)
        );
      const accessibleCardIds = new Set([
        ...loadedEntitlements.map((item) => item.tip_card_id),
        ...loadedCards
          .filter((tipCard) => tipCard.coin_price === 0 && ["published", "settled"].includes(tipCard.status))
          .map((tipCard) => tipCard.id),
      ]);
      const accessibleCards = loadedCards.filter(
        (tipCard) => ["published", "settled"].includes(tipCard.status) && accessibleCardIds.has(tipCard.id),
      );
      const accessibleMeetingIds = [...new Set(accessibleCards.map((tipCard) => tipCard.meeting_id))];

      let loadedFixtures: RaceFixture[] = [];
      let loadedEntries: RaceEntry[] = [];
      let loadedRaceSelections: RaceTipSelection[] = [];
      let loadedMultiples: TipCardMultiple[] = [];
      let loadedMultipleSelections: TipCardMultipleSelection[] = [];
      let loadedOptions: MeetingBetOption[] = [];
      let loadedOutcomes: CardOutcome[] = [];

      if (accessibleMeetingIds.length) {
        const { data: fixtureData, error: fixtureError } = await supabase
          .from("fixtures")
          .select("id,meeting_id,race_number,title,venue,starts_at,distance_m,race_class,status,result_summary")
          .in("meeting_id", accessibleMeetingIds)
          .order("race_number");

        if (fixtureError) {
          throw fixtureError;
        }

        loadedFixtures = (fixtureData ?? []) as RaceFixture[];
      }

      if (accessibleCards.length) {
        const cardIds = accessibleCards.map((tipCard) => tipCard.id);
        const [raceResult, multipleResult, optionResult, outcomeResult] = await Promise.all([
          supabase
            .from("race_tip_selections")
            .select("id,tip_card_id,fixture_id,winner_entry_id,place_entry_id,winner_selection_snapshot,place_selection_snapshot,comments,selection_status")
            .in("tip_card_id", cardIds),
          supabase
            .from("tip_card_multiples")
            .select("id,tip_card_id,bet_option_id,custom_name,tip_text,comments")
            .in("tip_card_id", cardIds),
          supabase
            .from("meeting_bet_options")
            .select("id,meeting_id,bet_type,display_name,cutoff_at,leg_count,sort_order")
            .in("meeting_id", accessibleMeetingIds),
          supabase
            .from("tip_card_race_outcomes")
            .select("tip_card_id,fixture_id,selected_winner_position,winner_hit,selected_place_position,result_summary,evidence_hash,settled_at")
            .in("tip_card_id", cardIds),
        ]);

        if (raceResult.error || multipleResult.error || optionResult.error || outcomeResult.error) {
          throw raceResult.error ?? multipleResult.error ?? optionResult.error ?? outcomeResult.error;
        }

        loadedRaceSelections = (raceResult.data ?? []) as RaceTipSelection[];
        loadedMultiples = (multipleResult.data ?? []) as TipCardMultiple[];
        loadedOptions = (optionResult.data ?? []) as MeetingBetOption[];
        loadedOutcomes = (outcomeResult.data ?? []) as CardOutcome[];
      }

      if (loadedFixtures.length) {
        const { data: entryData, error: entryError } = await supabase
          .from("race_entries")
          .select("id,fixture_id,saddle_number,horse_name,jockey_name,trainer_name,draw,status,result_position")
          .in("fixture_id", loadedFixtures.map((fixture) => fixture.id))
          .order("saddle_number");

        if (entryError) {
          throw entryError;
        }

        loadedEntries = (entryData ?? []) as RaceEntry[];
      }

      if (loadedMultiples.length) {
        const { data: selectionData, error: selectionError } = await supabase
          .from("tip_card_multiple_selections")
          .select("multiple_id,leg_number,fixture_id,entry_id")
          .in("multiple_id", loadedMultiples.map((multiple) => multiple.id));

        if (selectionError) {
          throw selectionError;
        }

        loadedMultipleSelections = (selectionData ?? []) as TipCardMultipleSelection[];
      }

      const loadedWallet = walletResult.data as WalletRow | null;
      const loadedProfile = profileResult.data as ProfileNotificationRow | null;
      const loadedTermsStatus = termsStatusResult.data as PremiumTermsStatus | null;
      setWalletBalance(Number(loadedWallet?.balance ?? 0));
      setPhone(loadedProfile?.phone ?? "");
      setSmsNotificationsEnabled(Boolean(loadedProfile?.sms_notifications_enabled));
      setEmailMarketingEnabled(Boolean(
        loadedProfile?.email_marketing_consented_at &&
        (!loadedProfile.email_marketing_withdrawn_at ||
          new Date(loadedProfile.email_marketing_consented_at).getTime() >
            new Date(loadedProfile.email_marketing_withdrawn_at).getTime()),
      ));
      setHasAcceptedCurrentTerms(Boolean(loadedTermsStatus?.hasAcceptedCurrent));
      setProfileDisplayName(loadedProfile?.display_name?.trim() || "MRC Client");
      const cardFromUrl = new URLSearchParams(window.location.search).get("card");
      if (cardFromUrl && accessibleCardIds.has(cardFromUrl)) {
        setRequestedCardId(cardFromUrl);
      }
      setCards(loadedCards);
      setMeetings(loadedMeetings);
      setTipsters((tipsterResult.data ?? []) as TipsterProfile[]);
      setPackages((packageResult.data ?? []) as TipsterPackage[]);
      setPurchases((purchaseResult.data ?? []) as PurchaseRow[]);
      setSubscriptions(loadedSubscriptions);
      setEntitlements(loadedEntitlements);
      setDisputes((disputeResult.data ?? []) as DisputeRow[]);
      setFixtures(loadedFixtures);
      setEntries(loadedEntries);
      setRaceSelections(loadedRaceSelections);
      setMultiples(loadedMultiples);
      setMultipleSelections(loadedMultipleSelections);
      setBetOptions(loadedOptions);
      setPerformanceStats((performanceResult.data ?? []) as TipsterPerformanceStats[]);
      setFavourites((favouriteResult.data ?? []) as ClientTipsterFavourite[]);
      setCardOutcomes(loadedOutcomes);
      setUserId(user.id);
      setLoadedAt(dashboardLoadedAt);
    } catch (loadError) {
      setError(messageFrom(loadError, "Could not load the client marketplace."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDashboard]);

  useEffect(() => {
    const refreshVisibleDashboard = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard();
      }
    };

    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);

    return () => {
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
  }, [loadDashboard]);

  const meetingById = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting])),
    [meetings],
  );
  const tipsterById = useMemo(
    () => new Map(tipsters.map((tipster) => [tipster.id, tipster])),
    [tipsters],
  );
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const fixtureById = useMemo(
    () => new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    [fixtures],
  );
  const optionById = useMemo(
    () => new Map(betOptions.map((option) => [option.id, option])),
    [betOptions],
  );
  const packageById = useMemo(
    () => new Map(packages.map((tipsterPackage) => [tipsterPackage.id, tipsterPackage])),
    [packages],
  );
  const statsByTipster = useMemo(
    () => new Map(performanceStats.map((stats) => [stats.tipster_id, stats])),
    [performanceStats],
  );
  const favouriteIds = useMemo(
    () => new Set(favourites.map((favourite) => favourite.tipster_id)),
    [favourites],
  );
  const entitlementIds = useMemo(
    () => new Set(entitlements.map((item) => item.tip_card_id)),
    [entitlements],
  );
  const activeSubscriptionSummaries = useMemo(() => {
    const grouped = new Map<string, SubscriptionSummary>();

    subscriptions
      .filter(
        (subscription) =>
          subscription.status === "active" &&
          new Date(subscription.ends_at).getTime() > loadedAt,
      )
      .forEach((subscription) => {
        const current = grouped.get(subscription.tipster_id);

        if (!current) {
          grouped.set(subscription.tipster_id, {
            ...subscription,
            segment_count: 1,
          });
          return;
        }

        const subscriptionEndsLater =
          new Date(subscription.ends_at).getTime() > new Date(current.ends_at).getTime();

        grouped.set(subscription.tipster_id, {
          ...current,
          id: subscriptionEndsLater ? subscription.id : current.id,
          package_id: subscriptionEndsLater ? subscription.package_id : current.package_id,
          starts_at:
            new Date(subscription.starts_at).getTime() < new Date(current.starts_at).getTime()
              ? subscription.starts_at
              : current.starts_at,
          ends_at: subscriptionEndsLater ? subscription.ends_at : current.ends_at,
          segment_count: current.segment_count + 1,
        });
      });

    return [...grouped.values()].sort(
      (left, right) => new Date(right.ends_at).getTime() - new Date(left.ends_at).getTime(),
    );
  }, [loadedAt, subscriptions]);
  const activeSubscriptionTipsters = useMemo(
    () => new Set(activeSubscriptionSummaries.map((subscription) => subscription.tipster_id)),
    [activeSubscriptionSummaries],
  );

  async function purchaseMeeting(tipCard: TipCard) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessingId(tipCard.id);
    setError("");
    setMessage("");

    try {
      const { error: purchaseError } = await supabase.rpc("purchase_meeting_card", {
        p_tip_card_id: tipCard.id,
        p_idempotency_key: crypto.randomUUID(),
        p_purchase_confirmed: true,
      });

      if (purchaseError) {
        throw purchaseError;
      }

      setMessage(`The complete ${tipCard.title} card is now linked to your account.`);
      setPendingPurchase(null);
      await loadDashboard();
    } catch (purchaseError) {
      setError(messageFrom(purchaseError, "The meeting card could not be purchased."));
    } finally {
      setProcessingId("");
    }
  }

  async function toggleFavourite(tipsterId: string) {
    const supabase = createClient();

    if (!supabase || !userId) {
      return;
    }

    setProcessingId(`favourite:${tipsterId}`);
    setError("");
    setMessage("");
    const isFavourite = favouriteIds.has(tipsterId);

    try {
      const response = isFavourite
        ? await supabase
            .from("client_tipster_favourites")
            .delete()
            .eq("user_id", userId)
            .eq("tipster_id", tipsterId)
        : await supabase
            .from("client_tipster_favourites")
            .insert({ user_id: userId, tipster_id: tipsterId });

      if (response.error) {
        throw response.error;
      }

      await loadDashboard();
    } catch (favouriteError) {
      setError(messageFrom(favouriteError, "The favourite could not be updated."));
    } finally {
      setProcessingId("");
    }
  }

  async function submitDispute(purchaseId: string) {
    const supabase = createClient();
    const reason = disputeReasons[purchaseId]?.trim() ?? "";

    if (!supabase) {
      return;
    }

    if (reason.length < 10) {
      setError("Please explain the dispute in at least ten characters.");
      return;
    }

    setProcessingId(purchaseId);
    setError("");
    setMessage("");

    try {
      const { error: disputeError } = await supabase.rpc("request_purchase_dispute", {
        p_purchase_id: purchaseId,
        p_reason: reason,
      });

      if (disputeError) {
        throw disputeError;
      }

      setDisputeReasons((current) => ({ ...current, [purchaseId]: "" }));
      setMessage("Your refund request was submitted for administrator review. No Credits will be returned unless an administrator approves it.");
      await loadDashboard();
    } catch (disputeError) {
      setError(messageFrom(disputeError, "The dispute could not be submitted."));
    } finally {
      setProcessingId("");
    }
  }

  async function toggleSmsNotifications() {
    const supabase = createClient();
    if (!supabase || !userId) return;
    if (!smsNotificationsEnabled && !phone.trim()) {
      setError("Add a South African cell number to your account before enabling SMS alerts.");
      return;
    }

    const nextEnabled = !smsNotificationsEnabled;
    setProcessingId("sms-preferences");
    setError("");
    setMessage("");
    try {
      const { error: preferenceError } = await supabase
        .from("profiles")
        .update({
          sms_notifications_enabled: nextEnabled,
          sms_notifications_consented_at: nextEnabled ? new Date().toISOString() : null,
        })
        .eq("id", userId);
      if (preferenceError) throw preferenceError;
      setSmsNotificationsEnabled(nextEnabled);
      setMessage(nextEnabled
        ? "SMS meeting-card alerts are enabled. Standard network rates may apply."
        : "SMS meeting-card alerts are disabled.");
    } catch (preferenceError) {
      setError(messageFrom(preferenceError, "SMS preferences could not be updated."));
    } finally {
      setProcessingId("");
    }
  }

  async function toggleEmailMarketing() {
    const supabase = createClient();
    if (!supabase || !userId) return;

    const nextEnabled = !emailMarketingEnabled;
    setProcessingId("email-marketing-preferences");
    setError("");
    setMessage("");
    try {
      const { error: preferenceError } = await supabase.rpc("set_email_marketing_consent", {
        p_enabled: nextEnabled,
      });
      if (preferenceError) throw preferenceError;
      setEmailMarketingEnabled(nextEnabled);
      setMessage(nextEnabled
        ? "New-content email announcements are enabled."
        : "New-content email announcements are disabled.");
    } catch (preferenceError) {
      setError(messageFrom(preferenceError, "Email announcement preferences could not be updated."));
    } finally {
      setProcessingId("");
    }
  }

  const openPremiumCard = useCallback(async (
    tipCardId: string,
    acceptCurrentTerms = false,
  ) => {
    if (expandedCardId === tipCardId && !acceptCurrentTerms) {
      setExpandedCardId("");
      return;
    }

    if (!hasAcceptedCurrentTerms && !acceptCurrentTerms) {
      setPendingCardId(tipCardId);
      setTermsConfirmed(false);
      setTermsDialogError("");
      setTermsDialogOpen(true);
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError("The secure meeting-card service is not configured.");
      return;
    }

    setProcessingId(`access:${tipCardId}`);
    setError("");
    setMessage("");

    try {
      const clientContext = {
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      if (acceptCurrentTerms) {
        const { data: termsStatus, error: termsError } = await supabase.rpc(
          "accept_current_premium_terms",
          { p_client_context: clientContext },
        );

        if (termsError) {
          throw termsError;
        }

        if (!(termsStatus as PremiumTermsStatus | null)?.hasAcceptedCurrent) {
          throw new Error("The current terms acceptance could not be saved.");
        }

        setHasAcceptedCurrentTerms(true);
      }

      const { data, error: accessError } = await supabase.rpc(
        "record_tip_card_access",
        {
          p_tip_card_id: tipCardId,
          p_terms_version: null,
          p_client_context: clientContext,
        },
      );

      if (accessError) {
        throw accessError;
      }

      const licence = data as CardAccessLicense | null;
      if (!licence?.accessCode) {
        throw new Error("The secure card access code could not be created.");
      }

      setCardAccessLicenses((current) => ({
        ...current,
        [tipCardId]: {
          ...licence,
          displayName: licence.displayName || profileDisplayName,
        },
      }));
      setHasAcceptedCurrentTerms(true);
      setExpandedCardId(tipCardId);
      setTermsDialogOpen(false);
      setPendingCardId("");
      setTermsConfirmed(false);
      setTermsDialogError("");
    } catch (accessError) {
      const accessMessage = messageFrom(
        accessError,
        "The meeting card could not be opened securely.",
      );
      if (acceptCurrentTerms) {
        setTermsDialogError(accessMessage);
      } else if (accessMessage.toLowerCase().includes("accept the current terms")) {
        setHasAcceptedCurrentTerms(false);
        setPendingCardId(tipCardId);
        setTermsConfirmed(false);
        setTermsDialogError("");
        setTermsDialogOpen(true);
      } else {
        setError(accessMessage);
      }
    } finally {
      setProcessingId("");
    }
  }, [expandedCardId, hasAcceptedCurrentTerms, profileDisplayName]);

  useEffect(() => {
    if (loading || !requestedCardId) {
      return;
    }

    const cardId = requestedCardId;
    const timeoutId = window.setTimeout(() => {
      setRequestedCardId("");
      void openPremiumCard(cardId);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loading, openPremiumCard, requestedCardId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-52 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          Loading wallet, cards, and subscriptions…
        </CardContent>
      </Card>
    );
  }

  const accessibleCards = cards.filter(
    (tipCard) =>
      ["published", "settled"].includes(tipCard.status) &&
      (tipCard.coin_price === 0 || entitlementIds.has(tipCard.id)),
  );
  const marketplaceCards = cards.filter((tipCard) => {
    const meeting = meetingById.get(tipCard.meeting_id);
    return tipCard.status === "published" &&
      meetingCardSalesOpen(meeting, loadedAt);
  });
  const upcomingMeetings = meetings
    .filter((meeting) => meeting.status === "scheduled" && new Date(meeting.first_race_at).getTime() >= loadedAt)
    .sort((left, right) => new Date(left.first_race_at).getTime() - new Date(right.first_race_at).getTime());
  const recentCompletedMeetings = meetings
    .filter((meeting) => meeting.status === "completed")
    .sort((left, right) => new Date(right.first_race_at).getTime() - new Date(left.first_race_at).getTime())
    .slice(0, 3);
  const upcomingCardCandidates = cards
    .filter((tipCard) => ["coming_soon", "published"].includes(tipCard.status))
    .map((tipCard) => ({ tipCard, meeting: meetingById.get(tipCard.meeting_id) }))
    .filter((item): item is { tipCard: TipCard; meeting: RaceMeeting } => (
      item.meeting !== undefined && new Date(item.meeting.first_race_at).getTime() >= loadedAt
    ))
    .sort((left, right) => (
      new Date(left.meeting.first_race_at).getTime() - new Date(right.meeting.first_race_at).getTime()
    ));
  const featuredUpcomingCard = upcomingCardCandidates[0];

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Client action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Access updated</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Credit balance", value: walletBalance, icon: Coins },
          { label: "Meeting access", value: accessibleCards.length, icon: TicketCheck },
          { label: "Active subscriptions", value: activeSubscriptionTipsters.size, icon: ShieldCheck },
          { label: "Open disputes", value: disputes.filter((item) => item.status === "open").length, icon: Bell },
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

      <MfaProfileCard href="/client/#profile" presentation="requirements" />

      <div className={activeView === "overview" ? "space-y-4" : "hidden"}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TicketCheck className="size-5 text-primary" />
                  Upcoming meeting card
                </CardTitle>
                <CardDescription className="mt-1">
                  The next card currently prepared or published by an MRC Tipster.
                </CardDescription>
              </div>
              {featuredUpcomingCard ? (
                <Badge variant={featuredUpcomingCard.tipCard.status === "published" ? "default" : "outline"}>
                  {featuredUpcomingCard.tipCard.status === "published" ? "Available now" : "Coming soon"}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {featuredUpcomingCard ? (
              <div className="rounded-lg border bg-background/40 p-4">
                <h3 className="font-heading text-2xl text-white">{featuredUpcomingCard.tipCard.title}</h3>
                <p className="mt-1 text-sm text-brand-cyan">
                  {tipsterById.get(featuredUpcomingCard.tipCard.tipster_id)?.display_name ?? "MRC Tipster"}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {featuredUpcomingCard.tipCard.summary || "Meeting analysis and selections are being prepared."}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{featuredUpcomingCard.meeting.venue}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatRaceDateTime(featuredUpcomingCard.meeting.first_race_at)} · {formatMeetingCardPrice(featuredUpcomingCard.tipCard.coin_price)}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <a href={featuredUpcomingCard.tipCard.status === "published" ? "#marketplace" : "#discover-tipsters"}>
                      {featuredUpcomingCard.tipCard.status === "published" ? "View card options" : "View Tipsters"}
                      <ArrowRight className="size-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No new meeting card has been listed yet. This panel updates automatically when a Tipster prepares or publishes one.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-5 text-primary" />
                Upcoming racing
              </CardTitle>
              <CardDescription>Next scheduled South African meetings from the race feed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingMeetings.slice(0, 3).map((meeting) => (
                <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/40 p-4">
                  <div>
                    <p className="font-semibold text-white">{meeting.venue}</p>
                    <p className="text-sm text-muted-foreground">{formatRaceDateTime(meeting.first_race_at)}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={raceMeetingHref(meeting)}>Racecard</Link>
                  </Button>
                </div>
              ))}
              {!upcomingMeetings.length ? (
                <p className="text-sm text-muted-foreground">No future race meetings are currently listed.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-5 text-primary" />
                Recent race results
              </CardTitle>
              <CardDescription>Recently completed meetings with racecards and official results.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentCompletedMeetings.map((meeting) => (
                <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/40 p-4">
                  <div>
                    <p className="font-semibold text-white">{meeting.venue}</p>
                    <p className="text-sm text-muted-foreground">{formatRaceDateTime(meeting.first_race_at)}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={raceMeetingHref(meeting)}>View results</Link>
                  </Button>
                </div>
              ))}
              {!recentCompletedMeetings.length ? (
                <p className="text-sm text-muted-foreground">Completed race results will appear here.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card id="subscriptions" className={activeView === "subscriptions" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>My Subscribed Tipsters</CardTitle>
          <CardDescription>
            One active relationship is shown per tipster. Subscription extensions are included in the final expiry date.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {activeSubscriptionSummaries.map((subscription) => {
              const tipster = tipsterById.get(subscription.tipster_id);
              const tipsterPackage = packageById.get(subscription.package_id);
              const daysRemaining = subscriptionDaysRemaining(subscription.ends_at, loadedAt);

              return (
                <div key={subscription.id} className="rounded-lg border bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge>Active</Badge>
                        {subscription.segment_count > 1 ? (
                          <Badge variant="outline">Extended</Badge>
                        ) : null}
                        {daysRemaining <= 7 ? (
                          <Badge variant="destructive">
                            Ends in {daysRemaining} {daysRemaining === 1 ? "day" : "days"}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-3 font-heading text-xl text-white">
                        {tipster?.display_name ?? "Verified tipster"}
                      </h3>
                      <p className="mt-1 text-sm text-brand-cyan">
                        {tipsterPackage?.name ??
                          `${tipsterPackage?.duration_months ?? ""}-month package`}
                      </p>
                    </div>
                    <ShieldCheck className="size-5 text-brand-cyan" />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Started</dt>
                      <dd>{formatRaceDateTime(subscription.starts_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Expires</dt>
                      <dd>{formatRaceDateTime(subscription.ends_at)}</dd>
                    </div>
                  </dl>
                  <Button asChild className="mt-4" variant="outline">
                    <Link href={`/tipsters/profile/?tipster=${subscription.tipster_id}`}>
                      View tipster profile
                    </Link>
                  </Button>
                </div>
              );
            })}
          {!activeSubscriptionSummaries.length ? (
            <p className="text-sm text-muted-foreground">
              You do not have an active tipster subscription. Browse profiles to compare
              each tipster&apos;s own packages.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div id="meeting-cards" className={activeView === "meeting-cards" ? "scroll-mt-24 space-y-4" : "hidden"}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl text-white">My Meeting Cards &amp; History</h2>
            <p className="text-sm text-muted-foreground">
              Premium selections are returned by Supabase only when your entitlement is active.
            </p>
          </div>
          <Badge variant="outline" className="px-3 py-1 text-sm">
            {accessibleCards.length} {accessibleCards.length === 1 ? "card" : "cards"} available
          </Badge>
        </div>
        {accessibleCards.map((tipCard) => {
          const meeting = meetingById.get(tipCard.meeting_id);
          const cardFixtures = fixtures.filter((fixture) => fixture.meeting_id === tipCard.meeting_id);
          const cardRaceSelections = raceSelections.filter((selection) => selection.tip_card_id === tipCard.id);
          const visibleCardFixtures = cardFixtures.filter((fixture) =>
            cardRaceSelections.find((selection) => selection.fixture_id === fixture.id)?.selection_status !== "skipped"
          );
          const cardMultiples = multiples.filter((multiple) => multiple.tip_card_id === tipCard.id);
          const cardTipster = tipsterById.get(tipCard.tipster_id);
          const isExpanded = expandedCardId === tipCard.id;
          const accessLicence = cardAccessLicenses[tipCard.id];
          const isOpening = processingId === `access:${tipCard.id}`;

          return (
            <Card key={tipCard.id} style={tipsterThemePanelStyle(cardTipster)}>
              <button
                type="button"
                className="w-full rounded-t-xl text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={isExpanded}
                aria-controls={`meeting-card-${tipCard.id}`}
                disabled={isOpening}
                onClick={() => void openPremiumCard(tipCard.id)}
              >
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge style={tipsterThemeButtonStyle(cardTipster)}>
                        {tipCard.status === "settled" ? "Settled history" : "Published"}
                      </Badge>
                      <Badge variant="outline">Revision {tipCard.confirmed_revision_count}</Badge>
                    </div>
                    <CardTitle className="mt-3 font-heading text-2xl text-white">{tipCard.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {meeting ? `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}` : ""}
                      {` · ${visibleCardFixtures.length} tipped races`}
                    </CardDescription>
                  </div>
                  <span
                    className="flex shrink-0 items-center gap-2 text-sm"
                    style={tipsterThemeAccentStyle(cardTipster)}
                  >
                    {isOpening ? (
                      <><Loader2 className="size-5 animate-spin" />Securing card</>
                    ) : isExpanded ? (
                      <>Hide full card<ChevronDown className="size-5" /></>
                    ) : (
                      <>View full card<ChevronRight className="size-5" /></>
                    )}
                  </span>
                </CardHeader>
              </button>
              {isExpanded && accessLicence ? (
              <CardContent
                id={`meeting-card-${tipCard.id}`}
                className="relative space-y-6 overflow-hidden border-t pt-6 print:hidden"
                onCopy={(event) => event.preventDefault()}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-20 grid select-none grid-cols-2 content-around gap-x-5 gap-y-10 overflow-hidden p-2 opacity-[0.13] sm:grid-cols-3"
                >
                  {Array.from({ length: 36 }, (_, index) => (
                    <p
                      key={index}
                      className="-rotate-12 whitespace-nowrap text-center font-mono text-[0.82rem] font-black text-white sm:text-sm"
                    >
                      {accessLicence.displayName} · {accessLicence.accessCode}
                    </p>
                  ))}
                </div>
                <Alert className="relative z-30" style={tipsterThemeCardStyle(cardTipster)}>
                  <ShieldCheck className="size-4" />
                  <AlertTitle>Personal licensed access</AlertTitle>
                  <AlertDescription>
                    This card is licensed to {accessLicence.displayName}. Visible code{" "}
                    <span className="font-mono font-semibold">{accessLicence.accessCode}</span>. Sharing,
                    republishing, or reselling premium selections is prohibited by the accepted terms.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-3 lg:grid-cols-2">
                  {visibleCardFixtures.map((fixture) => {
                    const selection = cardRaceSelections.find((item) => item.fixture_id === fixture.id);
                    const winnerLabel = raceSelectionLabel(
                      selection?.winner_entry_id ?? null,
                      entryById,
                      selection?.winner_selection_snapshot ?? null,
                    );
                    const placeLabel = raceSelectionLabel(
                      selection?.place_entry_id ?? null,
                      entryById,
                      selection?.place_selection_snapshot ?? null,
                    );
                    const outcome = cardOutcomes.find((item) => item.tip_card_id === tipCard.id && item.fixture_id === fixture.id);

                    return (
                      <div
                        key={fixture.id}
                        className="relative z-10 rounded-lg border p-4"
                        style={tipsterThemeCardStyle(cardTipster)}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">Race {fixture.race_number}: {fixture.title}</p>
                            <p className="text-xs text-muted-foreground">{formatRaceDateTime(fixture.starts_at)}</p>
                          </div>
                        </div>
                        <dl className="mt-3 grid gap-2 text-sm">
                          <div><dt className="text-muted-foreground">Winner</dt><dd>{winnerLabel}</dd></div>
                          <div><dt className="text-muted-foreground">Place Selection</dt><dd>{placeLabel}</dd></div>
                          <div><dt className="text-muted-foreground">Comments</dt><dd>{selection?.comments || "No comments"}</dd></div>
                          {outcome ? <><div><dt className="text-muted-foreground">Winner outcome</dt><dd>{outcome.selected_winner_position == null ? "No winner selection graded" : outcome.winner_hit ? `Correct — finished 1st` : `Missed — finished ${outcome.selected_winner_position}`}</dd></div><div><dt className="text-muted-foreground">Place Selection finish</dt><dd>{outcome.selected_place_position ?? "No official finishing position"}</dd></div><div><dt className="text-muted-foreground">Official result</dt><dd>{outcome.result_summary ?? fixture.result_summary ?? "Recorded"}</dd></div></> : null}
                        </dl>
                      </div>
                    );
                  })}
                </div>
                {cardMultiples.length ? (
                  <div className="relative z-10">
                    <h3 className="font-heading text-xl text-white">Exotic&apos;s and Multiples</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {cardMultiples.map((multiple) => {
                        const option = optionById.get(multiple.bet_option_id);
                        const selections = multipleSelections.filter(
                          (item) => item.multiple_id === multiple.id,
                        );
                        const grouped = new Map<number, TipCardMultipleSelection[]>();

                        for (const selection of selections) {
                          grouped.set(selection.leg_number, [
                            ...(grouped.get(selection.leg_number) ?? []),
                            selection,
                          ]);
                        }

                        return (
                          <div
                            key={multiple.id}
                            className="rounded-lg border p-4"
                            style={tipsterThemeCardStyle(cardTipster)}
                          >
                            <p className="font-semibold">
                              {multiple.custom_name || option?.display_name || "Meeting option"}
                            </p>
                            {multiple.tip_text ? (
                              <p className="mt-3 whitespace-pre-wrap text-sm">{multiple.tip_text}</p>
                            ) : (
                              <div className="mt-3 space-y-2 text-sm">
                                {[...grouped.entries()]
                                  .sort(([left], [right]) => left - right)
                                  .map(([legNumber, legSelections]) => {
                                    const fixture = fixtureById.get(
                                      legSelections[0]?.fixture_id ?? "",
                                    );
                                    return (
                                      <p key={legNumber}>
                                        <span className="text-muted-foreground">
                                          Leg {legNumber}
                                          {fixture ? ` / Race ${fixture.race_number}` : ""}:{" "}
                                        </span>
                                        {legSelections
                                          .map((item) => entryById.get(item.entry_id))
                                          .filter(Boolean)
                                          .map((entry) => `${entry?.saddle_number}. ${entry?.horse_name}`)
                                          .join(", ")}
                                      </p>
                                    );
                                  })}
                              </div>
                            )}
                            {multiple.comments ? (
                              <p className="mt-3 text-sm text-muted-foreground">
                                {multiple.comments}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CardContent>
              ) : null}
            </Card>
          );
        })}
        {!accessibleCards.length ? (
          <Alert>
            <History className="size-4" />
            <AlertTitle>No published card access yet</AlertTitle>
            <AlertDescription>
              Buy a published meeting card or subscribe to a tipster. Subscriptions include every qualifying card published during the active period.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card id="discover-tipsters" className={activeView === "discover-tipsters" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>Discover Tipsters</CardTitle>
          <CardDescription>
            Favourites appear first, followed by verified winner and place performance. Visit a
            profile to see only that tipster&apos;s subscriptions and meeting cards.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...tipsters]
            .sort((left, right) => {
              const favouriteDifference =
                Number(favouriteIds.has(right.id)) -
                Number(favouriteIds.has(left.id));

              if (favouriteDifference) {
                return favouriteDifference;
              }

              return (
                Number(statsByTipster.get(right.id)?.winner_strike_rate ?? 0) -
                Number(statsByTipster.get(left.id)?.winner_strike_rate ?? 0)
              );
            })
            .map((tipster) => {
              const stats = statsByTipster.get(tipster.id);
              const isFavourite = favouriteIds.has(tipster.id);

              return (
                <div
                  key={tipster.id}
                  className="rounded-lg border p-4"
                  style={tipsterThemePanelStyle(tipster)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge
                        variant={isFavourite ? "default" : "outline"}
                        style={tipsterThemeButtonStyle(tipster)}
                      >
                        {isFavourite ? "Favourite" : "Verified"}
                      </Badge>
                      <h3 className="mt-3 font-heading text-xl text-white">
                        {tipster.display_name}
                      </h3>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant={isFavourite ? "default" : "outline"}
                      style={isFavourite ? tipsterThemeButtonStyle(tipster) : undefined}
                      disabled={processingId === `favourite:${tipster.id}`}
                      onClick={() => void toggleFavourite(tipster.id)}
                      aria-label={isFavourite ? "Remove favourite" : "Add favourite"}
                    >
                      {processingId === `favourite:${tipster.id}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Heart className={isFavourite ? "size-4 fill-current" : "size-4"} />
                      )}
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Winner strike rate</p>
                      <p className="font-mono text-lg font-semibold">
                        {stats?.winner_strike_rate === null ||
                        stats?.winner_strike_rate === undefined
                          ? "—"
                          : `${Number(stats.winner_strike_rate).toFixed(1)}%`}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Place strike rate</p>
                      <p className="font-mono text-lg font-semibold">
                        {stats?.place_strike_rate === null ||
                        stats?.place_strike_rate === undefined
                          ? "—"
                          : `${Number(stats.place_strike_rate).toFixed(1)}%`}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Settled winner tips</p>
                      <p className="font-mono text-lg font-semibold">
                        {stats?.settled_winner_tips ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Settled place selections</p>
                      <p className="font-mono text-lg font-semibold">
                        {stats?.settled_place_tips ?? 0}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Place strike rate counts official top-three finishes across settled selections.
                  </p>
                  <Button asChild className="mt-4 w-full" variant="outline">
                    <Link href={`/tipsters/profile/?tipster=${tipster.id}`}>
                      View profile and packages
                    </Link>
                  </Button>
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Card id="marketplace" className={activeView === "marketplace" ? "scroll-mt-24" : "hidden"}>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Meeting Card Marketplace</CardTitle>
            <CardDescription>
              Published meeting cards may be free, included in a subscription, or available as a one-off purchase.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadDashboard()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {marketplaceCards.map((tipCard) => {
            const meeting = meetingById.get(tipCard.meeting_id);
            const tipster = tipsterById.get(tipCard.tipster_id);
            const isFree = tipCard.coin_price === 0;
            const coveredBySubscription = Boolean(
              meeting && subscriptions.some((subscription) =>
                subscription.tipster_id === tipCard.tipster_id &&
                subscription.status === "active" &&
                new Date(meeting.first_race_at).getTime() >= new Date(subscription.starts_at).getTime() &&
                new Date(meeting.first_race_at).getTime() < new Date(subscription.ends_at).getTime(),
              ),
            );
            const entitled = entitlementIds.has(tipCard.id) || coveredBySubscription;

            return (
              <div key={tipCard.id} className="rounded-lg border bg-background/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={tipCard.status === "published" ? "default" : "secondary"}>
                    {tipCard.status.replace("_", " ")}
                  </Badge>
                  {meeting?.is_test ? <Badge variant="outline">Private test</Badge> : null}
                  {isFree ? <Badge variant="outline">Free access</Badge> : null}
                  {coveredBySubscription ? <Badge variant="outline">Included in subscription</Badge> : null}
                  {!isFree && !coveredBySubscription && entitled ? <Badge variant="outline">Purchased</Badge> : null}
                </div>
                <h3 className="mt-3 font-heading text-xl text-white">{tipCard.title}</h3>
                <Link
                  href={`/tipsters/profile/?tipster=${tipCard.tipster_id}`}
                  className="mt-1 inline-block text-sm text-brand-cyan hover:underline"
                >
                  {tipster?.display_name ?? "Verified tipster"}
                </Link>
                <p className="mt-3 text-sm text-muted-foreground">
                  {tipCard.summary || "Premium meeting analysis."}
                </p>
                <p className="mt-3 text-sm">
                  {meeting
                    ? `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}`
                    : "Meeting details unavailable"}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono font-semibold">
                    {formatMeetingCardPrice(tipCard.coin_price)}
                  </span>
                  {isFree ? (
                    <Button
                      disabled={processingId === tipCard.id}
                      type="button"
                      onClick={() => void openPremiumCard(tipCard.id)}
                    >
                      {processingId === tipCard.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                      Open free card
                    </Button>
                  ) : entitled ? (
                    <Badge>
                      <Eye className="size-3" />
                      Access above
                    </Badge>
                  ) : (
                    <Button
                      disabled={processingId === tipCard.id}
                      type="button"
                      onClick={() =>
                        setPendingPurchase({
                          kind: "meeting",
                          id: tipCard.id,
                          title: tipCard.title,
                          seller: tipster?.display_name ?? "Verified tipster",
                          credits: tipCard.coin_price,
                          alreadyOwned: entitlementIds.has(tipCard.id),
                        })
                      }
                    >
                      {processingId === tipCard.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CreditCard className="size-4" />
                      )}
                      Unlock meeting
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!marketplaceCards.length ? (
            <p className="text-sm text-muted-foreground">
              No meeting cards are currently available.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card id="purchases" className={activeView === "purchases" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>Purchases and refund requests</CardTitle>
          <CardDescription>
            Meeting-card and subscription purchases remain active unless you request a refund review and an administrator approves it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dispute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => {
                const existingDispute = disputes.find((item) => item.purchase_id === purchase.id);

                return (
                  <TableRow key={purchase.id}>
                    <TableCell>{formatRaceDateTime(purchase.created_at)}</TableCell>
                    <TableCell>{purchase.purchase_type}</TableCell>
                    <TableCell>{formatCredits(purchase.gross_coins)}</TableCell>
                    <TableCell><Badge variant="outline">{purchase.status}</Badge></TableCell>
                    <TableCell>
                      {existingDispute ? (
                        <Badge variant={existingDispute.status === "rejected" ? "destructive" : "secondary"}>
                          {existingDispute.status}
                        </Badge>
                      ) : purchase.status === "active" ? (
                        <div className="flex min-w-64 gap-2">
                          <Input
                            placeholder="Reason for refund request"
                            value={disputeReasons[purchase.id] ?? ""}
                            onChange={(event) => setDisputeReasons((current) => ({
                              ...current,
                              [purchase.id]: event.target.value,
                            }))}
                          />
                          <Button
                            disabled={processingId === purchase.id}
                            type="button"
                            variant="outline"
                            onClick={() => void submitDispute(purchase.id)}
                          >
                            Request review
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!purchases.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No purchases yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeView === "write-for-mrc" ? <TipsterBlogClient /> : null}

      {activeView === "profile" ? (
        <div className="space-y-6">
          <ProfileSettingsClient
            onSaved={(profile) => {
              setProfileDisplayName(profile.displayName);
              setPhone(profile.phone);
            }}
          />

          <MfaSettingsClient />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="size-5 text-primary" />
                  Meeting-card SMS alerts
                </CardTitle>
                <CardDescription>
                  Receive transactional alerts when an entitled meeting card is published or corrected.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-background/40 p-4 text-sm">
                  <p className="text-muted-foreground">Cell number</p>
                  <p className="mt-1 font-medium">{phone || "No cell number saved"}</p>
                </div>
                <Button
                  type="button"
                  variant={smsNotificationsEnabled ? "outline" : "default"}
                  disabled={processingId === "sms-preferences" || (!smsNotificationsEnabled && !phone.trim())}
                  onClick={() => void toggleSmsNotifications()}
                >
                  {processingId === "sms-preferences" ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
                  {smsNotificationsEnabled ? "Disable SMS alerts" : "Enable SMS alerts"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  This consent covers service notifications only. Marketing SMS requires separate consent.
                </p>
              </CardContent>
            </Card>

            <Card id="email-announcements">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="size-5 text-primary" />
                  New-content and marketing emails
                </CardTitle>
                <CardDescription>
                  Choose whether MRC may email you when a new blog article or meeting card is published.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  type="button"
                  variant={emailMarketingEnabled ? "outline" : "default"}
                  disabled={processingId === "email-marketing-preferences"}
                  onClick={() => void toggleEmailMarketing()}
                >
                  {processingId === "email-marketing-preferences" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                  {emailMarketingEnabled ? "Disable email announcements" : "Enable email announcements"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  This optional marketing consent is separate from purchase receipts, security messages,
                  account notices, and card updates you are already entitled to receive.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeView === "become-tipster" ? <TipsterApplicationClient /> : null}

      <PurchaseConfirmationDialog
        request={pendingPurchase}
        busy={Boolean(pendingPurchase && processingId === pendingPurchase.id)}
        onOpenChange={(open) => {
          if (!open && !processingId) {
            setPendingPurchase(null);
          }
        }}
        onConfirm={() => {
          if (pendingPurchase?.kind === "meeting") {
            const card = cards.find((item) => item.id === pendingPurchase.id);
            if (card) {
              void purchaseMeeting(card);
            }
          }
        }}
      />

      <Dialog
        open={termsDialogOpen}
        onOpenChange={(open) => {
          if (processingId !== `access:${pendingCardId}`) {
            setTermsDialogOpen(open);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Accept the premium-content licence</DialogTitle>
            <DialogDescription>
              Meeting-card selections are licensed for your personal, non-transferable use.
              You accept each Terms version once for your account. We ask again only after the
              Terms change. Each opening receives a visible trace code linked to your account-access record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              You may not share screenshots, copy, republish, resell, or provide another
              person access to paid selections. This does not prevent ordinary personal use
              of the card from your own account.
            </p>
            <p>
              Read the <Link href="/terms/" className="text-brand-cyan underline">terms</Link>{" "}
              and <Link href="/privacy/" className="text-brand-cyan underline">privacy policy</Link>{" "}
              for the licence, audit, and personal-information details.
            </p>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-foreground">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={termsConfirmed}
                onChange={(event) => {
                  setTermsConfirmed(event.target.checked);
                  setTermsDialogError("");
                }}
              />
              I accept the current Terms, including the personal premium-content licence,
              and understand that this view will be watermarked and logged for security.
            </label>
            {termsDialogError ? (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>Card could not be opened</AlertTitle>
                <AlertDescription>{termsDialogError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={processingId === `access:${pendingCardId}`}
              onClick={() => {
                setTermsDialogOpen(false);
                setPendingCardId("");
                setTermsConfirmed(false);
                setTermsDialogError("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={processingId === `access:${pendingCardId}`}
              onClick={() => {
                if (!termsConfirmed) {
                  setTermsDialogError(
                    "Tick the acceptance box before opening the meeting card.",
                  );
                  return;
                }
                void openPremiumCard(pendingCardId, true);
              }}
            >
              {processingId === `access:${pendingCardId}` ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              Accept once and open card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
