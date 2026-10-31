# Security

Please report issues privately through this repository's GitHub security advisory page. Do not include pairing keys, bearer tokens, account data or real network captures in public issues. If private reporting is unavailable, open a minimal issue asking for a private contact without exploit details.

The supported trust boundary is a single OS user on a trusted home network. Malware running as that same user can access the same OS credential store; this application is not a sandbox against local malware. Device names and protocol responses remain untrusted input. Pairing never accepts an internet host or an agent-supplied URL.

The release has not undergone an independent security audit. LG first-use certificate trust relies on the user approving the correct physical TV. Older LG plaintext WebSockets and Roku HTTP are not confidential against other devices on the LAN. Use an isolated trusted home network. Never forward TV control ports through a router.

No telemetry is implemented. A cloud relay is not enabled. The app stores local encrypted device state and command receipts and makes network requests only for requested discovery, pairing, status and control.
