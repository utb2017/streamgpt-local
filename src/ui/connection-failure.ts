import { recoveryText } from "./recovery";
export function isAccountAuthError(error: unknown): boolean {
  return (
    (error instanceof Error ? error.message : error) ===
    "Link this helper to StreamGPT again."
  );
}
// Only fixed, known error codes become UI copy; never render provider text.
export function connectionFailure(error: unknown): string {
  const code =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const messages: Record<string, string> = {
    ROKU_CONTROL_DISABLED: recoveryText("ROKU_CONTROL_DISABLED"),
    HELPER_UNAVAILABLE: recoveryText("HELPER_UNAVAILABLE"),
    REMOTE_BUSY: recoveryText("REMOTE_BUSY"),
    COMMAND_EXPIRED: recoveryText("COMMAND_EXPIRED"),
    LG_APPROVAL_TIMEOUT:
      "The LG did not finish approval in time. Go to the TV with its remote. When you are ready, find it again, choose Connect TV, and accept the request on the TV screen.",
    LG_APPROVAL_REJECTED:
      "The LG declined the connection. Check that LG Connect Apps or Mobile TV On is enabled on the TV. Then find it again and connect while you are near its screen.",
    LG_PAIRING_INTERRUPTED:
      "The LG connection ended before approval was confirmed. Refresh your TV list first. If it is not connected, find it again when you are near the TV.",
    LG_SECURE_CONNECTION_FAILED:
      "The secure connection to the LG failed before approval could be requested. Keep the TV on and check that this computer and TV are on the same home network.",
    LG_CERTIFICATE_CHANGED:
      "This TV's saved identity has changed. The connection was stopped. Remove its saved connection and pair again only after checking that it is your TV.",
  };
  return (
    (messages[code] ||
      "The TV connection was not confirmed. Refresh your TV list first. If it is not connected, find it again when you are ready.") +
    " No TV buttons were sent. Nothing was retried."
  );
}
