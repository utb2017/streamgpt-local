// Only fixed public codes may influence UI copy. Never render raw provider errors.
export const rokuInstructions =
  "On your Roku, open Settings > System > Advanced system settings > Control by mobile apps > Network access > Enabled. Developer mode is not required.";
const codes = [
  "LG_APPROVAL_TIMEOUT",
  "LG_APPROVAL_REJECTED",
  "LG_PAIRING_INTERRUPTED",
  "LG_SECURE_CONNECTION_FAILED",
  "LG_CERTIFICATE_CHANGED",
  "HELPER_UNAVAILABLE",
  "REMOTE_BUSY",
  "COMMAND_EXPIRED",
  "ROKU_CONTROL_DISABLED",
] as const;
export type ErrorCode = (typeof codes)[number];
export const knownErrorCode = (value: unknown): ErrorCode | undefined =>
  typeof value === "string" && codes.includes(value as ErrorCode)
    ? (value as ErrorCode)
    : undefined;
export class RemoteFailure extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}
export function errorCode(error: unknown): ErrorCode | undefined {
  return knownErrorCode(
    error instanceof RemoteFailure
      ? error.code
      : error instanceof Error
        ? error.message
        : error,
  );
}
export function recoveryText(error: unknown): string {
  const messages: Record<ErrorCode, string> = {
    LG_APPROVAL_TIMEOUT:
      "LG approval timed out. Take the TV remote to the TV, find it again when ready, choose Connect TV, and accept the request on its screen.",
    LG_APPROVAL_REJECTED:
      "LG declined the connection. Enable LG Connect Apps or Mobile TV On, then find it again and approve while near the screen.",
    LG_PAIRING_INTERRUPTED:
      "LG approval was interrupted. Check the saved TV list first; if the TV is absent, find it again and approve near its screen.",
    LG_SECURE_CONNECTION_FAILED:
      "The secure LG connection failed. Keep the TV on and on the same home network as your computer.",
    LG_CERTIFICATE_CHANGED:
      "The LG identity changed. Remove its saved connection and pair again only after checking that it is your TV.",
    HELPER_UNAVAILABLE:
      "Your computer is temporarily unavailable. Keep StreamGPT Local open and refresh your saved TV list.",
    REMOTE_BUSY:
      "Another request is still running. Wait for it to finish, then choose your next action. Nothing was retried.",
    COMMAND_EXPIRED:
      "The request expired. Check the TV before choosing another action. Nothing was retried.",
    ROKU_CONTROL_DISABLED: `Roku blocked network control. ${rokuInstructions}`,
  };
  const code = errorCode(error);
  return code
    ? messages[code]
    : "Connection unavailable. Please try refreshing.";
}
type Evidence = {
  manufacturer?: string;
  brand?: string;
  controlPermission?: string;
  reachable?: boolean;
  lastSeen?: number | string;
};
export const controlBlocked = (d: Evidence | undefined): boolean =>
  d?.controlPermission === "limited" || d?.controlPermission === "disabled";
export function deviceEvidenceText(d: Evidence | undefined): string {
  if (!d) return "";
  const stamp =
    typeof d.lastSeen === "number" ? d.lastSeen : Number(d.lastSeen);
  const read =
    d.reachable === undefined
      ? "No last-read TV reachability evidence supplied."
      : `Last TV read: ${d.reachable ? "reachable" : "unreachable"}${Number.isFinite(stamp) && stamp >= 0 ? " at " + new Date(stamp).toLocaleTimeString() : ""}.`;
  if ((d.manufacturer ?? d.brand)?.toLowerCase() !== "roku") return read;
  return `${read} ${controlBlocked(d) ? `Roku network control is ${d.controlPermission}. ${rokuInstructions}` : d.controlPermission === "enabled" ? "Roku network control is enabled; button effects remain unconfirmed." : "Roku network control permission is unknown. A status read does not prove buttons are allowed."}`;
}
