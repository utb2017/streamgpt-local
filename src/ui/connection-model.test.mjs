import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountSnapshots,
  cloudButton,
  verificationLabel,
  localAddress,
} from "./connection-model.ts";
const status = (helperId = "home") => ({
  helperId,
  status: helperId ? "connected" : "not_connected",
  platform: "windows",
  message: "",
  pending: null,
  activity: [],
});
const snapshot = () => ({
  version: 1,
  revision: 1,
  identity: { label: "Linked account" },
  connection: { status: "connected" },
  samsungConnected: false,
  helpers: [{ id: "home", name: "Home PC", platform: "windows", online: true }],
  devices: [
    {
      id: "tv",
      label: "Living room",
      provider: "local",
      manufacturer: "lg",
      helperId: "home",
      online: true,
      buttons: ["Home", "PlayPause", "VolumeUp"],
      components: [
        { id: "main", capabilities: [{ id: "streamgpt.remote", version: 1 }] },
      ],
    },
  ],
  selectedDeviceId: "tv",
});
test("native helper account generations reject late old-account responses with the same masked identity", () => {
  const store = new AccountSnapshots();
  store.scope(status());
  const generation = store.generation;
  assert.ok(store.accept({ ...snapshot(), revision: 100 }, generation));
  assert.ok(store.scope(status(null)));
  assert.equal(Boolean(store.current), false);
  assert.equal(
    store.accept({ ...snapshot(), revision: 999 }, generation),
    false,
  );
  store.scope(status("different-helper"));
  assert.ok(store.accept(snapshot()));
  assert.equal(
    store.accept({ ...snapshot(), revision: 999 }, generation),
    false,
  );
  assert.equal(store.current?.revision, 1);
  const mutable = { ...snapshot(), revision: 2 };
  assert.ok(store.accept(mutable));
  mutable.devices[0].label = "Changed outside";
  assert.equal(store.current?.devices[0].label, "Living room");
  assert.equal(store.accept(snapshot()), false);
});

test("native cloud actions preserve advertised spelling and never invent a fallback route", () => {
  const s = snapshot();
  assert.deepEqual(cloudButton(s, "play", "once"), {
    type: "send_tv_command",
    deviceId: "tv",
    component: "main",
    capability: "streamgpt.remote",
    command: "PlayPause",
    requestId: "once",
  });
  assert.equal(cloudButton(s, "power_on", "never"), null);
  for (const mutate of [
    (x) => {
      x.helpers[0].online = false;
    },
    (x) => {
      x.devices[0].online = false;
    },
    (x) => {
      x.selectedDeviceId = "missing";
    },
    (x) => {
      x.devices[0].components[0].capabilities[0].version = 2;
    },
  ]) {
    const bad = snapshot();
    mutate(bad);
    assert.equal(cloudButton(bad, "home", "never"), null);
  }
  const samsung = {
    ...s,
    samsungConnected: true,
    selectedDeviceId: "samsung",
    devices: [
      {
        id: "samsung",
        label: "Samsung",
        components: [
          {
            id: "speaker-two",
            capabilities: [{ id: "audioVolume", version: 1 }],
          },
        ],
      },
    ],
  };
  assert.deepEqual(cloudButton(samsung, "volume_up", "one"), {
    type: "send_tv_command",
    deviceId: "samsung",
    component: "speaker-two",
    capability: "audioVolume",
    command: "volumeUp",
    requestId: "one",
  });
});

test("native local-only address gate accepts private IPv4 without allowing public hosts or URLs", () => {
  for (const ip of [
    "192.168.1.40",
    "10.0.0.9",
    "172.16.0.3",
    "172.31.2.9",
    "192.168.1.0",
  ])
    assert.equal(localAddress(ip), true, ip);
  for (const host of [
    "8.8.8.8",
    "127.0.0.1",
    "172.32.1.2",
    "192.168.1.255",
    "169.254.3.4",
    "192.168.001.40",
    "010.0.0.9",
    "https://192.168.1.40",
    "tv.local",
    "192.168.1.999",
  ])
    assert.equal(localAddress(host), false, host);
});

test("native snapshot parser rejects malformed shapes before components or activity can render", () => {
  for (const bad of [
    { ...snapshot(), devices: [null] },
    { ...snapshot(), devices: [{ id: "x", label: "x", components: [null] }] },
    { ...snapshot(), activity: [null] },
    { ...snapshot(), helpers: [null] },
    { ...snapshot(), verification: null },
  ]) {
    const store = new AccountSnapshots();
    store.scope(status());
    assert.equal(store.accept(bad), false);
  }
});

test("native verification requires matching TV and live route", () => {
  const s = snapshot();
  assert.match(verificationLabel(s), /not verified/);
  s.verification = {
    deviceId: "other",
    checkedAt: 1000,
    outcome: "status_read",
  };
  assert.match(verificationLabel(s), /not verified/);
  s.verification.deviceId = "tv";
  assert.match(verificationLabel(s), /Status read/);
  s.helpers[0].online = false;
  assert.doesNotMatch(verificationLabel(s), /^Status read/);
});
