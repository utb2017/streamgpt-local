use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Brand {
    Lg,
    Roku,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub host: String,
    pub brand: Brand,
    pub model: String,
    pub paired: bool,
    pub reachable: bool,
    #[serde(default)]
    pub last_seen: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Button {
    Home,
    Back,
    Up,
    Down,
    Left,
    Right,
    Select,
    Play,
    Pause,
    Rewind,
    Forward,
    VolumeUp,
    VolumeDown,
    Mute,
    PowerOff,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub device_id: String,
    pub button: Button,
    pub status: String,
    pub at: u64,
    pub message: String,
}
#[derive(Default, Clone, Deserialize, Serialize)]
pub struct Data {
    pub devices: Vec<Device>,
    pub keys: HashMap<String, String>,
    pub receipts: Vec<Receipt>,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Input {
    Snapshot {},
    Discover {},
    Add {
        host: String,
        brand: Brand,
        name: String,
    },
    Pair {
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    Inspect {
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    Forget {
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    Press {
        #[serde(rename = "deviceId")]
        device_id: String,
        button: Button,
        #[serde(rename = "requestId")]
        request_id: String,
    },
}
impl Data {
    pub fn snapshot(&self, config: &str) -> Value {
        json!({"devices":self.devices,"receipts":self.receipts.iter().rev().take(30).collect::<Vec<_>>(),"version":env!("CARGO_PKG_VERSION"),"mcpConfig":config,"cloud":"not_connected"})
    }
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
