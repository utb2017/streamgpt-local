<p align="center"><img src="src-tauri/icons/icon.png" width="76" alt="StreamGPT Local icon" /></p>
<h1 align="center">StreamGPT Local</h1>
<p align="center">Every screen. One place.</p>
<p align="center">A monochrome desktop remote and local MCP companion for LG webOS and Roku.<br/>Built with Rust, Tauri 2, React and TypeScript.</p>
<p align="center"><a href="https://github.com/utb2017/streamgpt-local/releases/latest">Download for Windows</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="docs/COMPATIBILITY.md">Compatibility</a> · <a href="CONTRIBUTING.md">Contribute</a></p>

![StreamGPT Local desktop interface. Preview uses explicitly labeled sample devices.](docs/preview.png)

## A remote that belongs in your living room

StreamGPT Local connects an approved desktop AI client or its own visual remote to TVs on your home network. The native Rust process handles device discovery, pairing, storage and commands. The interface uses the operating system's webview instead of shipping Chromium or Node.js.

- **Find your screens.** SSDP discovery on private IPv4 interfaces, with manual IP entry when discovery is blocked.
- **Approve access.** LG pairing happens on the TV. Roku requires network control enabled in its settings.
- **Keep control local.** Pairing credentials and the command journal are encrypted using a key held by the OS credential store.
- **Connect your AI.** Built-in stdio MCP exposes three focused tools. Enrollment and removal stay in the desktop app.
- **Know what happened.** Durable request IDs prevent duplicate delivery. Missing acknowledgements remain uncertain; commands are never automatically retried.

**Early preview:** LG/Roku hardware compatibility is not yet verified for this release. Protocol and security checks use fixtures. The screenshot is a labeled interactive preview, not evidence of connected hardware. Roku's current ECP documentation restricts third-party platforms; availability of this source does not grant permission to distribute a commercial Roku remote. See [compatibility](docs/COMPATIBILITY.md).

## Get started

1. Download the Windows installer from [Releases](https://github.com/utb2017/streamgpt-local/releases/latest). This preview is not code-signed; Windows may show an unknown-publisher warning. Check the published SHA-256 before installing.
2. Open StreamGPT Local. Keep the computer and TV on the same home network. Ethernet and Wi-Fi both work when the router permits them to communicate.
3. Choose **Add a device → Find nearby TVs**, or enter the TV's private IP address from its Network settings.
4. Select **Connect this TV**. On LG, approve the prompt on the television. On Roku, enable **Settings → System → Advanced system settings → Control by mobile apps** as required by the device's OS.
5. Use the remote, or open **Connect AI** and copy the generated MCP configuration into a desktop client that supports local stdio servers.

The app must remain open and the computer awake. No router port forwarding, vendor account password or paid cloud service is required for local operation. Power-on from standby, arbitrary app launching and media streaming are not included.

## Desktop MCP

The executable supports `--mcp`. The app generates the correct executable path for your installation; do not copy another user's absolute path.

| Tool | Purpose |
| --- | --- |
| `list_tvs` | List devices explicitly approved in the desktop app |
| `get_tv_status` | Read a paired TV's status |
| `press_tv_button` | Send one allowlisted button, with a required UUID request ID |

The MCP child process connects to an authenticated loopback endpoint owned by the running desktop app. It cannot discover, enroll, pair or forget devices. Pairing keys are never returned in tool output.

**ChatGPT on your phone:** this release is a local controller and desktop MCP companion. It does not connect to the hosted StreamGPT phone app. That requires a separate authenticated outbound cloud relay. The working Samsung/SmartThings cloud integration is a different project and remains untouched.

## Development

Requirements: Node.js 22+, Rust stable and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows uses the MSVC toolchain and WebView2. The Windows installer can bootstrap WebView2 if needed.

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run dist
```

For a UI-only preview without touching a network or TV:

```sh
npm run preview
# Open http://127.0.0.1:5198/?demo=1
```

Windows installers are the initial supported distribution. macOS/Linux code paths are not release-validated. Build output, credential stores and local configuration are excluded from this repository.

## Design and engineering

- Black and neutral surfaces, a tactile directional pad, clear approval states and explicit empty states.
- A single serialized controller for UI and MCP; durable reservation precedes any button dispatch.
- Private IPv4 targets only. Discovery never follows a responder-supplied URL.
- LG certificate pinning on first approved pairing; subsequent connections must use the same certificate. Older TVs may use plaintext WebSockets on the trusted LAN.
- Deny-by-default remote webview access. The renderer has no general shell, filesystem or network capability.

See [architecture](docs/ARCHITECTURE.md), [security](SECURITY.md), and [research](docs/RESEARCH.md) for the details and tradeoffs.

## Credits

Created by **Aaron Tomlinson**. Original interface and Rust implementation. Research informed by Roku's ECP documentation, the MIT-licensed `lgtv2` protocol documentation, and existing community MCP projects. This project is not affiliated with LG, Roku, OpenAI or Samsung.

MIT licensed. Vendor names identify compatible protocols; they are not endorsements.
