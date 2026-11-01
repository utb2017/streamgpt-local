import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Monitor,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Radio,
  Settings2,
  Command,
  Power,
  Home,
  CornerUpLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Minus,
  ChevronRight,
  Check,
  Copy,
  Search,
  X,
  RefreshCw,
  Loader2,
  ShieldCheck,
  Wifi,
  Rewind,
  FastForward,
} from "lucide-react";
import type { Snapshot, Device, Input, Candidate, Button } from "../shared";
import "./style.css";
const demo = new URLSearchParams(location.search).get("demo") === "1";
const sample: Snapshot = {
  version: "0.1.2",
  cloud: "not_connected",
  mcpConfig: JSON.stringify(
    {
      mcpServers: {
        "streamgpt-local": { command: "StreamGPT Local", args: ["--mcp"] },
      },
    },
    null,
    2,
  ),
  receipts: [],
  devices: [
    {
      id: "a",
      name: "Living room",
      host: "192.168.1.24",
      brand: "lg",
      model: "LG webOS",
      paired: true,
      reachable: true,
    },
    {
      id: "b",
      name: "Upstairs",
      host: "192.168.1.31",
      brand: "roku",
      model: "Roku Ultra",
      paired: true,
      reachable: false,
    },
  ],
};
const blank: Snapshot = {
  version: "0.1.2",
  cloud: "not_connected",
  mcpConfig: "",
  receipts: [],
  devices: [],
};
function App() {
  const [data, setData] = useState(demo ? sample : blank),
    [selected, setSelected] = useState(demo ? "a" : ""),
    [tab, setTab] = useState("devices"),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(false),
    [searched, setSearched] = useState(false),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [brand, setBrand] = useState<"lg" | "roku">("lg"),
    [host, setHost] = useState(""),
    [name, setName] = useState(""),
    [copied, setCopied] = useState(false);
  const device = data.devices.find((d) => d.id === selected) ?? data.devices[0];
  async function call(input: Input) {
    if (demo) {
      setNotice("Preview only. No commands are sent to a TV.");
      return;
    }
    if (busy) return;
    setBusy(input.op);
    setNotice(
      input.op === "pair"
        ? data.devices.find((d) => d.id === input.deviceId)?.brand === "roku"
          ? "Checking your Roku over the home network. No on-screen pairing prompt is expected."
          : "Look at your LG TV and approve the connection request."
        : "",
    );
    try {
      const value = await invoke<any>("controller", { input });
      if (value?.devices) setData(value);
      else if (value?.snapshot) setData(value.snapshot);
      if (input.op === "discover") {
        setCandidates(value);
        setSearched(true);
        setNotice(
          value.length
            ? "Choose your TV below. We found its network address for you."
            : "No TVs answered yet. Turn on your TV and check it uses the same home router as this PC, then search again.",
        );
      }
      if (input.op === "add") {
        setModal(false);
        setSelected(value.devices.at(-1)?.id);
        setNotice(
          'Device saved. Click "Connect this TV" to check the connection.',
        );
      }
      if (input.op === "pair") setNotice("Connected. Your remote is ready.");
      if (value?.receipt) setNotice(value.receipt.message);
      return value;
    } catch (e) {
      setNotice(
        typeof e === "string"
          ? e
          : "Could not complete the request. Check that your TV is on and on the same network.",
      );
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!demo) void call({ op: "snapshot" });
  }, []);
  function startSetup() {
    if (busy) return;
    setModal(true);
    setCandidates([]);
    setSearched(false);
    void call({ op: "discover" });
  }
  const press = (button: Button) => {
    if (device)
      void call({
        op: "press",
        deviceId: device.id,
        button,
        requestId: crypto.randomUUID(),
      });
  };
  const control = (
    button: Button,
    label: string,
    icon: React.ReactNode,
    cls = "",
  ) => (
    <button
      className={`key ${cls}`}
      aria-label={label}
      title={label}
      disabled={!device?.paired || !!busy}
      onClick={() => press(button)}
    >
      {icon}
    </button>
  );
  const dot = (on: boolean) => <span className={`dot ${on ? "on" : ""}`} />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brandmark">
            <Radio size={24} />
          </span>
          <span>
            streamgpt<span className="local-word">LOCAL</span>
          </span>
        </a>
        <div className="side-label">YOUR SPACE</div>
        <nav>
          {[
            ["devices", "Devices", Monitor],
            ["activity", "Activity", Radio],
            ["connect", "Connect AI", Command],
          ].map(([id, label, Icon]: any) => (
            <button
              className={tab === id ? "nav active" : "nav"}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {id === "devices" && (
                <span className="nav-count">
                  {data.devices.length.toString().padStart(2, "0")}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={19} />
            <strong>At home. In control.</strong>
            <p>TV pairing stays on this computer. You choose what connects.</p>
          </div>
          <button className="nav" onClick={() => setTab("settings")}>
            <Settings2 size={17} /> Settings & about
          </button>
          <div className="build">
            STREAMGPT LOCAL <span>V{data.version}</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Your space <ChevronRight size={12} />
            <span>
              {tab === "connect"
                ? "Connect AI"
                : tab === "settings"
                  ? "Settings"
                  : tab === "activity"
                    ? "Activity"
                    : "Devices"}
            </span>
          </div>
          <div className="header-right">
            {demo && (
              <span className="demo-tag">
                INTERACTIVE PREVIEW · SAMPLE DEVICES
              </span>
            )}
            <span className="pill">{dot(true)} Local companion</span>
            <span className="avatar">S</span>
          </div>
        </header>
        <section className="page">
          <div className="title-row">
            <div>
              <div className="eyebrow">LESS FRICTION. MORE LIVING.</div>
              <h1>
                {tab === "devices"
                  ? "Every screen. One place."
                  : tab === "connect"
                    ? "Meet your new remote."
                    : tab === "activity"
                      ? "Nothing behind the scenes."
                      : "Made to stay close."}
              </h1>
              <p className="subtitle">
                {tab === "devices"
                  ? "A quieter way to connect with the screens around you."
                  : tab === "connect"
                    ? "Give your desktop AI a direct line to the TVs you approve."
                    : tab === "activity"
                      ? "A local record of requests. No automatic command retries."
                      : "A small companion for the things you already own."}
              </p>
            </div>
            {tab === "devices" && (
              <button
                className="primary"
                disabled={!!busy}
                onClick={startSetup}
              >
                <Plus size={17} /> Add a device
              </button>
            )}
          </div>
          {notice && (
            <div className="notice" role="status">
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Radio size={16} />
              )}
              <span>{notice}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {tab === "devices" && (
            <>
              <div className="workspace">
                <section className="devices-panel">
                  <div className="section-label">
                    <span>YOUR DEVICES</span>
                    <span>
                      {data.devices.length.toString().padStart(2, "0")}
                    </span>
                  </div>
                  <div className="device-list">
                    {data.devices.map((d) => (
                      <button
                        className={
                          "device-card " +
                          (device?.id === d.id ? "selected" : "")
                        }
                        key={d.id}
                        onClick={() => setSelected(d.id)}
                      >
                        <div className={"device-art " + d.brand}>
                          <div className="mini-tv">
                            <div className="mini-orbit" />
                            <span>{d.brand === "lg" ? "webOS" : "Roku"}</span>
                          </div>
                        </div>
                        <div className="device-card-body">
                          <span className="device-brand">
                            {d.brand === "lg"
                              ? "LG WEBOS"
                              : "ROKU · EXPERIMENTAL"}
                          </span>
                          <h3>{d.name}</h3>
                          <div className="device-bottom">
                            <span>
                              {dot(d.reachable)}
                              {d.reachable
                                ? "Last seen online"
                                : d.paired
                                  ? "Saved connection"
                                  : "Ready to connect"}
                            </span>
                            <ArrowUpRight size={16} />
                          </div>
                        </div>
                      </button>
                    ))}
                    {!data.devices.length && (
                      <div className="empty-devices">
                        <Monitor size={32} />
                        <h3>A home for your screens.</h3>
                        <p>Add an LG webOS TV or Roku on your home network.</p>
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={startSetup}
                        >
                          Find my TV <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="add-dashed"
                    disabled={!!busy}
                    onClick={startSetup}
                  >
                    <Plus size={17} /> Make room for another screen
                  </button>
                  <div className="network-note">
                    <Wifi size={16} />
                    <p>
                      Wi-Fi or Ethernet.
                      <br />
                      <span>Just the same home network.</span>
                    </p>
                  </div>
                </section>
                <section className="remote-panel">
                  <div className="remote-heading">
                    <div>
                      <div className="eyebrow">
                        {device
                          ? device.brand === "lg"
                            ? "LG WEBOS REMOTE"
                            : "ROKU REMOTE"
                          : "YOUR REMOTE"}
                      </div>
                      <h2>{device?.name ?? "Within reach."}</h2>
                    </div>
                    <span className="remote-badge">
                      {device?.paired ? "PAIRED" : "NOT CONNECTED"}
                    </span>
                  </div>
                  <div className="remote-content">
                    <div className="screen-scene">
                      <div className="big-screen">
                        <div className="screen-texture" />
                        <div className="screen-word">
                          <span>LESS SCROLLING.</span>
                          <strong>More living.</strong>
                        </div>
                        <div className="screen-caption">
                          <span>STREAMGPT / LOCAL</span>
                          <Radio size={16} />
                        </div>
                      </div>
                      <div className="screen-base" />
                      <div className="screen-shadow" />
                      <div className="scene-description">
                        <span className="tiny-label">
                          {device?.model ?? "LG WEBOS + ROKU"}
                        </span>
                        <p>
                          {device?.paired
                            ? "Your remote, without the search."
                            : "Connect once. Keep it simple."}
                        </p>
                        <span className="muted">
                          {device?.host ?? "No television selected"}
                        </span>
                      </div>
                      {device && !device.paired && (
                        <button
                          className="primary connect-button"
                          disabled={!!busy}
                          onClick={() =>
                            call({ op: "pair", deviceId: device.id })
                          }
                        >
                          {busy === "pair" ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Radio size={16} />
                          )}{" "}
                          {busy === "pair"
                            ? device.brand === "roku"
                              ? "Checking Roku connection…"
                              : "Waiting for LG approval…"
                            : "Connect this TV"}
                        </button>
                      )}
                      {device?.paired && (
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            call({ op: "inspect", deviceId: device.id })
                          }
                        >
                          <RefreshCw size={13} /> Check connection
                        </button>
                      )}
                    </div>
                    <div className="remote-object">
                      <div className="remote-top">
                        {control("home", "Home", <Home size={19} />)}
                        <span className="remote-grip">•••</span>
                        {control(
                          "power_off",
                          "Power off",
                          <Power size={18} />,
                          "power",
                        )}
                      </div>
                      <div className="dpad">
                        {control("up", "Up", <ArrowUp size={20} />, "dir up")}
                        {control(
                          "left",
                          "Left",
                          <ArrowLeft size={20} />,
                          "dir left",
                        )}
                        {control("select", "Select", <span>OK</span>, "ok")}
                        {control(
                          "right",
                          "Right",
                          <ArrowRight size={20} />,
                          "dir right",
                        )}
                        {control(
                          "down",
                          "Down",
                          <ArrowDown size={20} />,
                          "dir down",
                        )}
                      </div>
                      <div className="remote-mid">
                        {control("back", "Back", <CornerUpLeft size={19} />)}
                        {control("mute", "Mute toggle", <VolumeX size={19} />)}
                      </div>
                      <div className="media-row">
                        {control("rewind", "Rewind", <Rewind size={17} />)}
                        {control(
                          "play",
                          device?.brand === "roku"
                            ? "Play / pause toggle"
                            : "Play",
                          <Play size={19} />,
                        )}
                        {control(
                          "forward",
                          "Fast forward",
                          <FastForward size={17} />,
                        )}
                      </div>
                      <div className="volume-rocker">
                        {control(
                          "volume_down",
                          "Volume down",
                          <Minus size={18} />,
                        )}
                        <Volume2 size={16} />
                        {control("volume_up", "Volume up", <Plus size={18} />)}
                      </div>
                      {device?.brand === "lg" &&
                        control(
                          "pause",
                          "Pause",
                          <Pause size={15} />,
                          "pause-key",
                        )}
                      <div className="remote-signature">
                        streamgpt<span>LOCAL</span>
                      </div>
                    </div>
                  </div>
                  <div className="remote-foot">
                    <ShieldCheck size={14} />
                    <span>
                      Direct to your TV. Commands are never automatically
                      repeated.
                    </span>
                  </div>
                </section>
              </div>
              <div className="bottom-strip">
                <div>
                  <Command size={24} />
                  <div>
                    <h3>Your voice. Your remote.</h3>
                    <p>
                      Connect a desktop MCP client to your approved devices.
                    </p>
                  </div>
                </div>
                <button
                  className="text-button"
                  onClick={() => setTab("connect")}
                >
                  Set up AI control <ArrowUpRight size={17} />
                </button>
              </div>
            </>
          )}
          {tab === "connect" && (
            <div className="info-grid">
              <section className="info-card">
                <Command size={32} />
                <h2>
                  One connection.
                  <br />A few well-chosen tools.
                </h2>
                <p>
                  Keep StreamGPT Local open. Copy this configuration into a
                  desktop MCP client that supports local servers, then restart
                  that client.
                </p>
                <div className="tool-list">
                  {[
                    "discover_tvs",
                    "list_tvs",
                    "get_tv_status",
                    "press_tv_button",
                  ].map((t) => (
                    <code key={t}>
                      {t}
                      <ArrowUpRight size={14} />
                    </code>
                  ))}
                </div>
                <p className="muted">
                  Your AI can find nearby TVs and use approved TVs. Adding,
                  pairing and removing devices stays in this app.
                </p>
              </section>
              <section className="info-card">
                <div className="section-label">
                  DESKTOP MCP CONFIGURATION{" "}
                  <button
                    className="text-button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(data.mcpConfig);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre>
                  {data.mcpConfig ||
                    "Open the installed desktop app to generate your configuration."}
                </pre>
                <div className="soft-note">
                  <h3>What about ChatGPT on my phone?</h3>
                  <p>
                    This release provides local desktop MCP. Connecting the
                    hosted StreamGPT phone app needs an authenticated cloud
                    relay; that connection is not enabled in this release.
                  </p>
                </div>
              </section>
            </div>
          )}
          {tab === "activity" && (
            <section className="info-card activity">
              <div className="section-label">
                RECENT REQUESTS <span>STORED LOCALLY</span>
              </div>
              {data.receipts.length ? (
                data.receipts.map((r) => (
                  <div className="receipt" key={r.id}>
                    <Radio size={18} />
                    <div>
                      <strong>{r.button.replaceAll("_", " ")}</strong>
                      <p>{r.message}</p>
                    </div>
                    <span>{r.status}</span>
                    <time>{new Date(r.at).toLocaleTimeString()}</time>
                  </div>
                ))
              ) : (
                <div className="empty-activity">
                  <Radio size={36} />
                  <h2>A clean slate.</h2>
                  <p>Your remote requests will appear here.</p>
                </div>
              )}
            </section>
          )}
          {tab === "settings" && (
            <div className="info-grid">
              <section className="info-card">
                <ShieldCheck size={32} />
                <h2>
                  Small footprint.
                  <br />
                  Clear boundaries.
                </h2>
                <p>
                  Tauri + Rust. React + TypeScript. No bundled Chromium. No
                  account required for local control.
                </p>
                <p>
                  Keep this app open while using MCP. This computer and your TVs
                  must be on the same network. There is no router port
                  forwarding.
                </p>
                <p>
                  Roku control is experimental. Its developer documentation
                  restricts third-party ECP use; this project does not grant
                  vendor permission.
                </p>
                <p>
                  Power-on from standby and app launching are not included in
                  this first release.
                </p>
              </section>
              <section className="info-card">
                <div className="section-label">SAVED DEVICES</div>
                {data.devices.map((d) => (
                  <div className="saved" key={d.id}>
                    <span>
                      {d.name}
                      <small>{d.host}</small>
                    </span>
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Forget ${d.name} and remove its local pairing?`,
                          )
                        )
                          void call({ op: "forget", deviceId: d.id });
                      }}
                    >
                      Forget <X size={14} />
                    </button>
                  </div>
                ))}
                <div className="soft-note">
                  <h3>StreamGPT Local / v{data.version}</h3>
                  <p>
                    Designed and built by Aaron Tomlinson.
                    <br />
                    Open source. Made for the living room.
                  </p>
                </div>
              </section>
            </div>
          )}
          <footer>
            <span>CONTROL, WITHOUT THE CLUTTER.</span>
            <span>
              LG WEBOS <b> / </b> ROKU <b> / </b> MCP
            </span>
          </footer>
        </section>
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setModal(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">A LITTLE CLOSER</div>
            <h2 id="add-title">Let’s find your TV.</h2>
            <p>
              Turn on your TV. We’ll look for it on your home network—no network
              address to type.
            </p>
            <p>
              Your PC can stay on Ethernet while your TV uses Wi-Fi on the same
              router. Avoid a guest network.
            </p>
            <button
              className="secondary wide"
              disabled={!!busy}
              onClick={() => call({ op: "discover" })}
            >
              {busy === "discover" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <Search size={17} />
              )}{" "}
              {busy === "discover"
                ? "Listening on your network…"
                : "Search again"}
            </button>
            {candidates.map((c) => (
              <button
                className="candidate"
                key={c.host}
                disabled={!!busy}
                onClick={() => {
                  void call({
                    op: "add",
                    host: c.host,
                    brand: c.brand,
                    name: c.name,
                  });
                }}
              >
                <Monitor size={18} />
                {c.name}
                <small>
                  {c.model ?? (c.brand === "roku" ? "Roku" : "LG webOS")}
                </small>
                <Plus size={16} />
              </button>
            ))}
            {searched && candidates.length > 0 && (
              <p>
                Choose yours to add it, then click Connect this TV on the remote
                screen.
              </p>
            )}
            <details className="manual-setup">
              <summary>Can’t find it? Connection help</summary>
              <p>
                Keep the TV on. Use the same home router as this PC, not guest
                Wi-Fi. Click Search again after checking.
              </p>
              <p>
                If discovery still cannot find it, you can enter its IP address
                below. That is the TV’s address on your home network, like
                192.168.1.40—not your email, password or an address to invent.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void call({
                    op: "add",
                    brand,
                    host: host.trim(),
                    name: name.trim() || (brand === "lg" ? "LG TV" : "Roku"),
                  });
                }}
              >
                <label>
                  TV type
                  <select
                    value={brand}
                    onChange={(e) => setBrand(e.target.value as any)}
                  >
                    <option value="lg">LG webOS</option>
                    <option value="roku">Roku · experimental</option>
                  </select>
                </label>
                <label>
                  Local IP address
                  <input
                    placeholder="192.168.1.40"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Make it yours
                  <input
                    placeholder="Living room"
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <small className="form-help">
                  {brand === "roku"
                    ? "On the TV screen, use your Roku remote to open Settings → Network → About. Copy the number labeled IP address here. These are the Roku’s settings, not this PC app’s Settings & about page. Roku network control must be enabled (Control by mobile apps); no LG-style approval prompt is expected."
                    : "On the TV screen, use your LG remote to open its Network settings and find the IP address. These are the TV’s settings, not this PC app’s settings. When you connect, approve the request on your LG TV."}
                </small>
                <p className="form-help">
                  Choose your TV type and enter its IP. Click Add device here,
                  then Connect this TV on the remote screen.
                </p>
                <button className="primary wide" disabled={!!busy}>
                  Add device <ArrowRight size={17} />
                </button>
              </form>
            </details>
            {notice && (
              <p className="modal-notice" role="status">
                {notice}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
