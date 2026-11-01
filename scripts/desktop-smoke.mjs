import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
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
    .getByRole("heading", { name: "Your TVs." })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Desktop MCP", exact: true }).click();
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
  const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('cloud_command', {input:{op:'status'}}));
  assert.ok(['not_connected','pending','offline','connected'].includes(before.status));
  assert.equal('token' in before,false);
  await page.getByRole('button',{name:'Your TVs',exact:true}).click();
  await page.getByRole('button',{name:'Add a TV',exact:true}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'What kind of TV?',exact:true}).waitFor();
  const after = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('cloud_command', {input:{op:'status'}}));
  assert.deepEqual(after.activity,before.activity,'Opening Add a TV dispatched native work');
  await fs.mkdir('.local',{recursive:true});
  await page.screenshot({ path: ".local/native-window.png", fullPage: true });
  execFileSync('powershell.exe',['-NoProfile','-Command',`
    $owned = Get-Process -Id ([int]$env:STREAMGPT_SMOKE_PID)
    if ($owned.Path -ne [IO.Path]::GetFullPath($env:STREAMGPT_SMOKE_EXE)) { throw 'Unexpected native test process' }
    Add-Type -Namespace StreamGPTSmoke -Name Window -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr w, System.IntPtr l);'
    if (-not [StreamGPTSmoke.Window]::PostMessage($owned.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Could not close owned test window' }
  `],{windowsHide:true,env:{...process.env,STREAMGPT_SMOKE_PID:String(processHandle.pid),STREAMGPT_SMOKE_EXE:exe},stdio:'pipe'});
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(processHandle.exitCode,null,'Closing the window exited the helper');
  const hiddenResult=await client.callTool({name:'list_tvs',arguments:{}});
  assert.notEqual(hiddenResult.isError,true,'Tray helper stopped serving read-only MCP');
  console.log(
    "Native desktop: WebView2, Rust cloud/controller IPC, idle Add a TV setup, OS vault, authenticated MCP and close-to-tray passed. No TV calls.",
  );
} finally {
  await client?.close();
  await browser?.close();
  processHandle.kill();
}
