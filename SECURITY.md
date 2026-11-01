# Security

Please report issues privately through this repository's GitHub security advisory page. Do not include pairing keys, bearer tokens, account data or real network captures in public issues. If private reporting is unavailable, open a minimal issue asking for a private contact without exploit details.

The supported trust boundary is a single OS user on a trusted home network. Malware running as that same user can access the same OS credential store; this application is not a sandbox against local malware. Device names and protocol responses remain untrusted input. Pairing never accepts an internet host or an agent-supplied URL.

The release has not undergone an independent security audit. LG first-use certificate trust relies on the user approving the correct physical TV. Older LG plaintext WebSockets and Roku HTTP are not confidential against other devices on the LAN. Use an isolated trusted home network. Never forward TV control ports through a router.

No analytics telemetry is implemented. Optional account linking connects the native helper to https://streamgpt.dev over authenticated outbound HTTPS/WSS. The cloud receives bounded approved-device inventory, opaque discovery candidates, allowlisted status fields and command outcomes. It does not receive local addresses or LG pairing keys. Native bearer credentials remain encrypted at rest and are never exposed to the renderer, URL query, MCP configuration or activity logs.

Linking requires an explicit browser approval tied to the signed-in account and displayed code. Tokens expire and are revocable; reconnection never replays commands. Snapshot/action/assistant requests resolve account authority on the server. Local pairing candidates expire and cannot supply arbitrary URLs. The renderer can open only the fixed account/setup site or its validated pending approval URL through native commands.

The helper sends inventory/liveness traffic once linked, including while its desktop window is hidden in the tray. It does not start TV discovery or pairing merely because the app opens. Quit the tray application or disconnect its account link to stop sharing. iOS background suspension is not bypassed; the server must mark a suspended helper unavailable.
