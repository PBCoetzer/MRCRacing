export function jwtHasAal2(accessToken: string) {
  try {
    const payloadSegment = accessToken.split(".")[1];
    if (!payloadSegment) return false;
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { aal?: unknown };
    return payload.aal === "aal2";
  } catch {
    return false;
  }
}
