"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  ShieldCheck,
  UserRoundSearch,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCredits, formatRaceDateTime } from "@/lib/racing/format";
import { createClient } from "@/lib/supabase/client";

type AppRole = "client" | "tipster" | "administrator";
type AccountStatus = "active" | "flagged" | "suspended" | "banned";
type TriState = "all" | "yes" | "no";

type AdminUserRow = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phone: string | null;
  roles: AppRole[];
  status: AccountStatus;
  suspensionUntil: string | null;
  authSyncStatus: "synced" | "pending" | "failed";
  creditBalance: number;
  tipsterId: string | null;
  tipsterDisplayName: string | null;
  tipsterVerified: boolean;
  testAccess: boolean;
  isOwner: boolean;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string;
};

type UserSearchResponse = {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
};

function triStateValue(value: TriState) {
  if (value === "all") {
    return null;
  }

  return value === "yes";
}

function statusVariant(status: AccountStatus) {
  if (status === "banned" || status === "suspended") {
    return "destructive" as const;
  }

  if (status === "flagged") {
    return "secondary" as const;
  }

  return "outline" as const;
}

export function AdminUsersClient() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"all" | AppRole>("all");
  const [status, setStatus] = useState<"all" | AccountStatus>("all");
  const [emailConfirmed, setEmailConfirmed] = useState<TriState>("all");
  const [verifiedTipster, setVerifiedTipster] = useState<TriState>("all");
  const [testAccess, setTestAccess] = useState<TriState>("all");
  const [missingIdentity, setMissingIdentity] = useState<TriState>("all");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const { data, error: searchError } = await supabase.rpc("admin_search_users", {
      p_query: search.trim() || null,
      p_roles: role === "all" ? null : [role],
      p_statuses: status === "all" ? null : [status],
      p_email_confirmed: triStateValue(emailConfirmed),
      p_verified_tipster: triStateValue(verifiedTipster),
      p_test_access: triStateValue(testAccess),
      p_missing_identity: triStateValue(missingIdentity),
      p_sort: sort,
      p_page: page,
      p_page_size: 25,
    });

    if (searchError) {
      setError(searchError.message);
      setLoading(false);
      return;
    }

    const result = data as UserSearchResponse;
    setUsers(result.items ?? []);
    setTotal(result.total ?? 0);
    setPageSize(result.pageSize ?? 25);
    setLoading(false);
  }, [
    emailConfirmed,
    missingIdentity,
    page,
    role,
    search,
    sort,
    status,
    testAccess,
    verifiedTipster,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadUsers();
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [loadUsers]);

  function resetPage() {
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>User search failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Search and filters</CardTitle>
          <CardDescription>
            Queries run on the server and return 25 accounts per page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Email, first name, surname, display name, or phone"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
            />
          </div>
          <FilterSelect
            label="Role"
            value={role}
            onValueChange={(value) => {
              setRole(value as "all" | AppRole);
              resetPage();
            }}
            items={[
              ["all", "All roles"],
              ["client", "Client"],
              ["tipster", "Tipster"],
              ["administrator", "Administrator"],
            ]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onValueChange={(value) => {
              setStatus(value as "all" | AccountStatus);
              resetPage();
            }}
            items={[
              ["all", "All statuses"],
              ["active", "Active"],
              ["flagged", "Flagged"],
              ["suspended", "Suspended"],
              ["banned", "Banned"],
            ]}
          />
          <TriStateFilter
            label="Email"
            value={emailConfirmed}
            yesLabel="Confirmed"
            noLabel="Unconfirmed"
            onValueChange={(value) => {
              setEmailConfirmed(value);
              resetPage();
            }}
          />
          <TriStateFilter
            label="Tipster"
            value={verifiedTipster}
            yesLabel="Verified"
            noLabel="Not verified"
            onValueChange={(value) => {
              setVerifiedTipster(value);
              resetPage();
            }}
          />
          <TriStateFilter
            label="Test access"
            value={testAccess}
            yesLabel="Enabled"
            noLabel="Disabled"
            onValueChange={(value) => {
              setTestAccess(value);
              resetPage();
            }}
          />
          <TriStateFilter
            label="Identity"
            value={missingIdentity}
            yesLabel="Missing details"
            noLabel="Complete"
            onValueChange={(value) => {
              setMissingIdentity(value);
              resetPage();
            }}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onValueChange={(value) => {
              setSort(value);
              resetPage();
            }}
            items={[
              ["created_desc", "Newest first"],
              ["created_asc", "Oldest first"],
              ["name_asc", "Name A–Z"],
              ["email_asc", "Email A–Z"],
              ["last_sign_in_desc", "Recent sign-in"],
              ["credits_desc", "Highest Credits"],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>User directory</CardTitle>
            <CardDescription>
              {loading ? "Loading accounts…" : `${total.toLocaleString()} matching account(s)`}
            </CardDescription>
          </div>
          {loading ? <Loader2 className="size-5 animate-spin text-brand-cyan" /> : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

                return (
                  <TableRow key={user.userId}>
                    <TableCell>
                      <div className="min-w-52">
                        <p className="font-semibold">
                          {user.displayName || fullName || "Identity incomplete"}
                          {user.isOwner ? (
                            <Badge className="ml-2" variant="secondary">Owner</Badge>
                          ) : null}
                        </p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                        {user.phone ? <p className="text-xs text-muted-foreground">{user.phone}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
                      {user.authSyncStatus !== "synced" ? (
                        <p className="mt-1 text-xs text-brand-gold">
                          Auth {user.authSyncStatus}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-40 flex-wrap gap-1">
                        {user.roles.map((userRole) => (
                          <Badge key={userRole} variant="outline">{userRole}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{formatCredits(user.creditBalance)}</TableCell>
                    <TableCell>
                      <div className="flex min-w-32 flex-wrap gap-1">
                        {user.tipsterVerified ? (
                          <Badge><ShieldCheck className="size-3" />Verified</Badge>
                        ) : null}
                        {user.testAccess ? <Badge variant="secondary">Test</Badge> : null}
                        <Badge variant={user.emailConfirmed ? "outline" : "destructive"}>
                          {user.emailConfirmed ? "Email confirmed" : "Email pending"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.lastSignInAt ? formatRaceDateTime(user.lastSignInAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/user/?user=${user.userId}`}>
                          <UserRoundSearch className="size-4" />
                          Review
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && !users.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    No accounts match these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {firstRow}–{lastRow} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Badge variant="outline">Page {page} of {pageCount}</Badge>
              <Button
                type="button"
                variant="outline"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type FilterSelectProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: [string, string][];
};

function FilterSelect({ label, value, onValueChange, items }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map(([itemValue, itemLabel]) => (
          <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type TriStateFilterProps = {
  label: string;
  value: TriState;
  yesLabel: string;
  noLabel: string;
  onValueChange: (value: TriState) => void;
};

function TriStateFilter({
  label,
  value,
  yesLabel,
  noLabel,
  onValueChange,
}: TriStateFilterProps) {
  return (
    <FilterSelect
      label={label}
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TriState)}
      items={[
        ["all", `All ${label.toLowerCase()}`],
        ["yes", yesLabel],
        ["no", noLabel],
      ]}
    />
  );
}
