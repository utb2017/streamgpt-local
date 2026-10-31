# Prior art and protocol references

Checked October 31, 2026 before implementation.

- [Roku ECP](https://developer.roku.com/dev/docs/external-control-api): local SSDP discovery, port 8060, keypress commands, platform restrictions.
- [Roku MCP ECP tools](https://developer.roku.com/dev/docs/rsg-sdk-mcp-ecp): official developer tooling already exposes MCP control.
- [Paramount Roku Dev Studio](https://github.com/paramount-engineering/roku-dev-studio): an existing developer-focused Electron application with MCP and remote-server components.
- [LG TV control MCP](https://github.com/brunofgmag/lgtv-control-mcp): existing community LG webOS MCP implementation.
- [LG TV MCP](https://github.com/OmerLapidot/lg-tv-mcp): existing local community server with SSAP pairing.
- [lgtv2](https://github.com/hobbyquaker/lgtv2): MIT-licensed protocol reference for LG registration, WebSocket ports, media requests and pointer button behavior. No library or signed LG application manifest is bundled in this Rust implementation.
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [capabilities](https://v2.tauri.app/security/capabilities/): native packaging and scoped webview commands.
- [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports): local stdio transport.

This project contributes a focused two-brand desktop interface and a Rust controller. It does not claim to invent ECP, SSAP, MCP or the local-bridge concept.
