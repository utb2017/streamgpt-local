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
    let linked = true,
      pending = false,
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
            return [
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
          if (a.type === "discover_local")
            base.candidates = [
              {
                helperId: helper,
                candidateId: "candidate-lg",
                name: "Cloud LG fixture",
                brand: "lg",
              },
            ];
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
  const agent = async () =>
    page
      .getByRole("button", { name: "Connection agent", exact: true })
      .last()
      .click();
  const remote = async () =>
    page.getByRole("button", { name: "Remote", exact: true }).click();
  await page.goto("http://127.0.0.1:5198/");
  await page
    .getByLabel("Current TV and route")
    .getByRole("option", { name: /Roku fixture/ })
    .waitFor({ state: "attached" });
  check((await mutations()).length === 0, "Opening app is read-only");
  check(
    (await page.getByLabel("Current TV and route").textContent()).includes(
      "via Home PC",
    ),
    "Picker shows cloud route",
  );
  check(
    (await page
      .getByRole("button", { name: "Power off", exact: true })
      .count()) === 0,
    "Roku has no invented power",
  );
  await agent();
  check((await mutations()).length === 0, "Opening agent does not discover");
  await page.getByRole("button", { name: "Find TVs", exact: true }).click();
  await page.getByRole("button", { name: /Cloud LG fixture.*Choose/ }).click();
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 0,
    "Candidate selection is not connection",
  );
  await page.getByRole("button", { name: "Cancel choice" }).click();
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 0,
    "Cancel does not connect",
  );
  await page.getByRole("button", { name: /Cloud LG fixture.*Choose/ }).click();
  await page.getByRole("button", { name: "Connect TV", exact: true }).click();
  await page
    .locator(".route-picker .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.action?.type === "connect_local")
      .length === 1,
    "Confirmed cloud connection sends exactly one action",
  );
  check(
    !(await mutations()).some(
      (c) => c.op === "press" || c.action?.type === "send_tv_command",
    ),
    "Connect verification uses no press",
  );
  await page.getByLabel("Message", { exact: true }).fill("Help me connect");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Deterministic controls remain available" })
    .waitFor();
  await remote();
  await page.getByRole("button", { name: "Volume up", exact: true }).click();
  await page
    .locator(".command-feedback")
    .filter({ hasText: "accepted" })
    .waitFor();
  const sent = (await mutations()).filter(
    (c) => c.action?.type === "send_tv_command",
  );
  check(
    sent.length === 1 && sent[0].action.command === "volume_up",
    "AI failure leaves one deterministic cloud button",
  );
  check(
    !(await mutations()).some((c) => c.command === "controller"),
    "Cloud clicks never fall back to controller",
  );
  await page.getByLabel("Current TV and route").selectOption("samsung");
  await page.getByRole("button", { name: "Volume up", exact: true }).click();
  await page.locator(".command-feedback").waitFor();
  check(
    (await mutations()).at(-1).action.component === "speaker-two",
    "Samsung uses actual component",
  );
  await agent();
  await page
    .getByRole("button", { name: "Connect Samsung", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Browser setup requested" })
    .waitFor();
  check(
    (await mutations()).at(-1).op === "open_remote",
    "Samsung setup uses fixed native browser operation",
  );
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  check(
    await page
      .getByRole("heading", { name: "Account activity", exact: true })
      .isVisible(),
    "Account activity separate",
  );
  check(
    await page
      .getByRole("heading", { name: "On this computer", exact: true })
      .isVisible(),
    "Helper activity separate",
  );
  check(
    !(await page.locator(".recorded-activity").textContent()).includes(
      "domain-fixture",
    ),
    "Technical run IDs not in consumer view",
  );
  await agent();
  await page.getByRole("button", { name: "Use local-only controller" }).click();
  check(
    (await mutations()).filter((c) => c.op === "discover").length === 0,
    "Local-only switch does not scan",
  );
  await page.getByText("Connection help", { exact: false }).click();
  await page.getByLabel("TV local network address").fill("192.168.1.40");
  await page.getByLabel("TV name", { exact: true }).fill("Manual Roku");
  await page.getByLabel("TV type").selectOption("roku");
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await page.getByRole("heading", { name: "Saved TV: Manual Roku" }).waitFor();
  check(
    (await mutations()).filter((c) => c.op === "pair").length === 0,
    "Saving address does not pair",
  );
  check(
    !(await calls())
      .filter((c) => c.command === "cloud_command")
      .some((c) => JSON.stringify(c).includes("192.168.1.40")),
    "Manual address never sent to cloud",
  );
  await page.getByRole("button", { name: "Connect TV", exact: true }).click();
  await page
    .locator(".route-picker .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  const localOps = (await mutations())
    .filter((c) => c.command === "controller")
    .map((c) => c.op);
  assert.deepEqual(localOps, ["add", "pair", "inspect"]);
  checks++;
  await remote();
  await page.getByRole("button", { name: "Play / pause", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .locator(".command-feedback")
    .filter({ hasText: "accepted" })
    .waitFor();
  check(
    (await mutations()).at(-1).op === "press",
    "Local keyboard button uses only local route",
  );
  await page.evaluate(() => {
    window.__fixture.failInspect = true;
  });
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Request unavailable" })
    .waitFor();
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isDisabled(),
    "Failed local status read disables cached local controls",
  );
  await page.evaluate(() => {
    window.__fixture.failInspect = false;
  });
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await page
    .locator(".route-picker .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isEnabled(),
    "Explicit successful status read restores local route",
  );
  await agent();
  await page.evaluate(() => {
    window.__fixture.discoveryBrand = "roku";
  });
  const addsBefore = (await mutations()).filter((c) => c.op === "add").length;
  await page.getByRole("button", { name: "Find TVs", exact: true }).click();
  await page
    .getByRole("button", { name: /Local discovery fixture.*Choose/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect TV", exact: true })
    .click();
  await page
    .locator(".route-picker .verification")
    .filter({ hasText: "Status read" })
    .waitFor();
  check(
    (await mutations()).filter((c) => c.op === "add").length === addsBefore,
    "Rediscovered saved host and brand reuses device without Add",
  );
  await page.getByRole("button", { name: "Desktop MCP", exact: true }).click();
  await page.getByText("synthetic MCP config", { exact: true }).waitFor();
  checks++;
  await agent();
  await page.getByRole("button", { name: "Use linked cloud remote" }).click();
  await page
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Account-specific view cleared" })
    .waitFor();
  check(
    !(await page.getByLabel("Current TV and route").textContent()).includes(
      "Samsung fixture",
    ),
    "Disconnect clears account picker",
  );
  check(
    await page.getByLabel("Message", { exact: true }).isDisabled(),
    "Disconnect disables assistant and clears reply",
  );
  await page.getByRole("button", { name: "Link account", exact: true }).click();
  await page.getByText("Approval code: FIXTURE-123", { exact: true }).waitFor();
  check(
    await page.getByLabel("Message", { exact: true }).isDisabled(),
    "Pending approval is not linked",
  );
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Browser approval requested" })
    .waitFor();
  check(
    (await mutations()).at(-1).op === "open_approval",
    "Approval opens fixed native operation",
  );
  await page.evaluate(() => {
    window.__fixture.setLinked(true);
    window.__fixture.base.devices[0].label = "New account Roku";
    window.__fixture.base.activity = [];
    delete window.__fixture.base.verification;
  });
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await page
    .getByLabel("Current TV and route")
    .getByRole("option", { name: /New account Roku/ })
    .waitFor({ state: "attached" });
  checks++;
  await page.getByLabel("Current TV and route").selectOption("fixture-roku");
  await agent();
  await page.evaluate(() => {
    window.__fixture.holdSnapshot = true;
  });
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await page.waitForFunction(() => !!window.__fixture.releaseSnapshot);
  const snapshotCalls = (await calls()).filter(
    (c) => c.command === "cloud_command" && c.op === "snapshot",
  ).length;
  await page.evaluate(() => {
    window.__fixture.nativePhase = "started";
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByText(/^Status read.*started$/).waitFor();
  check(
    (await calls()).filter(
      (c) => c.command === "cloud_command" && c.op === "snapshot",
    ).length === snapshotCalls,
    "Native status activity advances while a single cloud snapshot remains pending",
  );
  await page.evaluate(() => {
    window.__fixture.failSnapshot = true;
    window.__fixture.releaseSnapshot(true);
  });
  await page
    .getByRole("status")
    .filter({ hasText: "Cached cloud controls have been cleared" })
    .waitFor();
  await remote();
  check(
    !(await page.getByLabel("Current TV and route").textContent()).includes(
      "New account Roku",
    ),
    "Failed account snapshot clears cached picker and command authority",
  );
  check(
    (await page.locator(".native-control-surface button:enabled").count()) ===
      0,
    "No cloud buttons enabled after snapshot failure",
  );
  await page.evaluate(() => {
    window.__fixture.failSnapshot = false;
    window.__fixture.nativePhase = "completed";
  });
  await agent();
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await page
    .getByLabel("Current TV and route")
    .getByRole("option", { name: /New account Roku/ })
    .waitFor({ state: "attached" });
  await page.evaluate(() => window.__fixture.setOffline(true));
  await agent();
  await page
    .getByRole("button", { name: "Refresh account", exact: true })
    .click();
  await page.getByText("Linked account", { exact: false }).first().waitFor();
  await remote();
  await page.waitForFunction(
    () => document.querySelector('button[aria-label="Home"]')?.disabled,
  );
  check(
    await page.getByRole("button", { name: "Home", exact: true }).isDisabled(),
    "Own offline helper disables local-cloud buttons despite cached inventory",
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "No overflow " + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(qa, "connection-native-phone.png"),
    fullPage: true,
  });
  await agent();
  await page.screenshot({
    path: join(qa, "connection-native-agent-phone.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `Native mock UI: ${checks} checks passed. No backend, account, discovery or TV contacted.`,
  );
} finally {
  await browser.close();
}
