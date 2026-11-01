import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1340, height: 930 },
  });
  await context.addInitScript(() => {
    const data = {
      devices: [],
      receipts: [],
      version: "test",
      cloud: "not_connected",
      mcpConfig: "synthetic MCP config",
    };
    window.__testCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, { input }) => {
        if (command !== "controller") throw new Error("Unexpected command");
        window.__testCalls.push(input);
        if (input.op === "snapshot") return structuredClone(data);
        if (input.op === "discover")
          return [{ host: "192.168.1.10", brand: "lg", name: "Fixture LG" }];
        if (input.op === "add") {
          data.devices.push({
            id: "a58a53da-79bd-43c4-9334-56be70d4c5ad",
            host: input.host,
            brand: input.brand,
            name: input.name,
            model: "Synthetic LG",
            paired: false,
            reachable: false,
          });
          return structuredClone(data);
        }
        if (input.op === "pair") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          data.devices[0].paired = true;
          data.devices[0].reachable = true;
          return { snapshot: structuredClone(data) };
        }
        if (input.op === "press")
          return {
            snapshot: structuredClone(data),
            receipt: { message: "Synthetic command acknowledged." },
          };
        throw new Error("Unexpected operation");
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5198/");
  await page.getByRole("button", { name: "Add a device", exact: true }).click();
  await page.getByRole("button", { name: "Find nearby TVs" }).click();
  await page.getByRole("button", { name: /Fixture LG/ }).click();
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Volume up", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Connect this TV" }).click();
  await page.getByRole("button", { name: "Volume up", exact: true }).click();
  await page.getByText("Synthetic command acknowledged.").waitFor();
  const calls = await page.evaluate(() => window.__testCalls);
  assert.deepEqual(
    calls.map((c) => c.op),
    ["snapshot", "discover", "add", "pair", "press"],
  );
  assert.match(calls.at(-1).requestId, /^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Connect AI", exact: true }).click();
  await page.getByText("synthetic MCP config", { exact: true }).waitFor();
  // The manual Roku path must not inherit LG approval instructions.
  await page.reload();
  await page.getByRole("button", { name: "Add a device", exact: true }).click();
  await page.getByLabel("TV type").selectOption("roku");
  await page.getByText(/On your Roku, open Settings/).waitFor();
  await page.getByLabel("Local IP address").fill("192.168.1.20");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await page.getByRole("button", { name: "Connect this TV" }).click();
  await page
    .getByRole("button", { name: "Checking Roku connection…" })
    .waitFor();
  assert.equal(await page.getByText(/Waiting for LG approval/).count(), 0);
  await page.getByText("Connected. Your remote is ready.").waitFor();
  const rokuCalls = await page.evaluate(() => window.__testCalls);
  assert.equal(rokuCalls.find((c) => c.op === "add").brand, "roku");
  assert.equal(rokuCalls.filter((c) => c.op === "press").length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "UI: discovery, add, approval gate, one button request and MCP configuration passed with fixtures.",
  );
} finally {
  await browser.close();
}
