import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Radio,
  Monitor,
  Command,
  Home,
  CornerUpLeft,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  Rewind,
  FastForward,
  Search,
  Plus,
  Minus,
  Power,
  VolumeX,
  RefreshCw,
  Copy,
  X,
} from "lucide-react";
import type {
  Snapshot,
  Device,
  Input,
  Candidate,
  Button,
  CloudSnapshot,
  CloudStatus,
  CloudInput,
  CloudAction,
  CloudCandidate,
} from "../shared";
import {
  AccountSnapshots,
  cloudLinked,
  cloudSelected,
  cloudButton,
  targetLabel,
  verificationLabel,
  keyLabel,
  localKeys,
  localAddress,
  advertised,
  activityLabel,
  type KeyId,
} from "./connection-model";
import "./style.css";
const blank: Snapshot = {
  devices: [],
  receipts: [],
  version: "0.2.0",
  mcpConfig: "",
  cloud: "not_connected",
};
const unlinked: CloudStatus = {
  status: "not_connected",
  helperId: null,
  platform: "windows",
  message: "",
  pending: null,
  activity: [],
};
const demo = new URLSearchParams(location.search).get("demo") === "1";
const icons: Partial<Record<KeyId, React.ReactNode>> = {
  home: <Home size={20} />,
  back: <CornerUpLeft size={20} />,
  up: <ArrowUp size={20} />,
  down: <ArrowDown size={20} />,
  left: <ArrowLeft size={20} />,
  right: <ArrowRight size={20} />,
  select: <span>OK</span>,
  play: <Play size={20} />,
  pause: <Pause size={20} />,
  rewind: <Rewind size={20} />,
  forward: <FastForward size={20} />,
  volume_up: <Plus size={20} />,
  volume_down: <Minus size={20} />,
  mute: <VolumeX size={20} />,
  unmute: <VolumeX size={20} />,
  power_off: <Power size={20} />,
  power_on: <Power size={20} />,
  channel_up: <Plus size={20} />,
  channel_down: <Minus size={20} />,
};
function App() {
  const [data, setData] = useState(blank),
    [status, setStatus] = useState(unlinked),
    [cloudSnapshot, setCloud] = useState<CloudSnapshot | null>(null);
  const [tab, setTab] = useState<"remote" | "agent" | "mcp" | "activity">(
      "remote",
    ),
    [localMode, setLocalMode] = useState(false),
    [localSelected, setLocalSelected] = useState("");
  const [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(
      demo ? "Preview only. No connection evidence supplied." : "",
    ),
    [feedback, setFeedback] = useState("");
  const [helperName, setHelperName] = useState("This computer"),
    [helperId, setHelperId] = useState(""),
    [message, setMessage] = useState("");
  const [localCandidates, setLocalCandidates] = useState<Candidate[]>([]),
    [searched, setSearched] = useState(false),
    [candidate, setCandidate] = useState<Candidate | CloudCandidate | null>(
      null,
    );
  const [brand, setBrand] = useState<"roku" | "lg">("lg"),
    [host, setHost] = useState(""),
    [name, setName] = useState(""),
    [localVerification, setLocalVerification] = useState<{
      id: string;
      at: number;
    } | null>(null);
  const store = useRef(new AccountSnapshots()),
    lock = useRef(false),
    live = useRef(true),
    epoch = useRef(0),
    reading = useRef(false),
    snapshotReading = useRef<number | null>(null);
  const cloud =
    cloudSnapshot && status.status === "offline"
      ? {
          ...cloudSnapshot,
          helpers: cloudSnapshot.helpers?.map((h) =>
            h.id === status.helperId ? { ...h, online: false } : h,
          ),
        }
      : cloudSnapshot;
  const linked = cloudLinked(status),
    useLocal = !linked || localMode,
    localDevice = data.devices.find((d) => d.id === localSelected),
    cloudDevice = cloudSelected(cloud);
  const online = cloud?.helpers?.filter((h) => h.online) || [],
    chosenHelper = online.some((h) => h.id === helperId)
      ? helperId
      : online.length === 1
        ? online[0].id
        : "";
  const native = (input: Input) => invoke<any>("controller", { input });
  const callCloud = (input: CloudInput) =>
    invoke<any>("cloud_command", { input });
  const publish = (value: unknown, generation: number) => {
    if (live.current && store.current.accept(value, generation)) {
      setCloud(store.current.current);
      setNotice((previous) =>
        previous.startsWith("Account snapshot unavailable.")
          ? "Account refreshed."
          : previous,
      );
    }
  };
  function clearAccount() {
    store.current.reset();
    setCloud(null);
    setCandidate(null);
    setFeedback("");
    setMessage("");
    setHelperId("");
    setLocalMode(false);
    setStatus((s) => ({ ...s, activity: [] }));
  }
  function adoptStatus(value: CloudStatus) {
    if (
      !value ||
      !["not_connected", "pending", "offline", "connected"].includes(
        value.status,
      )
    )
      throw new Error("Invalid status");
    if (store.current.scope(value)) {
      setCloud(null);
      setCandidate(null);
      setFeedback("");
      setMessage("");
      setHelperId("");
      setLocalMode(false);
    }
    setStatus(value);
  }
  function invalidateCloud(generation: number) {
    if (!live.current || generation !== store.current.generation) return;
    store.current.invalidate();
    setCloud(null);
    setCandidate(null);
    setFeedback("");
    setMessage("");
  }
  async function readCloud(generation: number, current: number) {
    if (snapshotReading.current === generation) return;
    snapshotReading.current = generation;
    try {
      const value = await callCloud({ op: "snapshot" });
      if (live.current && current === epoch.current) publish(value, generation);
    } catch {
      if (
        live.current &&
        current === epoch.current &&
        generation === store.current.generation
      ) {
        invalidateCloud(generation);
        setNotice(
          "Account snapshot unavailable. Cached cloud controls have been cleared. Refresh account to check again.",
        );
      }
    } finally {
      if (snapshotReading.current === generation)
        snapshotReading.current = null;
    }
  }
  async function refresh() {
    if (demo || reading.current) return;
    reading.current = true;
    const current = epoch.current;
    try {
      const next = (await callCloud({ op: "status" })) as CloudStatus;
      if (!live.current || current !== epoch.current) return;
      adoptStatus(next);
      if (cloudLinked(next)) {
        void readCloud(store.current.generation, current);
      }
    } catch {
      if (live.current && current === epoch.current)
        setNotice("Account refresh unavailable. No TV action was retried.");
    } finally {
      reading.current = false;
    }
  }
  function applyLocal(value: any): Snapshot | undefined {
    const next =
      value?.snapshot || (Array.isArray(value?.devices) ? value : undefined);
    if (next && live.current) {
      setData(next);
      return next;
    }
    return undefined;
  }
  async function run(
    label: string,
    work: () => Promise<void>,
    uncertain = false,
  ) {
    if (demo) {
      setNotice("Preview only. No operation sent.");
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setNotice(label);
    try {
      await work();
    } catch {
      setNotice(
        uncertain
          ? "Outcome unknown. Check status before trying again. Nothing was retried."
          : "Request unavailable. Deterministic controls remain available. Nothing was retried.",
      );
      if (uncertain) setFeedback("Outcome uncertain. No automatic replay.");
    } finally {
      lock.current = false;
      if (live.current) setBusy("");
    }
  }
  async function action(value: CloudAction) {
    await run(
      value.type === "connect_local"
        ? "Connection requested. Check your TV and approve the connection if it asks."
        : "Requesting " +
            (activityLabel[value.type] || "account operation").toLowerCase() +
            "…",
      async () => {
        const generation = store.current.generation,
          next = await callCloud({ op: "action", action: value });
        publish(next, generation);
        if (generation !== store.current.generation) return;
        if (value.type === "send_tv_command")
          setFeedback(
            next?.receipt?.requestId === value.requestId
              ? `${next.receipt.status}. TV execution is not confirmed.`
              : "No matching receipt. Check status before trying again.",
          );
        setNotice("Snapshot updated. Review recorded evidence.");
      },
      value.type === "send_tv_command" || value.type === "connect_local",
    );
  }
  useEffect(() => {
    live.current = true;
    if (!demo) {
      void native({ op: "snapshot" })
        .then((v) => {
          if (live.current) applyLocal(v);
        })
        .catch(() => {
          if (live.current)
            setNotice("Local controller unavailable in this preview.");
        });
      void refresh();
    }
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => {
      live.current = false;
      clearInterval(timer);
      epoch.current++;
      store.current.reset();
    };
  }, []);
  async function find() {
    setCandidate(null);
    if (!useLocal) {
      if (chosenHelper)
        await action({ type: "discover_local", helperId: chosenHelper });
      return;
    }
    await run("Discovery requested from local controller…", async () => {
      const result = await native({ op: "discover" });
      if (!Array.isArray(result)) throw new Error("Invalid scan");
      setLocalCandidates(result);
      setSearched(true);
      setNotice(
        result.length
          ? "Choose a named TV, then confirm Connect TV."
          : "No TVs answered. Check the TV and network, then Find TVs again.",
      );
    });
  }
  async function checkLocal(device: Device) {
    setLocalVerification(null);
    let result;
    try {
      result = await native({ op: "inspect", deviceId: device.id });
    } catch (error) {
      // The controller records the failed read as unreachable. Disable the cached route.
      setData((previous) => ({
        ...previous,
        devices: previous.devices.map((d) =>
          d.id === device.id ? { ...d, reachable: false } : d,
        ),
      }));
      throw error;
    }
    applyLocal(result);
    if (result?.info || result?.state || result?.status) {
      setLocalVerification({ id: device.id, at: Date.now() });
      setNotice("Status read. No button was used as a test.");
    } else {
      setLocalVerification(null);
      setNotice("Saved; status not verified. No status evidence returned.");
    }
  }
  async function pairLocal(device: Device) {
    setLocalVerification(null);
    await run(
      device.brand === "lg"
        ? "Connection requested. Check your LG TV and approve the connection if it asks."
        : "Checking Roku network control. No LG prompt is expected.",
      async () => {
        applyLocal(await native({ op: "pair", deviceId: device.id }));
        setNotice("Connection returned. Reading status without a button test…");
        await checkLocal(device);
      },
      true,
    );
  }
  async function connectCandidate() {
    if (!candidate) return;
    if ("candidateId" in candidate) {
      const current = cloud?.candidates?.find(
        (c) =>
          c.candidateId === candidate.candidateId &&
          c.helperId === candidate.helperId,
      );
      if (
        !current ||
        !cloud?.helpers?.some((h) => h.id === current.helperId && h.online)
      ) {
        setCandidate(null);
        setNotice("Candidate expired or helper offline. Find TVs again.");
        return;
      }
      setCandidate(null);
      await action({
        type: "connect_local",
        helperId: current.helperId,
        candidateId: current.candidateId,
      });
      return;
    }
    const chosen = candidate;
    setCandidate(null);
    await run(
      chosen.brand === "lg"
        ? "Connection requested. Check your LG TV and approve the connection if it asks."
        : "Checking Roku network control.",
      async () => {
        const existing = data.devices.find(
          (d) => d.host === chosen.host && d.brand === chosen.brand,
        );
        const next = existing
          ? undefined
          : applyLocal(
              await native({
                op: "add",
                host: chosen.host,
                brand: chosen.brand,
                name: chosen.name,
              }),
            );
        const added =
          existing ||
          next?.devices.find(
            (d) => d.host === chosen.host && d.brand === chosen.brand,
          );
        if (!added) throw new Error("No saved device");
        setLocalSelected(added.id);
        setLocalVerification(null);
        applyLocal(await native({ op: "pair", deviceId: added.id }));
        await checkLocal(added);
      },
      true,
    );
  }
  async function press(id: KeyId) {
    if (!useLocal) {
      const command = cloudButton(cloud, id, crypto.randomUUID());
      if (command) await action(command);
      return;
    }
    if (
      !localDevice?.paired ||
      !localDevice.reachable ||
      !localKeys(localDevice).includes(id as Button)
    )
      return;
    await run(
      "Sending one local command…",
      async () => {
        const result = await native({
          op: "press",
          deviceId: localDevice.id,
          button: id as Button,
          requestId: crypto.randomUUID(),
        });
        applyLocal(result);
        setFeedback(
          result?.receipt?.status
            ? `${result.receipt.status}. Physical execution is not confirmed.`
            : "No receipt. Check status before trying again.",
        );
        setNotice("Command returned. Nothing was automatically repeated.");
      },
      true,
    );
  }
  function visible(id: KeyId) {
    if (useLocal) return localKeys(localDevice).includes(id as Button);
    if (!cloudDevice) return false;
    if (cloudDevice.provider === "local") return !!advertised(cloudDevice, id);
    return !!cloudButton(
      cloud
        ? {
            ...cloud,
            connection: { status: "connected" },
            samsungConnected: true,
          }
        : null,
      id,
      "layout",
    );
  }
  function key(id: KeyId, cls = "") {
    if (!visible(id)) return null;
    const disabled =
      !!busy ||
      (useLocal
        ? !localDevice?.paired || !localDevice.reachable
        : !cloudButton(cloud, id, "availability"));
    const label = keyLabel(useLocal ? localDevice : cloudDevice, id);
    return (
      <button
        key={id}
        className={"key " + cls}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => void press(id)}
      >
        {icons[id] || <span>■</span>}
        <span className="control-label">{label}</span>
      </button>
    );
  }
  const verification = useLocal
    ? localDevice
      ? !localDevice.reachable
        ? "Route unavailable; TV status not verified."
        : localVerification?.id === localDevice.id
          ? `Status read · ${new Date(localVerification.at).toLocaleTimeString()}. No button effect is confirmed.`
          : "Saved; status not verified."
      : "Choose a TV. Nothing will connect until you choose."
    : verificationLabel(cloud);
  const candidates = useLocal
    ? localCandidates
    : cloud?.candidates?.filter((c) =>
        cloud.helpers?.some((h) => h.id === c.helperId && h.online),
      ) || [];
  return (
    <div className="shell connection-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brandmark">
            <Radio size={23} />
          </span>
          <span>
            streamgpt<span className="local-word">LOCAL</span>
          </span>
        </a>
        <nav aria-label="App sections">
          {(
            [
              ["remote", "Remote", Monitor],
              ["agent", "Connection agent", Radio],
              ["mcp", "Desktop MCP", Command],
              ["activity", "Activity", Radio],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              aria-label={label}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>No automatic discovery, pairing or button retries.</p>
          <div className="build">
            STREAMGPT LOCAL <span>V{data.version}</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            StreamGPT /{" "}
            {tab === "agent"
              ? "Connection agent"
              : tab === "mcp"
                ? "Desktop MCP"
                : tab === "activity"
                  ? "Activity"
                  : "Remote"}
          </span>
          <span className="account-chip">
            {linked
              ? cloud?.identity.label || "Linked account"
              : "Local-only controller"}
          </span>
        </header>
        <section className="page">
          <div className="title-row">
            <div>
              <h1>
                {tab === "agent"
                  ? "Connect with clarity."
                  : tab === "mcp"
                    ? "Keep desktop MCP."
                    : tab === "activity"
                      ? "Recorded activity."
                      : "Your remote."}
              </h1>
              <p className="subtitle">
                {useLocal
                  ? "Local-only controller · TV network details stay on this computer."
                  : "Linked account · one cloud route for Samsung, Roku and LG."}
              </p>
            </div>
          </div>
          <div className="route-picker">
            <label htmlFor="tv-picker">Current TV and route</label>
            <div className="picker-actions">
              <select
                id="tv-picker"
                aria-label="Current TV and route"
                disabled={!!busy}
                value={useLocal ? localSelected : cloud?.selectedDeviceId || ""}
                onChange={(e) => {
                  setFeedback("");
                  setLocalVerification(null);
                  if (useLocal) setLocalSelected(e.target.value);
                  else if (e.target.value)
                    void action({
                      type: "select_tv",
                      deviceId: e.target.value,
                    });
                }}
              >
                <option value="">Choose TV</option>
                {useLocal
                  ? data.devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.brand.toUpperCase()} · local-only
                      </option>
                    ))
                  : cloud?.devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {targetLabel(cloud, d)}
                      </option>
                    ))}
              </select>
              <button className="primary" onClick={() => setTab("agent")}>
                Connection agent
              </button>
            </div>
            <p className="verification" aria-live="polite">
              {verification}
            </p>
          </div>
          {notice && (
            <div className="notice" role="status">
              <Radio size={16} />
              <span>{notice}</span>
            </div>
          )}
          {tab === "remote" && (
            <section className="remote-panel unified-remote">
              <div className="remote-heading">
                <div>
                  <h2>
                    {(useLocal ? localDevice?.name : cloudDevice?.label) ||
                      "Choose your TV"}
                  </h2>
                  <p>
                    {useLocal
                      ? "Local-only route"
                      : cloudDevice?.provider === "local"
                        ? `Via ${cloud?.helpers?.find((h) => h.id === cloudDevice.helperId)?.name || "home helper"}`
                        : "Samsung cloud route"}
                  </p>
                </div>
                <button
                  className="text-button"
                  disabled={!!busy || !(useLocal ? localDevice : cloudDevice)}
                  onClick={() =>
                    useLocal
                      ? localDevice &&
                        void run("Reading local status…", () =>
                          checkLocal(localDevice),
                        )
                      : void action({
                          type: "get_tv_status",
                          deviceId: cloudDevice?.id,
                        })
                  }
                >
                  <RefreshCw size={15} />
                  Check status
                </button>
              </div>
              <div className="native-control-surface">
                <div className="native-top-keys">
                  {key("home")}
                  {key("back")}
                  {key("power_on")}
                  {key("power_off")}
                </div>
                <div className="native-dpad">
                  {key("up", "up")}
                  {key("left", "left")}
                  {key("select", "center")}
                  {key("right", "right")}
                  {key("down", "down")}
                </div>
                <div className="native-media">
                  {key("rewind")}
                  {key("play")}
                  {key("pause")}
                  {key("forward")}
                  {key("stop")}
                </div>
                <div className="native-utilities">
                  {key("volume_down")}
                  {key("mute")}
                  {key("unmute")}
                  {key("volume_up")}
                  {key("channel_down")}
                  {key("channel_up")}
                </div>
              </div>
              {feedback && (
                <p className="command-feedback" role="status">
                  {feedback}
                </p>
              )}
              <p className="remote-foot">
                Only supported controls. A receipt does not confirm a physical
                TV effect.
              </p>
            </section>
          )}
          {tab === "agent" && (
            <section
              className="agent-layout"
              aria-label="Connection agent panel"
            >
              <div className="agent-title">
                <h2>Connection agent</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("remote")}
                >
                  Close panel <X size={15} />
                </button>
              </div>
              <p>
                Nothing will connect until you choose. Closing this panel does
                not cancel a dispatched operation.
              </p>
              <div className="link-status">
                <h3>
                  {linked
                    ? "StreamGPT account linked"
                    : "Link this computer to StreamGPT"}
                </h3>
                <p>
                  {linked
                    ? `${cloud?.identity.label || "Linked account"} · Helper ${status.status === "connected" ? "online" : "offline"}`
                    : "Local-only controls remain available without an account link."}
                </p>
                {!linked && (
                  <>
                    <label>
                      Computer name
                      <input
                        value={helperName}
                        maxLength={80}
                        onChange={(e) => setHelperName(e.target.value)}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Starting account link…", async () => {
                          epoch.current++;
                          clearAccount();
                          await callCloud({
                            op: "start",
                            name: helperName.trim() || "This computer",
                          });
                          await refresh();
                          setNotice(
                            "Match the human code in your browser and approve this computer.",
                          );
                        })
                      }
                    >
                      Link account
                    </button>
                  </>
                )}
                {status.pending && (
                  <div className="pending-link">
                    <strong>Approval code: {status.pending.userCode}</strong>
                    <p>
                      Expires{" "}
                      {new Date(status.pending.expiresAt).toLocaleTimeString()}.
                      Match this code in the browser.
                    </p>
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Opening approval browser…", async () => {
                          await callCloud({ op: "open_approval" });
                          setNotice(
                            "Browser approval requested. Match the code before approving.",
                          );
                        })
                      }
                    >
                      Open browser
                    </button>
                  </div>
                )}
                {linked && (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Disconnecting helper account…", async () => {
                        epoch.current++;
                        clearAccount();
                        await callCloud({ op: "disconnect" });
                        await refresh();
                        setNotice(
                          "Helper account disconnected. Account-specific view cleared.",
                        );
                      })
                    }
                  >
                    Disconnect account
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void refresh()}
                >
                  Refresh account
                </button>
              </div>
              {linked && (
                <div className="mode-choice">
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => {
                      setLocalMode(!localMode);
                      setCandidate(null);
                      setFeedback("");
                      setLocalVerification(null);
                    }}
                  >
                    {localMode
                      ? "Use linked cloud remote"
                      : "Use local-only controller"}
                  </button>
                  <p>
                    Switch explicitly. A failed cloud request never falls back
                    to local commands.
                  </p>
                </div>
              )}
              <h3>
                {useLocal
                  ? "Local-only TV setup"
                  : "Find TVs through an online helper"}
              </h3>
              {!useLocal && (
                <label>
                  Discovery helper
                  <select
                    aria-label="Discovery helper"
                    value={chosenHelper}
                    disabled={!!busy}
                    onChange={(e) => setHelperId(e.target.value)}
                  >
                    <option value="">Choose an online helper</option>
                    {cloud?.helpers?.map((h) => (
                      <option disabled={!h.online} key={h.id} value={h.id}>
                        {h.name} · {h.online ? "online" : "offline"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="agent-button-row">
                <button
                  className="secondary"
                  disabled={!!busy || (!useLocal && !chosenHelper)}
                  onClick={() => void find()}
                >
                  <SearchIcon />
                  Find TVs
                </button>
                {linked && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Opening Samsung setup…", async () => {
                        await callCloud({ op: "open_remote" });
                        setNotice(
                          "Browser setup requested. Use the same StreamGPT account to connect Samsung.",
                        );
                      })
                    }
                  >
                    Connect Samsung
                  </button>
                )}
              </div>
              {candidates.map((c) => (
                <button
                  className="candidate"
                  key={
                    "candidateId" in c
                      ? c.helperId + ":" + c.candidateId
                      : c.host
                  }
                  disabled={!!busy}
                  onClick={() => setCandidate(c)}
                >
                  <Monitor size={17} />
                  {c.name}
                  <small>
                    {c.brand.toUpperCase()}
                    {c.model ? " · " + c.model : ""}
                  </small>
                  <span>Choose</span>
                </button>
              ))}
              {useLocal && searched && !candidates.length && (
                <p>
                  No TVs answered. Find TVs again after checking the network.
                </p>
              )}
              {candidate && (
                <section
                  className="candidate-confirm"
                  role="dialog"
                  aria-label="Confirm TV connection"
                >
                  <h3>Connect {candidate.name}?</h3>
                  <p>
                    {candidate.brand === "lg"
                      ? "Check your LG TV and approve the connection if it asks."
                      : "Roku network control will be checked. No LG-style approval prompt is expected."}
                  </p>
                  <div className="agent-button-row">
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => setCandidate(null)}
                    >
                      Cancel choice
                    </button>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => void connectCandidate()}
                    >
                      Connect TV
                    </button>
                  </div>
                </section>
              )}
              {useLocal && localDevice && (
                <section className="saved-choice">
                  <h3>Saved TV: {localDevice.name}</h3>
                  <p>{verification}</p>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void pairLocal(localDevice)}
                  >
                    Connect TV
                  </button>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Reading local status…", () =>
                        checkLocal(localDevice),
                      )
                    }
                  >
                    Check status
                  </button>
                </section>
              )}
              {useLocal && (
                <details className="manual-setup">
                  <summary>Connection help · local-only</summary>
                  <p>
                    Use the same home router, not guest Wi-Fi. The TV's local
                    network address is in its Network settings. It stays on this
                    computer and is not included in cloud actions or assistant
                    messages.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!localAddress(host.trim())) {
                        setNotice(
                          "Enter the TV’s private IPv4 address, for example 192.168.1.40.",
                        );
                        return;
                      }
                      void run("Saving local address…", async () => {
                        const next = applyLocal(
                          await native({
                            op: "add",
                            host: host.trim(),
                            brand,
                            name: name.trim() || `${brand.toUpperCase()} TV`,
                          }),
                        );
                        const added = next?.devices.find(
                          (d) => d.host === host.trim() && d.brand === brand,
                        );
                        if (added) setLocalSelected(added.id);
                        setLocalVerification(null);
                        setNotice(
                          "Address saved locally. Choose Connect TV; status is not verified.",
                        );
                      });
                    }}
                  >
                    <label>
                      TV type
                      <select
                        value={brand}
                        onChange={(e) =>
                          setBrand(e.target.value as "roku" | "lg")
                        }
                      >
                        <option value="lg">LG</option>
                        <option value="roku">Roku</option>
                      </select>
                    </label>
                    <label>
                      TV local network address
                      <input
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="192.168.1.40"
                        required
                      />
                    </label>
                    <label>
                      TV name
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={60}
                      />
                    </label>
                    <button className="secondary" disabled={!!busy}>
                      Save address
                    </button>
                  </form>
                </details>
              )}
              <section className="assistant-panel">
                <h3>Ask the assistant</h3>
                <p>
                  Assistant replies are separate from tool activity. Buttons
                  work without inference.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = message.trim();
                    if (!text || !linked) return;
                    if (
                      text
                        .match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)
                        ?.some(localAddress)
                    ) {
                      setNotice(
                        "Use Connection help for TV network addresses. They stay local.",
                      );
                      return;
                    }
                    void run("Requesting an assistant turn…", async () => {
                      const generation = store.current.generation;
                      publish(
                        await callCloud({
                          op: "ask",
                          message: text,
                          requestId: crypto.randomUUID(),
                        }),
                        generation,
                      );
                      setNotice(
                        "Assistant response returned. Review its reply and recorded activity.",
                      );
                    });
                  }}
                >
                  <label>
                    Message
                    <input
                      value={message}
                      maxLength={600}
                      disabled={!!busy || !linked}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={!!busy || !linked || !message.trim()}
                  >
                    Ask
                  </button>
                </form>
                <h4>Assistant reply</h4>
                <p className="assistant-reply">
                  {cloud?.resident?.reply ||
                    "No assistant reply has been received."}
                </p>
              </section>
              <p className="verification">{verification}</p>
              <button className="secondary" onClick={() => setTab("remote")}>
                Use remote
              </button>
            </section>
          )}
          {tab === "mcp" && (
            <section className="info-card">
              <h2>Desktop MCP configuration</h2>
              <p>
                Existing local desktop MCP stays available. Keep StreamGPT Local
                open while using an approved desktop MCP client.
              </p>
              <pre>
                {data.mcpConfig ||
                  "Open the installed app to load its MCP configuration."}
              </pre>
              <button
                className="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(data.mcpConfig)
                    .then(() => setNotice("MCP configuration copied."))
                    .catch(() =>
                      setNotice("Select and copy the configuration above."),
                    )
                }
              >
                <Copy size={16} />
                Copy configuration
              </button>
              <p>
                Phone ChatGPT uses your linked StreamGPT account and the running
                helper. iOS companion: Mac build / TestFlight preparation; no
                background-operation promise.
              </p>
            </section>
          )}
          {(tab === "agent" || tab === "activity") && (
            <section className="recorded-activity">
              <details open={tab === "activity"}>
                <summary>Activity</summary>
                <h3>Account activity</h3>
                <p>Recorded requests and their returned results.</p>
                <ol>
                  {[...(cloud?.activity || [])]
                    .sort((a, b) => a.seq - b.seq)
                    .slice(-30)
                    .map((a) => (
                      <li key={a.seq}>
                        <strong>
                          {activityLabel[a.op] || "Account operation"} ·{" "}
                          {a.phase}
                        </strong>
                        <span>
                          {new Date(a.at).toLocaleTimeString()}
                          {a.outcome ? " · " + a.outcome : ""}
                        </span>
                      </li>
                    ))}
                </ol>
                {!cloud?.activity?.length && (
                  <p>No recorded account activity.</p>
                )}
                <h3>On this computer</h3>
                <p>Recorded work from this helper.</p>
                <ol>
                  {[...(status.activity || [])]
                    .sort((a, b) => a.seq - b.seq)
                    .slice(-30)
                    .map((a) => (
                      <li key={a.seq}>
                        <strong>
                          {activityLabel[a.op] || "Local request"} · {a.phase}
                        </strong>
                        <span>{new Date(a.at).toLocaleTimeString()}</span>
                      </li>
                    ))}
                </ol>
                {!status.activity?.length && (
                  <p>No recorded helper activity.</p>
                )}
              </details>
            </section>
          )}
          <footer>
            <span>YOUR TV. YOUR CHOICE.</span>
            <span>No automatic command retries.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
function SearchIcon() {
  return <Search size={16} />;
}
createRoot(document.getElementById("root")!).render(<App />);
