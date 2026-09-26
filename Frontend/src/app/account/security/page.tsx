import { MfaSettingsClient } from "@/components/auth/mfa-settings-client";
import { DashboardShell } from "@/components/dashboard-shell";

const securityNav = [
  { label: "Profile security & 2FA", href: "/account/security/" },
  { label: "Public blog", href: "/blog/" },
];

export default function AccountSecurityPage() {
  return (
    <DashboardShell
      allowedRoles={["client", "tipster", "administrator"]}
      accessDescription="account security"
      accessTitle="Registered account required"
      title="Profile security and two-factor authentication"
      description="Every registered client, tipster, blog author, and administrator can manage an authenticator app here. Administrators must complete 2FA before opening operational or payment controls."
      nav={securityNav}
      mfaPolicy="management"
      requireRole={false}
    >
      <MfaSettingsClient />
    </DashboardShell>
  );
}
