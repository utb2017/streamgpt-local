import type {
  Button,
  CloudAction,
  CloudDevice,
  CloudSnapshot,
  CloudStatus,
  Device,
} from "../shared";

export const cloudLinked = (s: CloudStatus) =>
  !!s.helperId && (s.status === "connected" || s.status === "offline");

// Display duplicate records once by ID; distinct computers keep distinct choices.
export function setupComputers(
  s: CloudSnapshot | null,
  status: CloudStatus,
  chosen = "",
) {
  const computers = [
    ...new Map((s?.helpers || []).map((h) => [h.id, h])).values(),
  ];
  const online = computers.filter(
    (h) =>
      h.online && !(h.id === status.helperId && status.status !== "connected"),
  );
  const preferred =
    online.find((h) => h.id === chosen) ||
    online.find((h) => h.id === status.helperId) ||
    (online.length === 1 ? online[0] : undefined);
  return { computers, selected: preferred?.id || "" };
}
export class AccountSnapshots {
  current: CloudSnapshot | null = null;
  private key = "";
  generation = 0;
  reset(key = ""): number {
    this.key = key;
    this.current = null;
    return ++this.generation;
  }
  invalidate(): void {
    this.reset(this.key);
  }
  scope(status: CloudStatus): boolean {
    const next = cloudLinked(status) ? status.helperId! : "";
    if (next === this.key) return false;
    this.reset(next);
    return true;
  }
  accept(value: unknown, generation = this.generation): boolean {
    if (
      generation !== this.generation ||
      !this.key ||
      !value ||
      typeof value !== "object"
    )
      return false;
    const s = value as CloudSnapshot;
    if (
      s.version !== 1 ||
      !Number.isSafeInteger(s.revision) ||
      s.revision < 0 ||
      typeof s.identity?.label !== "string" ||
      !Array.isArray(s.devices) ||
      !s.connection ||
      !["connected", "not_connected", "unavailable"].includes(
        s.connection.status,
      ) ||
      !s.devices.every(
        (d) =>
          !!d &&
          typeof d.id === "string" &&
          typeof d.label === "string" &&
          (d.provider === undefined ||
            d.provider === "local" ||
            d.provider === "smartthings") &&
          (d.buttons === undefined ||
            (Array.isArray(d.buttons) &&
              d.buttons.every((b) => typeof b === "string"))) &&
          Array.isArray(d.components) &&
          d.components.every(
            (c) =>
              !!c &&
              typeof c.id === "string" &&
              Array.isArray(c.capabilities) &&
              c.capabilities.every(
                (k) =>
                  !!k && typeof k.id === "string" && Number.isFinite(k.version),
              ),
          ),
      ) ||
      (s.helpers !== undefined &&
        (!Array.isArray(s.helpers) ||
          !s.helpers.every(
            (h) =>
              !!h &&
              typeof h.id === "string" &&
              typeof h.name === "string" &&
              typeof h.online === "boolean",
          ))) ||
      (s.candidates !== undefined &&
        (!Array.isArray(s.candidates) ||
          !s.candidates.every(
            (c) =>
              !!c &&
              typeof c.candidateId === "string" &&
              typeof c.helperId === "string" &&
              typeof c.name === "string" &&
              ["lg", "roku"].includes(c.brand),
          ))) ||
      (s.verification !== undefined &&
        (!s.verification ||
          typeof s.verification.deviceId !== "string" ||
          !Number.isFinite(s.verification.checkedAt) ||
          !["status_read", "unavailable", "unknown"].includes(
            s.verification.outcome,
          ))) ||
      (s.activity !== undefined &&
        (!Array.isArray(s.activity) ||
          s.activity.length > 30 ||
          !s.activity.every(
            (a, i, all) =>
              !!a &&
              Number.isSafeInteger(a.seq) &&
              a.seq > 0 &&
              (!i || a.seq > all[i - 1].seq) &&
              typeof a.runId === "string" &&
              typeof a.op === "string" &&
              ["requested", "completed", "failed"].includes(a.phase) &&
              Number.isFinite(a.at),
          ))) ||
      (s.resident !== undefined && typeof s.resident?.reply !== "string")
    )
      return false;
    if (
      this.current &&
      (s.revision <= this.current.revision ||
        s.identity.label !== this.current.identity.label)
    )
      return false;
    this.current = structuredClone(s);
    return true;
  }
}
export const cloudSelected = (s: CloudSnapshot | null) =>
  s?.devices.find((d) => d.id === s.selectedDeviceId);
export function routeAvailable(s: CloudSnapshot, device: CloudDevice): boolean {
  return (
    s.connection.status === "connected" &&
    (device.provider === "local"
      ? device.online === true &&
        !!s.helpers?.some((h) => h.id === device.helperId && h.online)
      : s.samsungConnected !== false)
  );
}
export function targetLabel(s: CloudSnapshot, d: CloudDevice): string {
  return d.provider === "local"
    ? `${d.label} · ${d.manufacturer === "roku" ? "Roku" : d.manufacturer === "lg" ? "LG" : "Local TV"} via ${s.helpers?.find((h) => h.id === d.helperId)?.name || "home helper"}`
    : `${d.label} · Samsung`;
}
export function verificationLabel(s: CloudSnapshot | null): string {
  const d = cloudSelected(s);
  if (!d) return "Choose a TV. Nothing will connect until you choose.";
  if (!routeAvailable(s!, d))
    return "Route unavailable; TV status not verified.";
  const v = s?.verification;
  if (!v || v.deviceId !== d.id || !Number.isFinite(v.checkedAt))
    return "Saved; status not verified.";
  return v.outcome === "status_read"
    ? `Status read · ${new Date(v.checkedAt).toLocaleTimeString()}. This does not confirm a button effect.`
    : v.outcome === "unavailable"
      ? "Saved; status read unavailable."
      : "Saved; status not verified.";
}
export type KeyId =
  Button | "power_on" | "unmute" | "stop" | "channel_up" | "channel_down";
export const keyLabels: Record<KeyId, string> = {
  home: "Home",
  back: "Back",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  select: "Select",
  play: "Play",
  pause: "Pause",
  rewind: "Rewind",
  forward: "Forward",
  volume_up: "Volume up",
  volume_down: "Volume down",
  mute: "Mute",
  unmute: "Unmute",
  power_off: "Power off",
  power_on: "Power on",
  stop: "Stop",
  channel_up: "Channel up",
  channel_down: "Channel down",
};
const localNames: Partial<Record<KeyId, string[]>> = {
  play: ["play_pause", "playPause", "play"],
  forward: ["forward", "fast_forward", "fastForward", "Fwd"],
  rewind: ["rewind", "Rev"],
  select: ["select", "ok"],
  power_off: ["power_off", "powerOff"],
  volume_up: ["volume_up", "volumeUp"],
  volume_down: ["volume_down", "volumeDown"],
  mute: ["mute", "volume_mute"],
};
export function advertised(d: CloudDevice, id: KeyId): string | undefined {
  const normalize = (v: string) => v.toLowerCase().replace(/[_-]/g, "");
  for (const name of localNames[id] || [id]) {
    const found = d.buttons?.find((b) => normalize(b) === normalize(name));
    if (found) return found;
  }
  return undefined;
}
const samsung: Partial<Record<KeyId, [string, string]>> = {
  power_on: ["switch", "on"],
  power_off: ["switch", "off"],
  volume_up: ["audioVolume", "volumeUp"],
  volume_down: ["audioVolume", "volumeDown"],
  mute: ["audioMute", "mute"],
  unmute: ["audioMute", "unmute"],
  play: ["mediaPlayback", "play"],
  pause: ["mediaPlayback", "pause"],
  stop: ["mediaPlayback", "stop"],
  rewind: ["mediaPlayback", "rewind"],
  forward: ["mediaPlayback", "fastForward"],
  channel_up: ["tvChannel", "channelUp"],
  channel_down: ["tvChannel", "channelDown"],
};
export function cloudButton(
  s: CloudSnapshot | null,
  id: KeyId,
  requestId: string,
): CloudAction | null {
  const d = cloudSelected(s);
  if (!s || !d || !routeAvailable(s, d)) return null;
  if (d.provider === "local") {
    const button = advertised(d, id);
    if (
      !button ||
      !d.components.some(
        (c) =>
          c.id === "main" &&
          c.capabilities.some(
            (k) => k.id === "streamgpt.remote" && k.version === 1,
          ),
      )
    )
      return null;
    return {
      type: "send_tv_command",
      deviceId: d.id,
      component: "main",
      capability: "streamgpt.remote",
      command: button,
      requestId,
    };
  }
  const command = samsung[id];
  if (!command) return null;
  const component = d.components.find((c) =>
    c.capabilities.some((k) => k.id === command[0] && k.version === 1),
  );
  return component
    ? {
        type: "send_tv_command",
        deviceId: d.id,
        component: component.id,
        capability: command[0],
        command: command[1],
        requestId,
      }
    : null;
}
export function keyLabel(
  d: CloudDevice | Device | undefined,
  id: KeyId,
): string {
  if (
    id === "mute" &&
    d &&
    (("brand" in d && d.brand === "lg") ||
      ("provider" in d && d.provider === "local"))
  )
    return "Mute toggle";
  if (
    id === "play" &&
    d &&
    (("brand" in d && d.brand === "roku") ||
      ("manufacturer" in d && d.manufacturer === "roku") ||
      ("buttons" in d &&
        !!d.buttons?.some(
          (b) => b.toLowerCase().replace(/[_-]/g, "") === "playpause",
        )))
  )
    return "Play / pause";
  return keyLabels[id];
}
export function localKeys(d: Device | undefined): Button[] {
  if (!d) return [];
  return d.brand === "roku"
    ? [
        "home",
        "back",
        "up",
        "down",
        "left",
        "right",
        "select",
        "play",
        "rewind",
        "forward",
      ]
    : [
        "home",
        "back",
        "up",
        "down",
        "left",
        "right",
        "select",
        "play",
        "pause",
        "rewind",
        "forward",
        "volume_up",
        "volume_down",
        "mute",
        "power_off",
      ];
}
export function localAddress(value: string): boolean {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)
  )
    return false;
  const [a, b, c, d] = parts.map(Number);
  return (
    (a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)) &&
    d !== 255 &&
    c !== undefined
  );
}
export const activityLabel: Record<string, string> = {
  discover_local: "Discovery",
  connect_local: "Connection",
  get_tv_status: "Status read",
  send_tv_command: "TV command",
  select_tv: "TV selection",
  refresh_devices: "Inventory refresh",
  disconnect_samsung: "Samsung disconnect",
  disconnect_helper: "Computer disconnect",
  ask_remote: "Assistant turn",
  discover: "Discovery",
  connect: "Connection",
  inspect: "Status read",
  press: "TV command",
};
