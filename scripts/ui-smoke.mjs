import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
const qa = process.env.STREAMGPT_UI_QA_DIR || ".local/qa";
await mkdir(qa, { recursive: true });
const modelTests = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "src/ui/connection-model.test.mjs"],
  { stdio: "inherit" },
);
assert.equal(modelTests.status, 0, "Native connection policy regressions");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    const local = {
      devices: [],
      receipts: [],
      version: "fixture",
      cloud: "not_connected",
      mcpConfig: "synthetic MCP config",
    };
    const helper = "fixture-helper",
      tv = "fixture-roku";
    const base = {
      version: 1,
      revision: 0,
      identity: { label: "Linked account" },
      connection: { status: "connected" },
      samsungConnected: true,
      helpers: [
        { id: helper, name: "Home PC", platform: "windows", online: true },
        {
          id: "other-pc",
          name: "Office PC",
          platform: "windows",
          online: true,
        },
      ],
      devices: [
        {
          id: tv,
          label: "Roku fixture",
          manufacturer: "roku",
          provider: "local",
          helperId: helper,
          online: true,
          buttons: [
            "home",
            "back",
            "up",
            "down",
            "left",
            "right",
            "select",
            "Play",
            "rewind",
            "forward",
          ],
          components: [
            {
              id: "main",
              capabilities: [{ id: "streamgpt.remote", version: 1 }],
            },
          ],
        },
        {
          id: "samsung",
          label: "Samsung fixture",
          provider: "smartthings",
          components: [
            {
              id: "speaker-two",
              capabilities: [
                { id: "audioVolume", version: 1 },
                { id: "audioMute", version: 1 },
                { id: "switch", version: 1 },
              ],
            },
          ],
        },
      ],
      selectedDeviceId: tv,
      candidates: [],
      activity: [],
    };
    let linked = !location.search.includes("unlinked"),
      pending = location.search.includes("pending"),
      offline = false,
      rev = 0;
    window.__calls = [];
    window.__fixture = {
      base,
      local,
      setLinked: (v) => (linked = v),
      setOffline: (v) => (offline = v),
    };
    const snap = () => ({ ...structuredClone(base), revision: ++rev });
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, { input }) => {
        window.__calls.push({ command, ...structuredClone(input) });
        if (command === "controller") {
          if (input.op === "snapshot") return structuredClone(local);
          if (input.op === "discover")
            return window.__fixture.emptySearch
              ? []
              : [
                  {
                    host: "192.168.1.40",
                    brand: window.__fixture.discoveryBrand || "lg",
                    name: "Local discovery fixture",
                  },
                ];
          if (input.op === "add") {
            if (
              local.devices.some(
                (d) => d.host === input.host && d.brand === input.brand,
              )
            )
              throw Error("Address already saved");
            local.devices.push({
              id: "local-saved",
              host: input.host,
              brand: input.brand,
              name: input.name,
              model: "Synthetic",
              paired: false,
              reachable: false,
            });
            return structuredClone(local);
          }
          if (input.op === "pair") {
            local.devices[0].paired = true;
            local.devices[0].reachable = true;
            return { snapshot: structuredClone(local) };
          }
          if (input.op === "inspect") {
            if (window.__fixture.failInspect)
              throw Error("Fixture status read unavailable");
            local.devices[0].reachable = true;
            return { snapshot: structuredClone(local), info: { power: "on" } };
          }
          if (input.op === "press")
            return {
              snapshot: structuredClone(local),
              receipt: { status: "accepted" },
            };
          throw Error("Unexpected local operation");
        }
        if (command !== "cloud_command") throw Error("Unexpected command");
        if (input.op === "status")
          return {
            status: linked
              ? offline
                ? "offline"
                : "connected"
              : pending
                ? "pending"
                : "not_connected",
            helperId: linked ? helper : null,
            platform: "windows",
            message: "",
            pending:
              !linked && pending
                ? {
                    userCode: "FIXTURE-123",
                    approvalUrl: "https://example.invalid/fixture",
                    expiresAt: Date.now() + 60000,
                  }
                : null,
            activity: linked
              ? [
                  {
                    seq: 1,
                    id: "transport-fixture",
                    op: "inspect",
                    phase: window.__fixture.nativePhase || "completed",
                    at: 1000,
                  },
                ]
              : [],
          };
        if (input.op === "snapshot") {
          if (window.__fixture.failSnapshot)
            throw Error("Fixture account snapshot unavailable");
          const response = snap();
          if (window.__fixture.holdSnapshot) {
            window.__fixture.holdSnapshot = false;
            return new Promise((resolve, reject) => {
              window.__fixture.releaseSnapshot = (fail) =>
                fail
                  ? reject(Error("Fixture snapshot failed"))
                  : resolve(response);
            });
          }
          return response;
        }
        if (input.op === "start") {
          pending = true;
          return null;
        }
        if (input.op === "open_approval") return null;
        if (input.op === "disconnect") {
          linked = false;
          return null;
        }
        if (input.op === "open_remote") return null;
        if (input.op === "ask")
          throw Error("AI intentionally unavailable in fixture");
        if (input.op === "action") {
          const a = input.action;
          delete base.receipt;
          if (a.type === "discover_local") {
            if (window.__fixture.failSearch)
              throw Error("Fixture search failure");
            if (window.__fixture.holdSearch)
              await new Promise((resolve) => {
                window.__fixture.releaseSearch = resolve;
              });
            base.candidates = window.__fixture.emptySearch
              ? []
              : [
                  {
                    helperId: helper,
                    candidateId: "candidate-lg",
                    name: "Cloud LG fixture",
                    brand: "lg",
                  },
                ];
          }
          if (a.type === "connect_local") {
            const lg = {
              ...structuredClone(base.devices[0]),
              id: "fixture-lg",
              label: "Cloud LG fixture",
              manufacturer: "lg",
              buttons: [
                "home",
                "up",
                "down",
                "left",
                "right",
                "select",
                "play",
                "pause",
                "volume_up",
                "volume_down",
                "mute",
                "power_off",
              ],
            };
            base.devices.push(lg);
            base.selectedDeviceId = lg.id;
            base.candidates = [];
            base.verification = {
              deviceId: lg.id,
              outcome: "status_read",
              checkedAt: Date.now(),
            };
          }
          if (a.type === "select_tv") {
            base.selectedDeviceId = a.deviceId;
            delete base.verification;
          }
          if (a.type === "get_tv_status")
            base.verification = {
              deviceId: base.selectedDeviceId,
              outcome: "status_read",
              checkedAt: Date.now(),
            };
          if (a.type === "send_tv_command")
            base.receipt = {
              requestId: a.requestId,
              status: "accepted",
              message: "Fixture only",
            };
          const seq = (base.activity.at(-1)?.seq || 0) + 1;
          for (const [i, phase] of ["requested", "completed"].entries())
            base.activity.push({
              seq: seq + i,
              runId: "domain-fixture",
              op: a.type,
              phase,
              at: Date.now(),
            });
          base.activity = base.activity.slice(-30);
          return snap();
        }
        throw Error("Unexpected cloud operation");
      },
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const calls = () => page.evaluate(() => window.__calls);
  const mutations = async () =>
    (await calls()).filter((c) => !["snapshot", "status"].includes(c.op));
  const dialog = page.getByRole("dialog");
  const close = async () =>
    dialog.getByRole("button", { name: "Close setup", exact: true }).click();
  const add = async (brand) => {
    await page.getByRole("button", { name: "Add a TV", exact: true }).click();
    if (brand)
      await dialog
        .getByRole("button", { name: new RegExp("^" + brand + " ") })
        .click();
  };
  const nav = async (name) =>
    page
      .getByRole("navigation", { name: "App sections" })
      .getByRole("button", { name, exact: true })
      .click();
  const origin = "http://127.0.0.1:5198";
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Choose Roku fixture", exact: true })
    .waitFor();
  check((await mutations()).length === 0, "Opening is idle and read-only");
  check(
    await page
      .getByRole("heading", { name: "Your TVs.", exact: true })
      .isVisible(),
    "Your TVs is the main experience",
  );
  check(
    (await page.locator(".tv-choice").count()) === 2,
    "Existing multiple TVs appear as distinct selectable cards",
  );
  check(
    (await page
      .getByRole("button", { name: "Add a TV", exact: true })
      .count()) === 1,
    "One Add a TV entry",
  );
  check(
    !/snapshot|transport|helper|inference|deterministic|cloud|local-only/i.test(
      await page.locator("main").textContent(),
    ),
    "Main copy has no engineering terms",
  );
  check(
    (await page
      .getByRole("button", { name: "Desktop MCP", exact: true })
      .count()) === 0,
    "Advanced tools stay out of main navigation",
  );
  await add();
  check((await mutations()).length === 0, "Opening Add a TV is idle");
  check(
    (await dialog.getByRole("button", { name: /^Samsung / }).isVisible()) &&
      (await dialog.getByRole("button", { name: /^LG / }).isVisible()) &&
      (await dialog.getByRole("button", { name: /^Roku / }).isVisible()),
    "Guided brand choice",
  );
  check(
    (await dialog
      .getByRole("button", { name: "Continue with Samsung", exact: true })
      .count()) === 0,
    "Samsung setup hidden until chosen",
  );
  await dialog
    .getByRole("button", { name: "Not sure? Help me choose" })
    .click();
  await dialog.getByRole("button", { name: "Choose TV type" }).click();
  await dialog.getByRole("button", { name: /^LG / }).click();
  check(
    (await dialog.textContent()).includes(
      "This computer will search your home network.",
    ),
    "Current computer chosen despite two online computers",
  );
  check(
    (await dialog.getByLabel("Computer near your TV").count()) === 0,
    "Computer picker secondary until needed",
  );
  check(
    (await dialog.getByLabel("Message", { exact: true }).count()) === 0,
    "Chat stays closed by default",
  );
  await page.screenshot({
    path: join(qa, "simple-setup-lg-ready-phone.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.__fixture.holdSearch = true;
  });
  await dialog.getByRole("button", { name: "Find TVs", exact: true }).click();
  await dialog
    .getByRole("status")
    .filter({ hasText: "Looking for TVs" })
    .waitFor();
  check(
    (await mutations()).at(-1).action.helperId === "fixture-helper",
    "Explicit Find uses current computer ID",
  );
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 0,
    "Search does not connect",
  );
  await page.waitForFunction(() => !!window.__fixture.releaseSearch);
  await page.evaluate(() => {
    window.__fixture.releaseSearch();
    window.__fixture.holdSearch = false;
  });
  await dialog
    .getByRole("heading", { name: "1 TV found", exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: /Cloud LG fixture.*Choose/ })
    .click();
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 0,
    "Named choice still requires explicit Connect TV",
  );
  await dialog.getByRole("button", { name: "Connect TV", exact: true }).click();
  await dialog
    .locator(".connection-outcome .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 1,
    "Connect TV sends one connection action",
  );
  check(
    !(await mutations()).some(
      (c) => c.op === "press" || c.action?.type === "send_tv_command",
    ),
    "Verification never sends a button test",
  );
  check(
    await dialog
      .getByRole("heading", { name: "Connection activity", exact: true })
      .isVisible(),
    "Recorded activity visible after search",
  );
  await page.screenshot({
    path: join(qa, "simple-setup-lg-connected-phone.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Need help?", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Ask StreamGPT", exact: true })
    .click();
  await dialog.getByLabel("Message", { exact: true }).fill("Help me connect");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await dialog
    .locator(".sheet-notice")
    .filter({ hasText: "could not finish" })
    .waitFor();
  await close();
  await nav("Remote");
  await page.getByRole("button", { name: "Volume up", exact: true }).click();
  await page
    .locator(".command-feedback")
    .filter({ hasText: "accepted" })
    .waitFor();
  check(
    (await mutations()).at(-1).action.command === "volume_up",
    "Optional assistant failure leaves deterministic controls usable",
  );
  check(
    !(await mutations()).some((c) => c.command === "controller"),
    "Linked buttons never fall back to this-computer commands",
  );
  await nav("Your TVs");
  await page
    .getByRole("button", { name: "Choose Samsung fixture", exact: true })
    .click();
  await nav("Remote");
  await page.getByRole("button", { name: "Volume up", exact: true }).click();
  await page
    .locator(".command-feedback")
    .filter({ hasText: "accepted" })
    .waitFor();
  check(
    (await mutations()).at(-1).action.component === "speaker-two",
    "Samsung retains discovered component",
  );
  await nav("Your TVs");
  await add("Samsung");
  check(
    (await dialog.textContent()).includes("SmartThings"),
    "Samsung explains phone prerequisite",
  );
  await dialog
    .getByRole("button", { name: "Continue with Samsung", exact: true })
    .click();
  await dialog
    .locator(".sheet-notice")
    .filter({ hasText: "Samsung setup opened" })
    .waitFor();
  check(
    (await mutations()).at(-1).op === "open_remote",
    "Samsung uses fixed native browser command",
  );
  await close();
  await add("LG");
  await dialog
    .getByRole("button", { name: "Change computer", exact: true })
    .click();
  await dialog.getByLabel("Computer near your TV").selectOption("other-pc");
  check(
    (await dialog.textContent()).includes(
      "Office PC will search your home network.",
    ),
    "Optional computer choice is named plainly",
  );
  await page.evaluate(() => {
    window.__fixture.emptySearch = true;
  });
  await dialog.getByRole("button", { name: "Find TVs", exact: true }).click();
  await dialog
    .getByRole("heading", { name: "No TVs found this time.", exact: true })
    .waitFor();
  check(
    (await mutations()).at(-1).action.helperId === "other-pc",
    "Explicit other-computer choice preserves its ID",
  );
  check(
    (await dialog.textContent()).includes(
      "does not mean your TV is unsupported",
    ),
    "Empty search gives recovery without compatibility claim",
  );
  check(
    await dialog
      .getByRole("button", { name: "Try again", exact: true })
      .isVisible(),
    "Empty search offers retry",
  );
  await page.evaluate(() => {
    window.__fixture.emptySearch = false;
    window.__fixture.failSearch = true;
  });
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await dialog
    .getByRole("heading", { name: "The search could not finish.", exact: true })
    .waitFor();
  checks++;
  await close();
  await nav("Settings");
  await page
    .getByRole("button", { name: "Use remote on this computer", exact: true })
    .click();
  check(
    (await mutations()).filter((c) => c.op === "discover").length === 0,
    "Advanced local mode does not auto-scan",
  );
  await add("Roku");
  await dialog.getByRole("button", { name: "Need help?", exact: true }).click();
  await dialog
    .getByText("Enter the TV address on this computer", { exact: true })
    .click();
  await dialog.getByLabel("TV type").selectOption("roku");
  for (const invalid of ["169.254.3.4", "192.168.001.40"]) {
    await dialog.getByLabel("TV local network address").fill(invalid);
    await dialog
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    check(
      (await mutations()).filter((c) => c.op === "add").length === 0,
      "Manual IP validation " + invalid,
    );
  }
  await dialog.getByLabel("TV local network address").fill("192.168.1.40");
  await dialog.getByLabel("TV name", { exact: true }).fill("Manual Roku");
  await dialog
    .getByRole("button", { name: "Save address", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Saved TV: Manual Roku", exact: true })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.op === "pair").length === 0,
    "Save address does not connect",
  );
  check(
    !(await calls())
      .filter((c) => c.command === "cloud_command")
      .some((c) => JSON.stringify(c).includes("192.168.1.40")),
    "Manual IP never sent to cloud",
  );
  await dialog.getByRole("button", { name: "Connect TV", exact: true }).click();
  await dialog
    .locator(".verification")
    .filter({ hasText: "Status read" })
    .first()
    .waitFor();
  assert.deepEqual(
    (await mutations())
      .filter((c) => c.command === "controller")
      .map((c) => c.op),
    ["add", "pair", "inspect"],
  );
  checks++;
  await page.evaluate(() => {
    window.__fixture.discoveryBrand = "roku";
  });
  await dialog.getByRole("button", { name: "Find TVs", exact: true }).click();
  await dialog
    .getByRole("button", { name: /Local discovery fixture.*Choose/ })
    .click();
  await dialog
    .locator(".candidate-confirm")
    .getByRole("button", { name: "Connect TV", exact: true })
    .click();
  await dialog
    .locator(".connection-outcome .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.op === "add").length === 1,
    "Rediscovered saved TV reused by host and brand",
  );
  await close();
  await nav("Remote");
  await page.getByRole("button", { name: "Play / pause", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .locator(".command-feedback")
    .filter({ hasText: "accepted" })
    .waitFor();
  check(
    (await mutations()).at(-1).op === "press",
    "Keyboard remote uses only selected computer route",
  );
  await page.evaluate(() => {
    window.__fixture.failInspect = true;
  });
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "could not finish" })
    .waitFor();
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isDisabled(),
    "Failed local inspect disables cached route",
  );
  await page.evaluate(() => {
    window.__fixture.failInspect = false;
  });
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await page
    .locator(".verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isEnabled(),
    "Explicit status read recovers local route",
  );
  await nav("Settings");
  await page.getByRole("button", { name: "Desktop MCP", exact: true }).click();
  await page.getByText("synthetic MCP config", { exact: true }).waitFor();
  checks++;
  await page
    .getByRole("button", { name: "Back to Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use ChatGPT with your phone", exact: true })
    .click();
  await nav("Settings");
  await page
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Account disconnected" })
    .waitFor();
  await nav("Your TVs");
  check(
    (await page
      .getByRole("button", { name: "Choose Samsung fixture", exact: true })
      .count()) === 0,
    "Disconnect clears account TVs",
  );
  // Fresh first-run phone onboarding. Only Tauri is mocked; UI start/open sequencing is real.
  await page.goto(origin + "/?unlinked");
  await page
    .getByRole("heading", { name: "Your first TV starts here.", exact: true })
    .waitFor();
  check((await mutations()).length === 0, "First run opens idle");
  await add("LG");
  await dialog
    .getByRole("button", { name: "Connect to ChatGPT", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Finish in your browser", exact: true })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.op === "start").length === 1 &&
      (await mutations()).filter((c) => c.op === "open_approval").length === 1,
    "Explicit phone link starts once and auto-opens approval once",
  );
  check(
    (await dialog
      .getByRole("button", { name: "Connect to ChatGPT", exact: true })
      .count()) === 0,
    "Pending view cannot issue another code",
  );
  check(
    (await dialog.textContent()).includes("same StreamGPT account") &&
      (await dialog.textContent()).includes("comparison only"),
    "Pending explains sign-in, comparison, approval and return",
  );
  check(
    (await dialog.locator("input").count()) === 0,
    "Comparison code is not an entry field",
  );
  await page.screenshot({
    path: join(qa, "simple-setup-approval-phone.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Continue in browser", exact: true })
    .click();
  await dialog
    .locator(".sheet-notice")
    .filter({ hasText: "Continue in your browser" })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.op === "open_approval").length === 2 &&
      (await mutations()).filter((c) => c.op === "start").length === 1,
    "Manual browser fallback never generates another code",
  );
  await page.evaluate(() => window.__fixture.setLinked(true));
  await dialog.getByRole("button", { name: "Find TVs", exact: true }).waitFor();
  check(
    !(await mutations()).some((c) => c.action?.type === "discover_local"),
    "Account approval never auto-starts discovery",
  );
  await close();
  // Independent status polling and stale-authority regressions.
  await nav("Settings");
  await page.evaluate(() => {
    window.__fixture.holdSnapshot = true;
  });
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await page.waitForFunction(() => !!window.__fixture.releaseSnapshot);
  const pendingSnapshots = (await calls()).filter(
    (c) => c.command === "cloud_command" && c.op === "snapshot",
  ).length;
  await page.evaluate(() => {
    window.__fixture.nativePhase = "started";
  });
  await page
    .getByRole("button", { name: "Connection diagnostics", exact: true })
    .click();
  await page.getByText(/^Status read.*started$/).waitFor();
  check(
    (await calls()).filter(
      (c) => c.command === "cloud_command" && c.op === "snapshot",
    ).length === pendingSnapshots,
    "Native status progresses while snapshot pending",
  );
  await page.evaluate(() => {
    window.__fixture.failSnapshot = true;
    window.__fixture.releaseSnapshot(true);
  });
  await page
    .getByRole("status")
    .filter({ hasText: "TV list is temporarily unavailable" })
    .waitFor();
  await nav("Remote");
  check(
    (await page.locator(".native-control-surface button:enabled").count()) ===
      0,
    "Failed account snapshot clears cloud controls",
  );
  await page.evaluate(() => {
    window.__fixture.failSnapshot = false;
  });
  await nav("Settings");
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await nav("Your TVs");
  await page
    .getByRole("button", { name: "Choose Roku fixture", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.__fixture.setOffline(true);
  });
  await nav("Settings");
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await nav("Remote");
  await page.waitForFunction(
    () => document.querySelector('button[aria-label="Home"]')?.disabled,
  );
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isDisabled(),
    "Offline current computer disables its TV buttons",
  );
  await nav("Your TVs");
  await page.screenshot({
    path: join(qa, "simple-setup-your-tvs-phone.png"),
    fullPage: true,
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "TV list has no overflow " + width,
    );
    await add("LG");
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Setup sheet has no overflow " + width,
    );
    await close();
  }
  await page.screenshot({
    path: join(qa, "simple-setup-your-tvs-desktop.png"),
    fullPage: true,
  });
  // Pending on launch is resumed, with no automatic browser action or extra code.
  await page.goto(origin + "/?unlinked&pending");
  await page
    .getByRole("button", { name: "Continue setup", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Finish in your browser", exact: true })
    .waitFor();
  check(
    (await mutations()).length === 0,
    "Resuming pending setup opens no browser and creates no code",
  );
  await close();
  await page.evaluate(() => {
    window.__fixture.setLinked(true);
    window.__fixture.setOffline(true);
  });
  await nav("Settings");
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await nav("Your TVs");
  await page
    .getByRole("button", { name: "Choose Roku fixture", exact: true })
    .waitFor();
  await add("LG");
  await dialog
    .getByText("Office PC will search your home network.", { exact: true })
    .waitFor();
  check(
    (await dialog.getByLabel("Computer near your TV").count()) === 0,
    "Sole other online computer is chosen with a named sentence",
  );
  await close();
  await page.evaluate(() =>
    window.__fixture.base.helpers.push({
      id: "third-pc",
      name: "Bedroom PC",
      platform: "windows",
      online: true,
    }),
  );
  await nav("Settings");
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await nav("Your TVs");
  await add("LG");
  await dialog.getByLabel("Computer near your TV").waitFor();
  check(
    (await dialog.getByLabel("Computer near your TV").inputValue()) === "",
    "Ambiguous online computers require a named choice",
  );
  check(
    (await dialog.getByLabel("Computer near your TV").textContent()).includes(
      "This computer - Home PC - offline",
    ),
    "Current offline computer remains labelled clearly",
  );
  await page.keyboard.press("Escape");
  check(
    await page
      .getByRole("button", { name: "Add a TV", exact: true })
      .evaluate((el) => el === document.activeElement),
    "Escape closes sheet and restores Add a TV focus",
  );
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `Native guided UI: ${checks} checks passed; mocked Tauri only, zero browser errors and zero real TV/provider actions.`,
  );
} finally {
  await browser.close();
}
