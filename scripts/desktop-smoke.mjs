import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Native WebView2 + OS keyring + loopback integration. No scans or TV commands.
// Run only against your own build; the debug port exists for this process only.
const exe = path.resolve("src-tauri/target/release/streamgpt-local.exe");
const port = 9338;
const processHandle = spawn(exe, [], {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: "ignore",
});
let browser, client;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Native WebView2 did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page
    .getByRole("heading", { name: "Every screen. One place." })
    .waitFor();
  await page.getByRole("button", { name: "Connect AI", exact: true }).click();
  await page.locator("pre").filter({ hasText: "mcpServers" }).waitFor();
  assert.ok((await page.locator("pre").innerText()).includes("--mcp"));
  client = new Client({ name: "native-readonly-smoke", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: exe, args: ["--mcp"], stderr: "pipe" }),
  );
  const response = await client.callTool({ name: "list_tvs", arguments: {} });
  assert.notEqual(
    response.isError,
    true,
    "Native MCP could not reach the running desktop controller",
  );
  const value = JSON.parse(response.content[0].text);
  assert.ok(Array.isArray(value.devices));
  assert.equal("keys" in value, false);
  await page
    .getByRole("button", { name: /Devices/ })
    .first()
    .click();
  await page.screenshot({ path: "docs/native-window.png", fullPage: true });
  console.log(
    "Native desktop: WebView2 rendered; Rust IPC returned config; OS vault and authenticated MCP snapshot passed. No TV calls.",
  );
} finally {
  await client?.close();
  await browser?.close();
  processHandle.kill();
}
