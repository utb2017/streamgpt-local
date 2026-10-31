# Contributing

Keep the controller small, the interface monochrome, and device authority explicit.

1. Open an issue describing a concrete device or workflow.
2. Use a branch and a focused pull request.
3. Add regression coverage for protocol, pairing, storage and command changes.
4. Run the build, Rust tests, formatter and TypeScript checks.
5. Explain what was tested on hardware versus fixtures. Never send real TV commands from CI.

Do not commit local state, credentials, absolute developer paths, build artifacts or unredacted device captures. Do not add arbitrary URL fetching, arbitrary SSAP requests, automatic command retries or a plaintext credential fallback.

UI-only development: `npm ci`, `npm run preview`, open `http://127.0.0.1:5198/?demo=1`. The preview label must remain visible in screenshots.
