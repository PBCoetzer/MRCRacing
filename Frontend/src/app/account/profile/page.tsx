import { ProfileSettingsClient } from "@/components/account/profile-settings-client";
import { DashboardShell } from "@/components/dashboard-shell";

const profileNav = [
  { label: "My profile", href: "/account/profile/" },
  { label: "Profile security & 2FA", href: "/account/security/" },
];

export default function AccountProfilePage() {
  return (
    <DashboardShell
      allowedRoles={["client", "tipster", "administrator"]}
      accessDescription="your account profile"
      accessTitle="Registered account required"
      title="Profile and account settings"
      description="View your last successful sign-in and keep your personal profile and contact details up to date."
      nav={profileNav}
      requireRole={false}
    >
      <ProfileSettingsClient />
    </DashboardShell>
  );
}

