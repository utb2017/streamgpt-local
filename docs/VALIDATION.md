# Release validation

## 0.2.3 permission and recovery fixes

Rust protocol/controller tests: 52 passed, with one fixture-export utility ignored by default. Tests cover real loopback HTTP403 versus a post-send timeout, durable denied-command receipts, old stored records, and shared Rust-generated wire fixtures. Hosted schema tests use the identical fixture bytes and actual `play`/`power_off` names.

Native UI: seven model tests and 73 mocked browser checks pass. Coverage includes transient inventory retention, explicit auth/revocation clearing, Roku permission recovery, and no automatic button/pairing replay. Companion hosted tests and browser regressions cover account busy rejection, outage recovery, fixed denial reasons, stale host notification rejection, compatibility initialization and stable computer/TV pickers.

The Windows x64 installer built successfully. The packaged WebView2 app, Rust IPC, encrypted OS vault, authenticated local MCP and close-to-tray smoke checks passed. After restart, v0.2.3 retained all saved local TVs and the account link; the live hosted inventory also retained Samsung. A read-only request to the Roku returned reachable with Limited network control, and the account-linked remote displayed the exact setting guidance with playback buttons blocked and Check status available.

These tests do not prove physical playback. The observed Roku reported Limited network control before this update. LG on-TV approval and a read-only status request have succeeded; physical button effects remain user-verified work. Previous sections below are historical release records, not the current feature inventory.


## 0.1.2 discovery-first setup

Production UI build, 12 Rust tests, Clippy with warnings denied, browser fixture flows and independent MCP checks passed. Browser checks cover automatic discovery, selecting a result without typing an address, manual fallback, empty results, and the connection gate before remote buttons are enabled.

Live native verification discovered a Roku Express running Roku OS 16.0.4 over Wi-Fi from a wired Windows PC. The native wizard displayed its friendly name with the IP form hidden. User-authorized enrollment and read-only status checks passed through the running app and the independent MCP client. No remote button commands were sent. Device addresses, names and screenshots from this private network are not published.

The desktop MCP now exposes discovery to an existing AI client. The hosted server/phone relay remains unimplemented; the app does not contain a separate language model.

## 0.1.1 setup clarification

The setup dialog now distinguishes the Roku's on-TV settings from the PC app, explains Ethernet/Wi-Fi connectivity, and states the separate Add device and Connect this TV steps. Roku connection progress no longer asks the user to wait for an LG approval prompt. The production UI build and the browser fixture flow passed, including manual Roku enrollment with no command dispatch.

Version 0.1.0 was checked on Windows x64 on October 31, 2026.

| Check | Result |
| --- | --- |
| TypeScript and production Vite build | Passed |
| Rust unit and protocol fixture tests | 11 passed |
| Rust formatting and Clippy with warnings denied | Passed |
| npm dependency audit | No reported vulnerabilities |
| Browser UI flow with mocked native transport | Passed: discovery, enrollment, pairing, one command, MCP configuration |
| Desktop and narrow mobile preview | Inspected; no horizontal overflow |
| Release executable with independent MCP SDK client | Initialization, tool discovery and invalid request rejection passed |
| Native WebView2 application | Rendered successfully; Rust IPC returned configuration |
| Native OS credential store and encrypted local bridge | Independent MCP process successfully read the running app's device snapshot |
| Windows NSIS installer | Built successfully; unsigned preview |

The native smoke test does not scan the network or send TV commands. The UI flow uses test doubles. Protocol tests use local fixtures. None of these checks establishes compatibility with a physical television.

LG and Roku hardware pairing/control remain unverified. macOS and Linux are not release-validated. The phone-to-home cloud relay is not included.

GitHub Actions is not enabled. Optional workflow templates are included under `docs/workflows`; the publishing credential lacked GitHub's workflow permission.

## Reproduce

Install the prerequisites from the README, then run:

```sh
npm ci
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm audit
npm run dist
npm run test:mcp
npm run test:desktop
```

For `npm run test:ui`, first run `npm run preview` in a separate terminal. The native desktop smoke test briefly launches its own app instance and enables a process-scoped WebView2 debugging port. Close an existing StreamGPT Local instance before running it.
