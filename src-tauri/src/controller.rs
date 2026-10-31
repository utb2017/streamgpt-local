use crate::{
    lg,
    model::{now, Brand, Data, Device, Input, Receipt},
    network, roku,
    vault::Vault,
};
use serde_json::{json, Value};
use uuid::Uuid;
pub struct Controller {
    pub data: Data,
    pub vault: Vault,
    pub config: String,
}
impl Controller {
    pub fn new(vault: Vault) -> Result<Self, String> {
        let mut data: Data = vault.read("devices.bin")?.unwrap_or_default();
        for d in &mut data.devices {
            d.reachable = false;
        }
        let exe = std::env::current_exe().map_err(|_| "Cannot locate executable.")?;
        let config = serde_json::to_string_pretty(
            &json!({"mcpServers":{"streamgpt-local":{"command":exe,"args":["--mcp"]}}}),
        )
        .unwrap();
        Ok(Self {
            data,
            vault,
            config,
        })
    }
    fn save(&self) -> Result<(), String> {
        self.vault.write("devices.bin", &self.data)
    }
    pub async fn dispatch(&mut self, input: Input) -> Result<Value, String> {
        match input {
            Input::Snapshot {} => Ok(self.data.snapshot(&self.config)),
            Input::Discover {} => network::discover().await,
            Input::Add { host, brand, name } => {
                network::private_host(&host)?;
                if name.trim().is_empty() || name.len() > 120 {
                    return Err("Choose a name of 1–60 characters.".into());
                }
                if self.data.devices.len() >= 32 {
                    return Err("Remove an unused device before adding another.".into());
                }
                if self.data.devices.iter().any(|d| d.host == host) {
                    return Err("This address is already saved.".into());
                }
                self.data.devices.push(Device {
                    id: Uuid::new_v4().to_string(),
                    name: name.trim().into(),
                    host,
                    model: if brand == Brand::Lg {
                        "LG webOS"
                    } else {
                        "Roku"
                    }
                    .into(),
                    brand,
                    paired: false,
                    reachable: false,
                    last_seen: None,
                });
                self.save()?;
                Ok(self.data.snapshot(&self.config))
            }
            Input::Forget { device_id } => {
                self.index(&device_id)?;
                self.data.devices.retain(|d| d.id != device_id);
                self.data.keys.remove(&device_id);
                self.save()?;
                Ok(self.data.snapshot(&self.config))
            }
            Input::Pair { device_id } => self.inspect(&device_id, true).await,
            Input::Inspect { device_id } => self.inspect(&device_id, false).await,
            Input::Press {
                device_id,
                button,
                request_id,
            } => {
                let i = self.index(&device_id)?;
                let device = self.data.devices[i].clone();
                if let Some(prior) = duplicate(&self.data, &request_id, &device_id, &button)? {
                    return Ok(
                        json!({"snapshot":self.data.snapshot(&self.config),"receipt":prior}),
                    );
                }
                if !device.paired {
                    return Err("Connect this TV in the desktop app first.".into());
                }
                if self.data.receipts.len() >= 5000 {
                    return Err("Command journal is full. No command was sent.".into());
                }
                let receipt = Receipt {
                    id: request_id.clone(),
                    device_id: device_id.clone(),
                    button: button.clone(),
                    status: "uncertain".into(),
                    at: now(),
                    message: "Reserved. This request will never be automatically repeated.".into(),
                };
                self.data.receipts.push(receipt);
                self.save()?; // Durable reservation before network I/O.
                let result = match device.brand {
                    Brand::Roku => roku::press(&device.host, &button).await.map(|_| "accepted"),
                    Brand::Lg => match lg::Session::open(
                        &device.host,
                        self.data.keys.get(&device_id).map(String::as_str),
                    )
                    .await
                    {
                        Ok(mut s) => s.press(&button).await,
                        Err(e) => Err(e),
                    },
                };
                let receipt = self.data.receipts.last_mut().unwrap();
                receipt.status = result
                    .as_ref()
                    .map(|s| s.to_string())
                    .unwrap_or("uncertain".into());
                receipt.message=if receipt.status=="accepted"{"Device acknowledged the request. The visible effect is not independently confirmed."}else{"Delivery was not confirmed. Check the TV before repeating. This request will not be resent."}.into();
                let receipt = receipt.clone();
                self.data.devices[i].reachable = result.is_ok();
                self.save()?;
                Ok(json!({"snapshot":self.data.snapshot(&self.config),"receipt":receipt}))
            }
        }
    }
    fn index(&self, id: &str) -> Result<usize, String> {
        Uuid::parse_str(id).map_err(|_| "Invalid device ID.")?;
        self.data
            .devices
            .iter()
            .position(|d| d.id == id)
            .ok_or("Choose a saved device first.".into())
    }
    async fn inspect(&mut self, id: &str, pair: bool) -> Result<Value, String> {
        let i = self.index(id)?;
        let d = self.data.devices[i].clone();
        if !pair && !d.paired {
            return Err("Connect this TV in the desktop app first.".into());
        }
        let result = match d.brand {
            Brand::Roku => roku::inspect(&d.host).await,
            Brand::Lg => {
                match lg::Session::open(&d.host, self.data.keys.get(id).map(String::as_str)).await {
                    Ok(mut s) => {
                        self.data.keys.insert(id.into(), s.credentials());
                        self.save()?;
                        if pair {
                            Ok(json!({"paired":true}))
                        } else {
                            s.inspect().await
                        }
                    }
                    Err(e) => Err(e),
                }
            }
        };
        match result {
            Ok(info) => {
                let d = &mut self.data.devices[i];
                d.paired = true;
                d.reachable = true;
                d.last_seen = Some(now().to_string());
                if let Some(model) = info["model"].as_str() {
                    d.model = model.into();
                }
                self.save()?;
                Ok(json!({"snapshot":self.data.snapshot(&self.config),"info":info}))
            }
            Err(e) => {
                self.data.devices[i].reachable = false;
                self.save()?;
                Err(e)
            }
        }
    }
}
pub fn duplicate<'a>(
    data: &'a Data,
    id: &str,
    device: &str,
    button: &crate::model::Button,
) -> Result<Option<&'a Receipt>, String> {
    Uuid::parse_str(id).map_err(|_| "A UUID request ID is required.")?;
    if let Some(prior) = data.receipts.iter().find(|r| r.id == id) {
        if prior.device_id != device || &prior.button != button {
            return Err("Request ID belongs to a different command.".into());
        }
        return Ok(Some(prior));
    }
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Button;
    #[test]
    fn durable_receipts_prevent_replay_and_conflicts() {
        let id = Uuid::new_v4().to_string();
        let mut d = Data::default();
        d.receipts.push(Receipt {
            id: id.clone(),
            device_id: "tv".into(),
            button: Button::Home,
            status: "uncertain".into(),
            at: 0,
            message: "reserved".into(),
        });
        let restarted: Data = serde_json::from_slice(&serde_json::to_vec(&d).unwrap()).unwrap();
        assert!(duplicate(&restarted, &id, "tv", &Button::Home)
            .unwrap()
            .is_some());
        assert!(duplicate(&restarted, &id, "other", &Button::Home).is_err());
        assert!(duplicate(&restarted, &id, "tv", &Button::PowerOff).is_err());
    }
    #[test]
    fn snapshot_hides_pairing_keys() {
        let mut d = Data::default();
        d.keys.insert("tv".into(), "secret-client-key".into());
        assert!(!d.snapshot("").to_string().contains("secret-client-key"));
    }
    #[test]
    fn rejects_unknown_commands_and_extra_authority() {
        assert!(serde_json::from_value::<Input>(
            json!({"op":"press","deviceId":"a","requestId":"b","button":"shell"})
        )
        .is_err());
        assert!(
            serde_json::from_value::<Input>(json!({"op":"snapshot","actor":"forged"})).is_err()
        );
    }
}
