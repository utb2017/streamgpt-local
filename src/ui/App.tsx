import { connectionFailure, isAccountAuthError } from "./connection-failure";
import {
  controlBlocked,
  deviceEvidenceText,
  errorCode,
  recoveryText,
  rokuInstructions,
} from "./recovery";
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
  setupComputers,
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
  version: "0.2.1",
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
  const [tab, setTab] = useState<
      "tvs" | "remote" | "settings" | "mcp" | "activity"
    >("tvs"),
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
  const [setup, setSetup] = useState<
    null | "brand" | "samsung" | "lg" | "roku" | "help" | "account"
  >(null);
  const [helpOpen, setHelpOpen] = useState(false),
    [askOpen, setAskOpen] = useState(false),
    [changeComputer, setChangeComputer] = useState(false);
  const [searchOutcome, setSearchOutcome] = useState<
    "idle" | "searching" | "found" | "empty" | "failed"
  >("idle");
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [staleInventory, setStaleInventory] = useState(false);
  const [setupResult, setSetupResult] = useState<string | null>(null);
  const searchScope = useRef(0),
    sheet = useRef<HTMLDialogElement>(null),
    addEntry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Put the next instruction in view, including after a modal scroll. A TV
    // approval prompt must never be hidden above/below the visible sheet.
    const target = connectionNotice
      ? ".connection-progress"
      : candidate
        ? ".candidate-confirm"
        : null;
    if (target)
      sheet.current
        ?.querySelector(target)
        ?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [candidate, connectionNotice]);
  const store = useRef(new AccountSnapshots()),
    authLost = useRef(false),
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
  const { computers, selected: chosenHelper } = setupComputers(
    cloud,
    status,
    helperId,
  );
  const native = (input: Input) => invoke<any>("controller", { input });
  const callCloud = (input: CloudInput) =>
    invoke<any>("cloud_command", { input });
  const publish = (value: unknown, generation: number) => {
    if (
      live.current &&
      !authLost.current &&
      store.current.accept(value, generation)
    ) {
      setCloud(store.current.current);
      setStaleInventory(false);
      setNotice((previous) =>
        previous.startsWith("Your TV list is temporarily unavailable.")
          ? "Account refreshed."
          : previous,
      );
      return true;
    }
    return false;
  };
  function clearAccount() {
    authLost.current = false;
    setStaleInventory(false);
    store.current.reset();
    setCloud(null);
    setCandidate(null);
    setSearchOutcome("idle");
    setSetupResult(null);
    searchScope.current++;
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
      authLost.current = false;
      setStaleInventory(false);
      setCloud(null);
      setCandidate(null);
      setSearchOutcome("idle");
      setSetupResult(null);
      searchScope.current++;
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
    setSearchOutcome("idle");
    setSetupResult(null);
    searchScope.current++;
    setFeedback("");
    setMessage("");
  }
  async function readCloud(generation: number, current: number) {
    if (authLost.current || snapshotReading.current === generation) return;
    snapshotReading.current = generation;
    try {
      const value = await callCloud({ op: "snapshot" });
      if (live.current && current === epoch.current) publish(value, generation);
    } catch (error) {
      if (
        live.current &&
        current === epoch.current &&
        generation === store.current.generation
      ) {
        if (isAccountAuthError(error)) {
          authLost.current = true;
          invalidateCloud(generation);
          setNotice(
            "Link this helper to StreamGPT again. Disconnect and reconnect your account in Settings.",
          );
        } else {
          setStaleInventory(true);
          setNotice(
            "Your TV list is temporarily unavailable. Showing saved TVs; every action still checks your account. Refresh in Settings when ready.",
          );
        }
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
        setNotice(
          "We could not refresh your account. Please try again in Settings.",
        );
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
    uncertain: boolean | "connection" = false,
  ) {
    if (demo) {
      setNotice("Preview only. No operation sent.");
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setNotice(label);
    if (uncertain === "connection") setConnectionNotice(label);
    try {
      await work();
      if (uncertain === "connection") setConnectionNotice(null);
    } catch (error) {
      if (isAccountAuthError(error)) {
        authLost.current = true;
        invalidateCloud(store.current.generation);
        setNotice(
          "Link this helper to StreamGPT again. Disconnect and reconnect your account in Settings.",
        );
        return;
      }
      setNotice(
        uncertain === "connection"
          ? connectionFailure(error)
          : errorCode(error)
            ? recoveryText(error)
            : uncertain
              ? "Outcome unknown. Check status before trying again. Nothing was retried."
              : "That request could not finish. Please try again when you are ready.",
      );
      if (uncertain === "connection")
        setConnectionNotice(connectionFailure(error));
      if (uncertain === true)
        setFeedback(
          errorCode(error)
            ? recoveryText(error)
            : "Outcome uncertain. No automatic replay.",
        );
    } finally {
      lock.current = false;
      if (live.current) setBusy("");
    }
  }
  async function action(value: CloudAction) {
    let response: CloudSnapshot | undefined;
    await run(
      value.type === "connect_local"
        ? "Connection requested. Check your TV and approve the connection if it asks."
        : "Requesting " +
            (activityLabel[value.type] || "account operation").toLowerCase() +
            "…",
      async () => {
        const generation = store.current.generation,
          next = await callCloud({ op: "action", action: value });
        const accepted = publish(next, generation);
        if (generation !== store.current.generation) return;
        response = accepted ? store.current.current || undefined : undefined;
        if (value.type === "send_tv_command")
          setFeedback(
            next?.receipt?.requestId === value.requestId
              ? next.receipt.reason === "ROKU_CONTROL_DISABLED"
                ? recoveryText("ROKU_CONTROL_DISABLED")
                : `${next.receipt.status}. TV execution is not confirmed.`
              : "No matching receipt. Check status before trying again.",
          );
        setNotice("Updated. Check your TV status below.");
      },
      value.type === "connect_local"
        ? "connection"
        : value.type === "send_tv_command",
    );
    if (value.type === "connect_local" && !response) {
      // Reconcile saved inventory only. Never replay pairing or send a button.
      await readCloud(store.current.generation, epoch.current);
    }
    return response;
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
  useEffect(() => {
    const dialog = sheet.current;
    if (setup && dialog && !dialog.open) dialog.showModal();
    if (!setup && dialog?.open) {
      dialog.close();
      addEntry.current?.focus();
    }
  }, [setup]);
  function openSetup(next: NonNullable<typeof setup> = "brand") {
    searchScope.current++;
    setHelperId("");
    setCandidate(null);
    setSearchOutcome("idle");
    setSetupResult(null);
    setHelpOpen(false);
    setAskOpen(false);
    setChangeComputer(false);
    setNotice("");
    setSetup(next);
  }
  function chooseBrand(next: "samsung" | "lg" | "roku" | "help") {
    searchScope.current++;
    setCandidate(null);
    setSearchOutcome("idle");
    setSetupResult(null);
    setHelpOpen(false);
    setSetup(next);
  }
  async function startLink() {
    if (status.pending || linked || busy) return;
    setSetup((current) => current || "account");
    await run("Opening your account connection...", async () => {
      epoch.current++;
      clearAccount();
      await callCloud({
        op: "start",
        name: helperName.trim() || "This computer",
      });
      await refresh();
      try {
        await callCloud({ op: "open_approval" });
        setNotice(
          "Your browser was opened. Compare the code, approve this computer, then return here.",
        );
      } catch {
        setNotice(
          "Your connection code is ready. Choose Continue in browser to open the approval page.",
        );
      }
    });
  }
  async function find() {
    setConnectionNotice(null);
    if (busy || (!localMode && !linked) || (!useLocal && !chosenHelper)) return;
    const scope = ++searchScope.current,
      generation = store.current.generation;
    setCandidate(null);
    setSearchOutcome("searching");
    await run("Looking for TVs on the home network...", async () => {
      try {
        let found: Array<Candidate | CloudCandidate>;
        if (!useLocal) {
          const next = await callCloud({
            op: "action",
            action: { type: "discover_local", helperId: chosenHelper },
          });
          if (
            scope !== searchScope.current ||
            generation !== store.current.generation
          )
            return;
          publish(next, generation);
          found = (store.current.current?.candidates || []).filter(
            (c) => c.helperId === chosenHelper,
          );
        } else {
          const next = await native({ op: "discover" });
          if (scope !== searchScope.current) return;
          if (!Array.isArray(next)) throw Error("Invalid search result");
          found = next;
          setLocalCandidates(next);
        }
        const count = found.filter((c) => c.brand === setup).length;
        setSearchOutcome(count ? "found" : "empty");
        setNotice(
          count
            ? "Choose your TV below, then connect it."
            : "No TVs found this time. Check the TV and network, then try again.",
        );
      } catch (error) {
        if (scope === searchScope.current) setSearchOutcome("failed");
        throw error;
      }
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
        : "Reading Roku device information and permission. No button will be used as a test.",
      async () => {
        applyLocal(await native({ op: "pair", deviceId: device.id }));
        setNotice("Connection returned. Reading status without a button test…");
        await checkLocal(device);
        setSetupResult(device.id);
      },
      "connection",
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
        setNotice(
          "That TV choice has expired or the computer is offline. Find TVs again.",
        );
        return;
      }
      setCandidate(null);
      const scope = searchScope.current;
      const result = await action({
        type: "connect_local",
        helperId: current.helperId,
        candidateId: current.candidateId,
      });
      if (result?.selectedDeviceId && scope === searchScope.current)
        setSetupResult(result.selectedDeviceId);
      return;
    }
    const chosen = candidate;
    setCandidate(null);
    await run(
      chosen.brand === "lg"
        ? "Connection requested. Check your LG TV and approve the connection if it asks."
        : "Reading Roku device information and permission.",
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
        setSetupResult(added.id);
      },
      "connection",
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
      controlBlocked(localDevice) ||
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
            ? result.receipt.reason === "ROKU_CONTROL_DISABLED"
              ? recoveryText("ROKU_CONTROL_DISABLED")
              : `${result.receipt.status}. Physical execution is not confirmed.`
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
        ? !localDevice?.paired ||
          !localDevice.reachable ||
          controlBlocked(localDevice)
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
  const shownCandidates = [
    ...new Map(
      candidates
        .filter(
          (c) =>
            c.brand === setup &&
            (useLocal || ("helperId" in c && c.helperId === chosenHelper)),
        )
        .map((c) => [
          "candidateId" in c
            ? c.helperId + ":" + c.candidateId
            : c.brand + ":" + c.host,
          c,
        ]),
    ).values(),
  ];
  const tvs = useLocal
    ? [...new Map(data.devices.map((d) => [d.id, d])).values()]
    : [...new Map((cloud?.devices || []).map((d) => [d.id, d])).values()];
  const selectedId = useLocal ? localSelected : cloud?.selectedDeviceId;
  const selectedName = useLocal ? localDevice?.name : cloudDevice?.label;
  const computer = computers.find((c) => c.id === chosenHelper);
  const computerLabel = (id: string) => {
    const entry = computers.find((c) => c.id === id);
    if (!entry) return "Choose a computer";
    const duplicate = computers.filter((c) => c.name === entry.name);
    const name =
      entry.name +
      (duplicate.length > 1
        ? " (" + (duplicate.findIndex((c) => c.id === id) + 1) + ")"
        : "");
    return (id === status.helperId ? "This computer - " : "") + name;
  };
  function selectTv(id: string) {
    setFeedback("");
    setLocalVerification(null);
    if (useLocal) setLocalSelected(id);
    else void action({ type: "select_tv", deviceId: id });
  }
  function accountSetup() {
    return linked ? (
      <div className="connected-note">
        <strong>
          {authLost.current
            ? "Reconnect your account"
            : "Connected to your account"}
        </strong>
        <p>
          {authLost.current
            ? "Disconnect and reconnect your account in Settings to continue."
            : "Open StreamGPT in ChatGPT on your phone. Keep this computer awake to reach your TVs."}
        </p>
      </div>
    ) : status.pending ? (
      <section className="pending-link" aria-label="Browser approval">
        <h3>Finish in your browser</h3>
        <ol>
          <li>Sign in to the same StreamGPT account you use in ChatGPT.</li>
          <li>Compare this code with the code in your browser.</li>
          <li>Approve this computer, then return here.</li>
        </ol>
        <strong className="comparison-code">{status.pending.userCode}</strong>
        <p>This code is for comparison only. You do not need to type it.</p>
        <p className="fine-print">
          Expires at {new Date(status.pending.expiresAt).toLocaleTimeString()}.
        </p>
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            void run("Opening your browser...", async () => {
              await callCloud({ op: "open_approval" });
              setNotice("Continue in your browser, then return here.");
            })
          }
        >
          Continue in browser
        </button>
        <p>
          Waiting for your approval. This screen will update when you return.
        </p>
      </section>
    ) : (
      <section className="phone-connect">
        <h3>Use your TV from ChatGPT</h3>
        <p>
          Connect this computer to your StreamGPT account once. We will open
          your browser so you can sign in and approve it.
        </p>
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => void startLink()}
        >
          Connect to ChatGPT
        </button>
      </section>
    );
  }
  function activityView() {
    return (
      <section className="setup-activity">
        <h3>Connection activity</h3>
        <p>Recorded requests and results.</p>
        <ol>
          {(cloud?.activity || []).slice(-8).map((a) => (
            <li key={a.seq}>
              <strong>
                {activityLabel[a.op] || "Account request"} - {a.phase}
              </strong>
              <span>
                {new Date(a.at).toLocaleTimeString()}
                {a.outcome ? " - " + a.outcome : ""}
              </span>
            </li>
          ))}
        </ol>
        {!cloud?.activity?.length && <p>No account requests recorded yet.</p>}
        <details open={tab === "activity"}>
          <summary>On this computer</summary>
          <ol>
            {(status.activity || []).slice(-8).map((a) => (
              <li key={a.seq}>
                <strong>
                  {activityLabel[a.op] || "Connection request"} - {a.phase}
                </strong>
                <span>{new Date(a.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ol>
          {!status.activity?.length && (
            <p>No computer activity recorded yet.</p>
          )}
        </details>
      </section>
    );
  }
  function manualHelp() {
    return (
      <details className="manual-setup">
        <summary>Enter the TV address on this computer</summary>
        <p>
          Find the TV's local network address in its Network settings. Use the
          same home router, not guest Wi-Fi. This address stays on this
          computer.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!localAddress(host.trim())) {
              setNotice(
                "Enter a private IPv4 address, such as 192.168.1.40, without leading zeroes.",
              );
              return;
            }
            void run("Saving TV address...", async () => {
              const existing = data.devices.find(
                (d) => d.host === host.trim() && d.brand === brand,
              );
              const next = existing
                ? undefined
                : applyLocal(
                    await native({
                      op: "add",
                      host: host.trim(),
                      brand,
                      name: name.trim() || brand.toUpperCase() + " TV",
                    }),
                  );
              const saved =
                existing ||
                next?.devices.find(
                  (d) => d.host === host.trim() && d.brand === brand,
                );
              if (saved) setLocalSelected(saved.id);
              setLocalVerification(null);
              setNotice("TV address saved. Choose Connect TV below.");
            });
          }}
        >
          <label>
            TV type
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value as "roku" | "lg")}
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
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={!!busy}>
            Save address
          </button>
        </form>
        {localDevice && (
          <div className="saved-choice">
            <h3>Saved TV: {localDevice.name}</h3>
            <p>{verification}</p>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void pairLocal(localDevice)}
            >
              Connect TV
            </button>
          </div>
        )}
      </details>
    );
  }
  return (
    <div className="shell connection-shell simple-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("tvs");
          }}
        >
          <span className="brandmark">
            <Radio size={23} />
          </span>
          <span>
            streamgpt<span className="local-word">YOUR TV, WITH YOU</span>
          </span>
        </a>
        <nav aria-label="App sections">
          {(
            [
              ["tvs", "Your TVs", Monitor],
              ["remote", "Remote", Radio],
              ["settings", "Settings", Command],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Use ChatGPT on your phone. Keep this computer awake and StreamGPT
            open.
          </p>
          <div className="build">
            STREAMGPT <span>V{data.version}</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            StreamGPT /{" "}
            {tab === "tvs"
              ? "Your TVs"
              : tab === "remote"
                ? "Remote"
                : "Settings"}
          </span>
          <span className="account-chip">
            {linked
              ? authLost.current
                ? "Reconnect account"
                : "Account connected"
              : status.pending
                ? "Approval in progress"
                : "Welcome"}
          </span>
        </header>
        <section className="page">
          {notice && !setup && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {tab === "tvs" && (
            <>
              <div className="tv-list-heading">
                <div>
                  <p className="eyebrow">CHATGPT, MEET YOUR TV</p>
                  <h1>Your TVs.</h1>
                  <p>
                    Add your TV, then control it from ChatGPT on your phone.
                  </p>
                </div>
                <button
                  ref={addEntry}
                  className="primary add-tv"
                  disabled={!!busy}
                  onClick={() => openSetup()}
                >
                  <Plus size={18} />
                  Add a TV
                </button>
              </div>
              {!linked && !localMode && (
                <div className="phone-banner">
                  <div>
                    <strong>
                      {status.pending
                        ? "Finish connecting to ChatGPT"
                        : "Bring your TV to your phone"}
                    </strong>
                    <p>
                      {status.pending
                        ? "Compare the code in your browser and approve this computer."
                        : "Connect your StreamGPT account once to use these TVs in ChatGPT."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      status.pending ? setSetup("account") : void startLink()
                    }
                  >
                    {status.pending ? "Continue setup" : "Connect to ChatGPT"}
                  </button>
                </div>
              )}
              {linked && (
                <p className="phone-guidance">
                  Open StreamGPT in ChatGPT on your phone. Keep this computer
                  awake and StreamGPT open.
                </p>
              )}
              {localMode && (
                <p className="phone-guidance">
                  Using the remote on this computer. Phone access is available
                  in Settings.
                </p>
              )}
              <section className="tv-cards" aria-label="Your saved TVs">
                {tvs.map((d) => {
                  const local = "brand" in d;
                  const title = local ? d.name : d.label;
                  const via = local
                    ? "On this computer"
                    : d.provider === "local"
                      ? "Via " +
                        (cloud?.helpers?.find((h) => h.id === d.helperId)
                          ?.name || "your computer")
                      : "Samsung";
                  const checked = local
                    ? localVerification?.id === d.id
                    : cloud?.verification?.deviceId === d.id &&
                      cloud.verification.outcome === "status_read";
                  const available = local
                    ? d.reachable
                    : d.provider === "local"
                      ? d.online &&
                        cloud?.helpers?.some(
                          (h) => h.id === d.helperId && h.online,
                        )
                      : cloud?.samsungConnected !== false;
                  return (
                    <button
                      key={d.id}
                      className={
                        "tv-choice " + (selectedId === d.id ? "selected" : "")
                      }
                      aria-label={"Choose " + title}
                      aria-pressed={selectedId === d.id}
                      disabled={!!busy}
                      onClick={() => selectTv(d.id)}
                    >
                      <span className="tv-card-icon">
                        <Monitor size={30} />
                      </span>
                      <strong>{title}</strong>
                      <span>{via}</span>
                      <small>
                        {!available
                          ? "Connection unavailable"
                          : checked
                            ? "Status checked"
                            : "Saved"}
                        {selectedId === d.id ? " - Selected" : ""}
                      </small>
                    </button>
                  );
                })}
              </section>
              {!tvs.length && (
                <section className="empty-tvs">
                  <Monitor size={42} />
                  <h2>Your first TV starts here.</h2>
                  <p>
                    Choose Add a TV. We will walk you through the connection.
                  </p>
                </section>
              )}
              {selectedName && (
                <section className="selected-tv">
                  <div>
                    <strong>{selectedName}</strong>
                    <p>Selected TV. You can also try its remote here.</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setTab("remote")}
                  >
                    Open remote
                  </button>
                </section>
              )}
            </>
          )}
          {tab === "remote" && (
            <>
              <h1>Your remote.</h1>
              <p>Choose a saved TV. Only its supported controls appear.</p>
              <label className="remote-picker">
                Current TV and route
                <select
                  aria-label="Current TV and route"
                  value={selectedId || ""}
                  disabled={!!busy}
                  onChange={(e) => e.target.value && selectTv(e.target.value)}
                >
                  <option value="">Choose TV</option>
                  {useLocal
                    ? data.devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} - on this computer
                        </option>
                      ))
                    : cloud?.devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {targetLabel(cloud, d)}
                        </option>
                      ))}
                </select>
              </label>
              <p className="verification">{verification}</p>
              {staleInventory && !useLocal && (
                <p className="verification">
                  Showing saved TVs. Automatic refresh is unavailable; every
                  action checks your account.
                </p>
              )}
              <p className="control-evidence">
                {deviceEvidenceText(useLocal ? localDevice : cloudDevice)}
              </p>
              {!selectedName && <p>Choose a TV in Your TVs first.</p>}
              <section className="remote-panel unified-remote">
                <div className="remote-heading">
                  <h2>{selectedName || "Choose your TV"}</h2>
                  <button
                    className="text-button"
                    disabled={!!busy || !(useLocal ? localDevice : cloudDevice)}
                    onClick={() =>
                      useLocal
                        ? localDevice &&
                          void run("Reading TV status...", () =>
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
                  A returned command does not confirm a physical TV effect.
                </p>
              </section>
            </>
          )}
          {tab === "settings" && (
            <>
              <h1>Settings.</h1>
              <section className="settings-card">
                <h2>Your account</h2>
                {accountSetup()}
                {linked && (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Disconnecting this computer...", async () => {
                        epoch.current++;
                        clearAccount();
                        await callCloud({ op: "disconnect" });
                        await refresh();
                        setNotice("Account disconnected from this computer.");
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
                <details>
                  <summary>Computer name</summary>
                  <label>
                    Name shown during approval
                    <input
                      value={helperName}
                      maxLength={80}
                      onChange={(e) => setHelperName(e.target.value)}
                    />
                  </label>
                </details>
              </section>
              <section className="settings-card">
                <h2>Advanced</h2>
                <p>
                  Optional tools for controlling TVs directly from this
                  computer.
                </p>
                <div className="settings-actions">
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => {
                      setLocalMode(!localMode);
                      setCandidate(null);
                      setFeedback("");
                      setLocalVerification(null);
                      setSearchOutcome("idle");
                      setSetupResult(null);
                      searchScope.current++;
                      setTab("tvs");
                    }}
                  >
                    {localMode
                      ? "Use ChatGPT with your phone"
                      : "Use remote on this computer"}
                  </button>
                  <button className="secondary" onClick={() => setTab("mcp")}>
                    Desktop MCP
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setTab("activity")}
                  >
                    Connection diagnostics
                  </button>
                </div>
              </section>
            </>
          )}
          {tab === "mcp" && (
            <section className="settings-card">
              <button
                className="text-button"
                onClick={() => setTab("settings")}
              >
                Back to Settings
              </button>
              <h1>Desktop MCP.</h1>
              <p>
                Keep StreamGPT open while using an approved desktop MCP client.
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
                iOS companion: Mac build / TestFlight preparation. No
                background-operation promise.
              </p>
            </section>
          )}
          {tab === "activity" && (
            <>
              <button
                className="text-button"
                onClick={() => setTab("settings")}
              >
                Back to Settings
              </button>
              <h1>Connection diagnostics.</h1>
              {activityView()}
            </>
          )}
          <footer>
            <span>YOUR TV. WITH YOU.</span>
            <span>StreamGPT</span>
          </footer>
        </section>
      </main>
      <dialog
        ref={sheet}
        className="setup-sheet"
        aria-labelledby="setup-heading"
        onCancel={(e) => {
          e.preventDefault();
          setSetup(null);
        }}
      >
        <div className="sheet-title">
          <span className="eyebrow">ADD YOUR TV</span>
          <button
            className="text-button"
            aria-label="Close setup"
            onClick={() => setSetup(null)}
          >
            <X size={18} />
            Close
          </button>
        </div>
        <h2 id="setup-heading">
          {setup === "brand"
            ? "What kind of TV?"
            : setup === "samsung"
              ? "Add your Samsung TV"
              : setup === "lg"
                ? "Add your LG TV"
                : setup === "roku"
                  ? "Add your Roku TV"
                  : setup === "help"
                    ? "Let\u2019s find your TV type"
                    : "Connect to ChatGPT"}
        </h2>
        {(setup === "lg" || setup === "roku") && connectionNotice && (
          <section
            className="candidate-confirm connection-progress"
            role="status"
            aria-live="polite"
          >
            <h3>
              {busy ? "Connecting to your TV" : "Connection not confirmed"}
            </h3>
            <p>{connectionNotice}</p>
          </section>
        )}
        {setup === "brand" && (
          <>
            <p>Choose the name on your TV or streaming device.</p>
            <div className="brand-choices">
              {(["samsung", "lg", "roku"] as const).map((b) => (
                <button
                  className="brand-choice"
                  key={b}
                  onClick={() => chooseBrand(b)}
                >
                  <Monitor size={24} />
                  <strong>
                    {b === "samsung" ? "Samsung" : b === "lg" ? "LG" : "Roku"}
                  </strong>
                  <span>
                    {b === "samsung"
                      ? "Connect with SmartThings"
                      : "Find it on your home network"}
                  </span>
                </button>
              ))}
            </div>
            <button className="text-button" onClick={() => chooseBrand("help")}>
              Not sure? Help me choose
            </button>
          </>
        )}
        {setup === "help" && (
          <>
            <p>
              Look for a logo on the TV frame or the remote. A Roku player may
              be plugged into a TV of another brand.
            </p>
            <p>
              Samsung TVs connect through SmartThings. LG and Roku connect
              through a computer on the same home network.
            </p>
            <button className="secondary" onClick={() => setSetup("brand")}>
              Choose TV type
            </button>
          </>
        )}
        {setup === "account" && accountSetup()}
        {setup === "samsung" && (
          <>
            <p className="step-label">1. Prepare your TV</p>
            <p>
              Turn on your TV. In the SmartThings app on your phone, sign in to
              your Samsung account and add this TV. Check it appears in
              SmartThings before continuing.
            </p>
            {!linked && accountSetup()}
            <p className="step-label">2. Connect Samsung</p>
            <p>
              Continue in your browser with the same StreamGPT and Samsung
              accounts. Return here and refresh your TVs when you finish.
            </p>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void run("Opening Samsung setup...", async () => {
                  await callCloud({ op: "open_remote" });
                  setNotice(
                    "Samsung setup opened in your browser. Return here when you finish.",
                  );
                })
              }
            >
              Continue with Samsung
            </button>
            <button
              className="text-button"
              disabled={!!busy || !linked}
              onClick={() => void action({ type: "refresh_devices" })}
            >
              Refresh TVs
            </button>
          </>
        )}
        {(setup === "lg" || setup === "roku") && (
          <>
            <p>
              Turn your {setup === "lg" ? "LG TV" : "Roku"} on. This computer
              will search your home network, so keep the TV and computer on the
              same router.
            </p>
            {setup === "roku" && (
              <p className="roku-setup-guide">
                {rokuInstructions} A successful status read does not prove
                buttons are allowed.
              </p>
            )}
            {!linked && !localMode ? (
              accountSetup()
            ) : (
              <>
                <p className="step-label">Find your TV</p>
                {useLocal ? (
                  <p>This computer will look for your TV.</p>
                ) : (
                  <>
                    <p>
                      {chosenHelper
                        ? (chosenHelper === status.helperId
                            ? "This computer"
                            : computer?.name) +
                          " will search your home network."
                        : "Choose which computer is near your TV."}
                    </p>
                    {(!chosenHelper || changeComputer) && (
                      <label>
                        Computer near your TV
                        <select
                          aria-label="Computer near your TV"
                          value={chosenHelper}
                          disabled={!!busy}
                          onChange={(e) => {
                            setHelperId(e.target.value);
                            setCandidate(null);
                            setSearchOutcome("idle");
                            setSetupResult(null);
                            searchScope.current++;
                          }}
                        >
                          <option value="">Choose a computer</option>
                          {computers.map((c) => (
                            <option
                              key={c.id}
                              value={c.id}
                              disabled={!c.online}
                            >
                              {computerLabel(c.id)} -{" "}
                              {c.online ? "online" : "offline"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {chosenHelper && !changeComputer && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => setChangeComputer(true)}
                      >
                        Change computer
                      </button>
                    )}
                    {!chosenHelper && computers.every((c) => !c.online) && (
                      <p>
                        Open StreamGPT on the computer near your TV and wait for
                        it to come online.
                      </p>
                    )}
                  </>
                )}
                <button
                  className="primary find-tvs"
                  disabled={!!busy || (!useLocal && !chosenHelper)}
                  onClick={() => void find()}
                >
                  <Search size={17} />
                  {searchOutcome === "searching"
                    ? "Looking for TVs..."
                    : searchOutcome === "empty" || searchOutcome === "failed"
                      ? "Try again"
                      : "Find TVs"}
                </button>
                {searchOutcome === "searching" && (
                  <p className="search-progress" role="status">
                    Looking for TVs on your home network. Waiting for the search
                    result...
                  </p>
                )}
                {searchOutcome === "empty" && (
                  <div className="search-result">
                    <h3>No TVs found this time.</h3>
                    <p>
                      Turn the TV on, check that it and the computer use the
                      same home network, then try again. A missed search does
                      not mean your TV is unsupported.
                    </p>
                  </div>
                )}
                {searchOutcome === "failed" && (
                  <div className="search-result">
                    <h3>The search could not finish.</h3>
                    <p>
                      Check that StreamGPT is open on the selected computer and
                      both devices are on the same network. Try again when
                      ready.
                    </p>
                  </div>
                )}
                {searchOutcome === "found" && (
                  <div className="search-result">
                    <h3>
                      {shownCandidates.length
                        ? shownCandidates.length +
                          " TV" +
                          (shownCandidates.length === 1 ? "" : "s") +
                          " found"
                        : "Search complete"}
                    </h3>
                    <p>
                      {shownCandidates.length
                        ? "Choose the TV you recognize."
                        : "Your chosen TV is saved below."}
                    </p>
                    {shownCandidates.map((c) => (
                      <button
                        className="candidate"
                        key={
                          "candidateId" in c
                            ? c.helperId + ":" + c.candidateId
                            : c.brand + ":" + c.host
                        }
                        disabled={!!busy}
                        onClick={() => setCandidate(c)}
                      >
                        <Monitor size={19} />
                        <strong>{c.name}</strong>
                        <small>
                          {c.brand.toUpperCase()}
                          {c.model ? " - " + c.model : ""}
                        </small>
                        <span>Choose</span>
                      </button>
                    ))}
                  </div>
                )}
                {candidate && (
                  <section
                    className="candidate-confirm"
                    aria-label="Confirm TV connection"
                  >
                    <h3>Connect {candidate.name}?</h3>
                    {candidate.brand === "lg" ? (
                      <div className="tv-approval-guide" role="note">
                        <h3>Be near your LG TV first</h3>
                        <ol>
                          <li>
                            Take the LG remote with you and leave the TV on.
                          </li>
                          <li>When you are ready, choose Connect TV below.</li>
                          <li>
                            Look at the TV screen and choose Allow or Accept if
                            it asks.
                          </li>
                        </ol>
                        <p>
                          The request waits up to 40 seconds for approval. No TV
                          buttons will be sent.
                        </p>
                      </div>
                    ) : (
                      <p>
                        We will read Roku device information and permission. No
                        TV button will be used as a test.
                      </p>
                    )}
                    <div className="agent-button-row">
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => setCandidate(null)}
                      >
                        Choose another TV
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
                {setupResult === selectedId &&
                  !busy &&
                  !candidate &&
                  selectedName && (
                    <div className="connection-outcome">
                      <h3>{selectedName}</h3>
                      <p className="verification">{verification}</p>
                      <p className="control-evidence">
                        {deviceEvidenceText(
                          useLocal ? localDevice : cloudDevice,
                        )}
                      </p>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          useLocal
                            ? localDevice &&
                              void run("Reading TV status...", () =>
                                checkLocal(localDevice),
                              )
                            : void action({
                                type: "get_tv_status",
                                deviceId: cloudDevice?.id,
                              })
                        }
                      >
                        Check status
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSetup(null);
                          setTab("tvs");
                        }}
                      >
                        Back to Your TVs
                      </button>
                    </div>
                  )}
                {searchOutcome !== "idle" && activityView()}
              </>
            )}
            <button
              className="text-button need-help"
              onClick={() => setHelpOpen(!helpOpen)}
            >
              Need help?
            </button>
            {helpOpen && (
              <section className="connection-help">
                <h3>Check the basics</h3>
                <p>
                  Keep the TV on and the computer awake. Use the same home
                  router; guest Wi-Fi may keep devices apart. For LG, check the
                  TV screen for a connection approval request. For Roku, check
                  its network-control settings if access is denied.
                </p>
                {localMode && manualHelp()}
                <button
                  className="secondary"
                  disabled={!linked}
                  onClick={() => setAskOpen(!askOpen)}
                >
                  Ask StreamGPT
                </button>
              </section>
            )}
          </>
        )}
        {askOpen && linked && (
          <section className="assistant-panel">
            <h3>Ask StreamGPT</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = message.trim();
                if (!text || !linked) return;
                if (
                  text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)?.some(localAddress)
                ) {
                  setNotice(
                    "Use the address field on this computer for TV network addresses.",
                  );
                  return;
                }
                void run("Asking StreamGPT...", async () => {
                  const generation = store.current.generation;
                  publish(
                    await callCloud({
                      op: "ask",
                      message: text,
                      requestId: crypto.randomUUID(),
                    }),
                    generation,
                  );
                  setNotice("Your assistant reply is below.");
                });
              }}
            >
              <label>
                Message
                <input
                  value={message}
                  maxLength={600}
                  disabled={!!busy}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={!!busy || !message.trim()}
              >
                Ask
              </button>
            </form>
            <h4>Assistant reply</h4>
            <p>
              {cloud?.resident?.reply || "No assistant reply received yet."}
            </p>
          </section>
        )}
        {notice && (
          <p className="sheet-notice" aria-live="polite">
            {notice}
          </p>
        )}
        {setup && setup !== "brand" && setup !== "account" && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => {
              setCandidate(null);
              setSearchOutcome("idle");
              setSetupResult(null);
              searchScope.current++;
              setSetup("brand");
            }}
          >
            Back to TV types
          </button>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
