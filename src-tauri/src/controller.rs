use crate::{
    lg,
    model::{now, Brand, ControlPermission, Data, Device, Input, Receipt, ReceiptReason},
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
                    control_permission: None,
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
                    reason: None,
                };
                self.data.receipts.push(receipt);
                self.save()?; // Durable reservation before network I/O.
                let blocked = device.brand == Brand::Roku
                    && device
                        .control_permission
                        .is_some_and(ControlPermission::blocked);
                let result = if blocked {
                    Err(roku::Error::ControlDisabled)
                } else {
                    match device.brand {
                        Brand::Roku => roku::press(&device.host, &button).await.map(|_| "accepted"),
                        Brand::Lg => match lg::Session::open(
                            &device.host,
                            self.data.keys.get(&device_id).map(String::as_str),
                        )
                        .await
                        {
                            Ok(mut s) => s.press(&button).await.map_err(roku::Error::from),
                            Err(e) => Err(e.into()),
                        },
                    }
                };
                let receipt = self.data.receipts.last_mut().unwrap();
                finish_press(&mut self.data.devices[i], receipt, result, !blocked);
                let receipt = receipt.clone();
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
            Ok(mut info) => {
                let d = &mut self.data.devices[i];
                d.paired = true;
                d.reachable = true;
                d.last_seen = Some(now().to_string());
                if d.brand == Brand::Roku {
                    d.control_permission = Some(
                        serde_json::from_value(info["controlPermission"].clone())
                            .unwrap_or_default(),
                    );
                    info["controlPermission"] = json!(d.control_permission);
                }
                info["reachable"] = json!(true);
                info["lastSeen"] = json!(now());
                if let Some(model) = info["model"].as_str() {
                    d.model = model.into();
                }
                self.save()?;
                Ok(json!({"snapshot":self.data.snapshot(&self.config),"info":info}))
            }
            Err(e) => {
                let d = &mut self.data.devices[i];
                d.reachable = e == "ROKU_CONTROL_DISABLED";
                if d.reachable {
                    d.control_permission = Some(ControlPermission::Disabled);
                    d.last_seen = Some(now().to_string());
                }
                self.save()?;
                Err(e)
            }
        }
    }
}
fn finish_press(
    device: &mut Device,
    receipt: &mut Receipt,
    result: Result<&str, roku::Error>,
    attempted: bool,
) {
    let denied = matches!(result, Err(roku::Error::ControlDisabled));
    receipt.status = if denied {
        "rejected".into()
    } else {
        result.as_ref().copied().unwrap_or("uncertain").into()
    };
    receipt.reason = denied.then_some(ReceiptReason::RokuControlDisabled);
    receipt.message = if denied {
        "On Roku: Settings > System > Advanced system settings > Control by mobile apps > Network access > Enabled. Then check status. This request will not be resent."
    } else if receipt.status == "accepted" {
        "Device acknowledged the request. The visible effect is not independently confirmed."
    } else {
        "Delivery was not confirmed. Check the TV before repeating. This request will not be resent."
    }.into();
    if attempted {
        device.reachable = result.is_ok() || denied;
        if device.reachable {
            device.last_seen = Some(now().to_string());
        }
        if denied {
            device.control_permission = Some(ControlPermission::Disabled);
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
    fn fixture_device(permission: ControlPermission) -> Device {
        Device {
            id: Uuid::new_v4().to_string(),
            name: "Fixture".into(),
            host: "invalid-fixture-host".into(),
            brand: Brand::Roku,
            model: "Express".into(),
            paired: true,
            reachable: false,
            last_seen: Some("1".into()),
            control_permission: Some(permission),
        }
    }
    fn fixture_receipt(device: &Device) -> Receipt {
        Receipt {
            id: Uuid::new_v4().to_string(),
            device_id: device.id.clone(),
            button: Button::Play,
            status: "uncertain".into(),
            at: now(),
            message: "reserved".into(),
            reason: None,
        }
    }
    #[test]
    fn denial_is_rejected_and_reachable_but_transport_failure_is_uncertain() {
        let mut device = fixture_device(ControlPermission::Unknown);
        let mut receipt = fixture_receipt(&device);
        finish_press(
            &mut device,
            &mut receipt,
            Err(roku::Error::ControlDisabled),
            true,
        );
        assert_eq!(receipt.status, "rejected");
        assert_eq!(receipt.reason, Some(ReceiptReason::RokuControlDisabled));
        assert!(device.reachable);
        assert_ne!(device.last_seen.as_deref(), Some("1"));
        assert_eq!(device.control_permission, Some(ControlPermission::Disabled));
        finish_press(
            &mut device,
            &mut receipt,
            Err(roku::Error::Other("timeout".into())),
            true,
        );
        assert_eq!(receipt.status, "uncertain");
        assert_eq!(receipt.reason, None);
        assert!(!device.reachable);
    }
    #[tokio::test]
    async fn blocked_preflight_is_durable_without_fabricating_reachability_or_replaying() {
        for permission in [ControlPermission::Limited, ControlPermission::Disabled] {
            let dir = tempfile::tempdir().unwrap();
            let mut controller = Controller::new(Vault::isolated_test(dir.path().into())).unwrap();
            let device = fixture_device(permission);
            let id = device.id.clone();
            let request = Uuid::new_v4().to_string();
            controller.data.devices.push(device);
            let command = || Input::Press {
                device_id: id.clone(),
                request_id: request.clone(),
                button: Button::Play,
            };
            let result = controller.dispatch(command()).await.unwrap();
            assert_eq!(result["receipt"]["status"], "rejected");
            assert_eq!(result["receipt"]["reason"], "ROKU_CONTROL_DISABLED");
            assert!(!controller.data.devices[0].reachable);
            assert_eq!(controller.data.devices[0].last_seen.as_deref(), Some("1"));
            let mut restarted = Controller::new(Vault::isolated_test(dir.path().into())).unwrap();
            restarted.data.devices[0].control_permission = Some(ControlPermission::Enabled);
            let replay = restarted.dispatch(command()).await.unwrap();
            assert_eq!(replay["receipt"], result["receipt"]);
            assert_eq!(restarted.data.receipts.len(), 1);
        }
    }
    #[test]
    fn old_storage_without_permission_or_reason_still_loads() {
        let device:Device=serde_json::from_value(json!({"id":"tv","name":"Roku","host":"fixture","brand":"roku","model":"Express","paired":true,"reachable":false,"lastSeen":"42"})).unwrap();
        assert_eq!(device.control_permission, None);
        assert_eq!(device.last_seen.as_deref(), Some("42"));
        let receipt:Receipt=serde_json::from_value(json!({"id":"r","deviceId":"tv","button":"play","status":"uncertain","at":0,"message":"reserved"})).unwrap();
        assert_eq!(receipt.reason, None);
    }
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
            reason: None,
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
