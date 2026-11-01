# iPhone companion preparation

The shared Rust library and Tauri mobile entry point are present. Windows tray, single-instance handling, stdio MCP and loopback desktop MCP are compiled only on desktop. The iOS app uses the same local TV protocols, encrypted vault, native HTTPS/WSS helper connection and responsive interface. This is source preparation, not an iOS build or TestFlight release. Mac/Xcode signing, permissions and real-device validation remain required.

## On the Mac

Install current Xcode, its command-line tools, Node.js 22+, Rust and the iOS prerequisites in [Tauri's guide](https://v2.tauri.app/start/prerequisites/#ios). Clone this repository and run:

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run ios:init
npm run ios:open
```

For an Intel Mac simulator also install `x86_64-apple-ios`. In the generated Xcode project choose your own development team. Do not commit signing identities, provisioning profiles or account credentials. `APPLE_DEVELOPMENT_TEAM` can also select the team locally. Tauri merges `src-tauri/Info.ios.plist` into the generated project; it explains local network access and permits local networking without globally allowing arbitrary internet loads.

SSDP discovery uses multicast. A physical iPhone requires Apple's multicast entitlement approval and a matching provisioning profile; the template is [ios/StreamGPT.entitlements](ios/StreamGPT.entitlements). Add it to the app target's code-signing entitlements once your team has that capability. Merely checking in the file does not grant the entitlement. Follow [Apple's multicast documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast) and [local network privacy guide](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). If discovery is unavailable, explain permission/network problems and retain manual-address setup; never silently enroll a TV.

```sh
npm run ios:dev
```

The development server uses `TAURI_DEV_HOST` supplied by Tauri. Use a trusted development network. For a distribution build use `npm run ios:build`, then Xcode signing/archive and TestFlight after the checks below. Source/config compilation on Windows cannot establish that this works on iOS.

## Physical-device acceptance

- On a clean install, opening the app or Connection agent sends no discovery, pairing or button requests.
- User starts Find TVs; verify the local-network permission prompt, denied permission recovery and entitlement-enabled SSDP on real Wi-Fi.
- User chooses a candidate and starts Connect TV. Verify LG on-screen approval/denial and Roku network-control checks. Successful connection reads status; it never sends a test button.
- Verify vault/keychain persistence, fixed-origin browser account approval, linking return, revocation and no token/LAN address in cloud snapshots.
- Verify safe-area layout and usable controls on a physical phone, plus interrupted pairing, Wi-Fi changes and guest-network isolation.
- Switch away and lock the phone. Expect the helper to become unavailable when iOS suspends the app; verify server liveness and no queued or replayed commands. Reopening must recover honestly.

The phone app is a foreground local controller/assistant. It is not an always-on background bridge while ChatGPT is foreground. A running desktop helper is the supported route for phone ChatGPT to reach home TVs. Hotel Wi-Fi must permit devices to communicate; being on the same named Wi-Fi does not guarantee that.
