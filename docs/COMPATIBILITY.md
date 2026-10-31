# Compatibility

| Target | Implemented path | Hardware validation |
| --- | --- | --- |
| LG webOS | SSAP pairing, volume, mute, navigation, media buttons, power off | Pending |
| Roku | ECP identification and allowlisted remote keys | Pending; experimental vendor-policy status |
| Windows x64 | Tauri/WebView2 installer | Build and application checks recorded in release notes |
| macOS / Linux | Tauri source, OS keyring code paths | Not packaged or validated in this release |
| Desktop MCP | stdio initialization, list tools, status and commands | Protocol smoke test |
| ChatGPT phone plugin | Requires cloud relay | Not included |

An older LG NetCast TV is not a webOS TV. Model year alone does not establish compatibility. LG permission prompts, accepted manifest permissions and socket availability vary by model and firmware. Older devices can require LG Connect Apps or Mobile TV On. Newer firmware can require secure WebSockets. A changed TLS certificate requires explicit re-pairing; do not disable pinning globally.

Roku's [ECP documentation](https://developer.roku.com/dev/docs/external-control-api) documents local network control and also restricts third-party platforms sending ECP commands. This prototype is not an assertion of permission for commercial distribution. Review applicable vendor terms before offering it as a service. Some commands require Control by mobile apps enabled. Streaming players may not support TV power/volume control.

No universal compatibility, confirmed physical TV effect, remote power-on, arbitrary channel launch or cloud-phone connectivity is claimed. Tests must not send real TV commands. Record model, firmware, command, observed outcome and approval context when adding hardware validation.
