export type AuthenticatorLevel = "aal1" | "aal2" | (string & {}) | null;

type MfaDestinationOptions = {
  currentLevel: AuthenticatorLevel;
  nextLevel: AuthenticatorLevel;
  isAdministrator: boolean;
  destination: string;
};

export function safeInternalDestination(value: string | null | undefined, fallback: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function destinationAfterPrimaryLogin({
  currentLevel,
  nextLevel,
  isAdministrator,
  destination,
}: MfaDestinationOptions) {
  const safeDestination = safeInternalDestination(destination, "/client/");

  if (safeDestination.startsWith("/account/security")) {
    return safeDestination;
  }

  const mode =
    currentLevel !== "aal2" && nextLevel === "aal2"
      ? "challenge"
      : currentLevel !== "aal2" && isAdministrator
        ? "setup"
        : null;

  if (!mode) {
    return safeDestination;
  }

  const searchParams = new URLSearchParams({
    mode,
    next: safeDestination,
  });

  return `/account/security/?${searchParams.toString()}`;
}
