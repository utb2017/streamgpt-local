# Compatibility

| Target | Implemented path | Hardware validation |
| --- | --- | --- |
| LG webOS | SSAP pairing, volume, mute, navigation, media buttons, power off | Discovery and encrypted handshake passed; on-TV approval and controls pending |
| Roku | ECP identification and allowlisted remote keys | Roku Express / OS 16.0.4: discovery, enrollment and status passed; remote button effects untested; experimental vendor-policy status |
| Windows x64 | Tauri/WebView2 installer | Build and application checks recorded in release notes |
| macOS / Linux | Tauri source, OS keyring code paths | Not packaged or validated in this release |
| Desktop MCP | stdio initialization, list tools, status and commands | Protocol smoke test |
| ChatGPT phone plugin | Authenticated StreamGPT account relay through this computer | Account link validated; LG phone control pending on-TV pairing |

An older LG NetCast TV is not a webOS TV. Model year alone does not establish compatibility. LG permission prompts, accepted manifest permissions and socket availability vary by model and firmware. Older devices can require LG Connect Apps or Mobile TV On. Newer firmware can require secure WebSockets. A changed TLS certificate requires explicit re-pairing; do not disable pinning globally.

Roku's [ECP documentation](https://developer.roku.com/dev/docs/external-control-api) documents local network control and also restricts third-party platforms sending ECP commands. This prototype is not an assertion of permission for commercial distribution. Review applicable vendor terms before offering it as a service. Some commands require Control by mobile apps enabled. Streaming players may not support TV power/volume control.

No universal compatibility, confirmed physical TV effect, remote power-on, arbitrary channel launch or complete phone-to-TV hardware compatibility is claimed. Tests must not send real TV commands. Record model, firmware, command, observed outcome and approval context when adding hardware validation.

## LG legacy certificate compatibility (0.2.2)

Some webOS TVs serve X.509 v1 certificates. LG connections now use platform TLS (Schannel on Windows), require TLS 1.2 or newer, and check the saved certificate fingerprint before the WebSocket upgrade or any registration/control payload. This does not change cloud TLS: the account relay explicitly uses Rustls with public trust roots. No TLS-error downgrade to plaintext was added.

The setup asks viewers to be near the LG with its remote before connecting. Approval timeout, rejection, interrupted pairing, secure connection failure, and changed certificate have fixed messages across the authenticated relay. Unknown failures remain unconfirmed and are never retried automatically. Discovery and an encrypted handshake are not proof of pairing or remote control.

Implementation references: [native-tls](https://docs.rs/native-tls/latest/native_tls/) and [LG Connect SDK](https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVServiceSocketClient.java).

Building native TLS on Linux also requires the platform OpenSSL development libraries. Only the Windows build is packaged and verified here.
