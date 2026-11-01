export const buttons = [
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
] as const;
export type Button = (typeof buttons)[number];
export type Brand = "lg" | "roku";
export interface Device {
  id: string;
  name: string;
  host: string;
  brand: Brand;
  model: string;
  paired: boolean;
  reachable: boolean;
  lastSeen?: string;
}
export interface Candidate {
  host: string;
  brand: Brand;
  name: string;
  model?: string;
}
export interface Receipt {
  id: string;
  deviceId: string;
  button: Button;
  status: "accepted" | "uncertain" | "rejected";
  at: number;
  message: string;
}
export interface Snapshot {
  devices: Device[];
  receipts: Receipt[];
  version: string;
  mcpConfig: string;
  cloud: "not_connected";
}
export type Input =
  | { op: "snapshot" | "discover" }
  | { op: "add"; host: string; brand: Brand; name: string }
  | { op: "pair" | "forget" | "inspect"; deviceId: string }
  | { op: "press"; deviceId: string; button: Button; requestId: string };

// Renderer-only mirrors of the frozen cloud contract. No native vault material.
export interface CloudDevice {
  id: string;
  label: string;
  manufacturer?: string;
  provider?: "smartthings" | "local";
  helperId?: string;
  localDeviceId?: string;
  online?: boolean;
  buttons?: string[];
  components: Array<{
    id: string;
    capabilities: Array<{ id: string; version: number }>;
  }>;
}
export interface CloudHelper {
  id: string;
  name: string;
  platform: string;
  online: boolean;
}
export interface CloudCandidate {
  helperId: string;
  candidateId: string;
  name: string;
  brand: Brand;
  model?: string;
}
export interface DomainActivity {
  seq: number;
  runId: string;
  operationId?: string;
  deviceId?: string;
  helperId?: string;
  op: string;
  phase: "requested" | "completed" | "failed";
  at: number;
  outcome?: string;
}
export interface NativeActivity {
  seq: number;
  id: string;
  op: "discover" | "connect" | "inspect" | "press";
  phase: "started" | "completed" | "failed";
  at: number;
}
export interface CloudSnapshot {
  version: 1;
  revision: number;
  identity: { label: string };
  connection: {
    status: "connected" | "not_connected" | "unavailable";
    message?: string;
  };
  devices: CloudDevice[];
  selectedDeviceId?: string;
  helpers?: CloudHelper[];
  candidates?: CloudCandidate[];
  samsungConnected?: boolean;
  state?: Record<string, unknown>;
  verification?: {
    deviceId: string;
    checkedAt: number;
    outcome: "status_read" | "unavailable" | "unknown";
  };
  activity?: DomainActivity[];
  receipt?: {
    requestId: string;
    status: "accepted" | "rejected" | "uncertain";
    message: string;
  };
  resident?: { reply: string };
}
export type CloudAction =
  | { type: "refresh_devices" | "disconnect_samsung" }
  | { type: "select_tv"; deviceId: string }
  | { type: "get_tv_status"; deviceId?: string }
  | { type: "discover_local" | "disconnect_helper"; helperId: string }
  | { type: "connect_local"; helperId: string; candidateId: string }
  | {
      type: "send_tv_command";
      deviceId: string;
      component: string;
      capability: string;
      command: string;
      arguments?: Array<string | number | boolean>;
      requestId: string;
    };
export interface CloudStatus {
  status: "not_connected" | "pending" | "offline" | "connected";
  platform: string;
  message: string;
  helperId: string | null;
  pending: { userCode: string; approvalUrl: string; expiresAt: number } | null;
  activity: NativeActivity[];
}
export type CloudInput =
  | {
      op:
        "status" | "snapshot" | "open_approval" | "disconnect" | "open_remote";
    }
  | { op: "start"; name: string }
  | { op: "action"; action: CloudAction }
  | { op: "ask"; message: string; requestId: string };
