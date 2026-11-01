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
