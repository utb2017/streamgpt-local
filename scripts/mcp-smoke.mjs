import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// No TV operation: this verifies the native executable with an independent SDK.
const executable =
  process.argv[2] ??
  path.resolve("src-tauri/target/release/streamgpt-local.exe");
const client = new Client({ name: "streamgpt-local-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: executable,
  args: ["--mcp"],
  stderr: "pipe",
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "get_tv_status",
    "list_tvs",
    "press_tv_button",
  ]);
  assert.equal(
    tools.find((t) => t.name === "press_tv_button").annotations.idempotentHint,
    true,
  );
  const invalid = await client.callTool({
    name: "list_tvs",
    arguments: { op: "pair" },
  });
  assert.equal(invalid.isError, true);
  const unknown = await client.callTool({ name: "pair_tv", arguments: {} });
  assert.equal(unknown.isError, true);
  console.log(
    "Native MCP: initialized; three tools; injection and unknown tool rejected. No device calls.",
  );
} finally {
  await client.close();
}
