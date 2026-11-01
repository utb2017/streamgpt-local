//! Outbound account link. The renderer never sees bearer credentials or TV keys.
use crate::{
    model::{now, Brand, Button, Device, Input},
    vault::Vault,
    Shared,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{watch, Mutex};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use uuid::Uuid;
const ORIGIN: &str = "https://streamgpt.dev";
#[derive(Clone, Default, Serialize, Deserialize)]
struct Saved {
    grant: Option<Grant>,
    pending: Option<Pending>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    helper_id: String,
    token: String,
    expires_at: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    link_id: String,
    poll_token: String,
    user_code: String,
    approval_url: String,
    expires_at: u64,
}
struct Runtime {
    saved: Saved,
    online: bool,
    message: String,
}
#[derive(Default)]
struct Activity {
    seq: u64,
    events: Vec<Value>,
}
impl Activity {
    fn push(&mut self, job: &Job, phase: &str) {
        self.seq += 1;
        self.events
            .push(json!({"seq":self.seq,"id":job.id,"op":job.op,"phase":phase,"at":now()}));
        if self.events.len() > 30 {
            self.events.remove(0);
        }
    }
}
pub struct Cloud {
    controller: Shared,
    vault: Vault,
    state: Mutex<Runtime>,
    changed: watch::Sender<u64>,
    activity: Mutex<Activity>,
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudInput {
    Status {},
    Snapshot {},
    Action {
        action: Value,
    },
    Start {
        name: String,
    },
    OpenApproval {},
    OpenRemote {},
    Disconnect {},
    Ask {
        message: String,
        #[serde(rename = "requestId")]
        request_id: String,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Job {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    op: String,
    device_id: Option<String>,
    candidate_id: Option<String>,
    button: Option<Button>,
    request_id: Option<String>,
    expires_at: u64,
}
fn platform() -> &'static str {
    if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(75))
        .build()
        .map_err(|_| "Network unavailable.".into())
}
async fn read_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if status == 401 {
        return Err("Link this helper to StreamGPT again.".into());
    }
    let mut data = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Incomplete server response.")?;
        if data.len() + chunk.len() > 65536 {
            return Err("Server response too large.".into());
        }
        data.extend(chunk);
    }
    let parsed: Value = serde_json::from_slice(&data).map_err(|_| "Invalid server response.")?;
    if !status.is_success() {
        let code = parsed["error"].as_str().unwrap_or("");
        return Err(if matches!(code, "LG_APPROVAL_TIMEOUT" | "LG_APPROVAL_REJECTED" | "LG_PAIRING_INTERRUPTED" | "LG_SECURE_CONNECTION_FAILED" | "LG_CERTIFICATE_CHANGED" | "REMOTE_BUSY" | "HELPER_UNAVAILABLE" | "COMMAND_EXPIRED" | "ROKU_CONTROL_DISABLED") {
            code
        } else { "StreamGPT could not complete this request. Check status before repeating a connection or command." }.into());
    }
    Ok(parsed)
}
fn approval_valid(p: &Pending) -> bool {
    let Ok(url) = url::Url::parse(&p.approval_url) else {
        return false;
    };
    url.origin().ascii_serialization() == ORIGIN
        && url.path() == "/connect-helper"
        && url.query_pairs().count() == 1
        && url
            .query_pairs()
            .any(|(key, value)| key == "linkId" && value == p.link_id)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && Uuid::parse_str(&p.link_id).is_ok()
        && p.poll_token.len() >= 32
        && p.poll_token.len() <= 512
        && p.user_code.len() <= 32
        && p.expires_at > now()
        && p.expires_at <= now() + 660000
}
pub fn buttons(d: &Device) -> Vec<&'static str> {
    let mut values = vec![
        "home", "back", "up", "down", "left", "right", "select", "play", "rewind", "forward",
    ];
    if d.brand == Brand::Lg {
        values.extend(["pause", "volume_up", "volume_down", "mute", "power_off"]);
    }
    values
}
fn public_devices(devices: &[Device]) -> Value {
    json!(devices.iter().filter(|d|d.paired).take(32).map(|d| {
        let mut value = json!({"id":d.id,"name":public_label(&d.name),"brand":d.brand,"model":public_label(&d.model),"buttons":buttons(d),"reachable":d.reachable});
        if let Some(seen) = d.last_seen.as_deref().and_then(|v| v.parse::<u64>().ok()).filter(|v| *v <= 8_640_000_000_000_000) { value["lastSeen"] = json!(seen); }
        if d.brand == Brand::Roku { value["controlPermission"] = json!(d.control_permission.unwrap_or_default()); }
        value
    }).collect::<Vec<_>>())
}
fn public_label(value: &str) -> String {
    let text: String = value.chars().filter(|c| !c.is_control()).take(40).collect();
    if text.trim().is_empty() {
        "TV".into()
    } else {
        text.trim().into()
    }
}
fn valid_action(action: &Value) -> bool {
    let Some(obj) = action.as_object() else {
        return false;
    };
    if action.to_string().len() > 8192 {
        return false;
    }
    let allowed: &[&str] = match action["type"].as_str() {
        Some("refresh_devices" | "disconnect_samsung") => &["type"],
        Some("select_tv" | "get_tv_status") => &["type", "deviceId"],
        Some("discover_local" | "disconnect_helper") => &["type", "helperId"],
        Some("connect_local") => &["type", "helperId", "candidateId"],
        Some("send_tv_command") => &[
            "type",
            "deviceId",
            "component",
            "capability",
            "command",
            "arguments",
            "requestId",
        ],
        _ => return false,
    };
    obj.keys().all(|key| allowed.contains(&key.as_str()))
}
fn public_info(info: &Value) -> Value {
    let mut result = json!({"online":true});
    if let Some(reachable) = info["reachable"].as_bool() {
        result["reachable"] = json!(reachable);
    }
    if let Some(seen) = info["lastSeen"]
        .as_u64()
        .filter(|v| *v <= 8_640_000_000_000_000)
    {
        result["lastSeen"] = json!(seen);
    }
    if let Ok(permission) =
        serde_json::from_value::<crate::model::ControlPermission>(info["controlPermission"].clone())
    {
        result["controlPermission"] = json!(permission);
    }
    if let Some(power) = info["power"].as_str() {
        result["power"] = json!(match power.to_ascii_lowercase().as_str() {
            "poweron" | "on" => "on",
            "poweroff" | "off" | "standby" | "headless" => "off",
            _ => "unknown",
        });
    }
    if let Some(volume) = info["volume"]
        .as_u64()
        .or_else(|| info["volumeStatus"]["volume"].as_u64())
        .filter(|n| *n <= 100)
    {
        result["volume"] = json!(volume);
    }
    if let Some(muted) = info["muted"]
        .as_bool()
        .or_else(|| info["volumeStatus"]["mute"].as_bool())
    {
        result["muted"] = json!(muted);
    }
    result
}
fn public_receipt(receipt: &Value) -> Value {
    let mut result =
        json!({"id":receipt["id"],"status":receipt["status"],"message":receipt["message"]});
    if receipt["status"] == "rejected" && receipt["reason"] == "ROKU_CONTROL_DISABLED" {
        result["reason"] = json!("ROKU_CONTROL_DISABLED");
    }
    result
}
fn valid_job(j: &Job) -> bool {
    j.kind == "request"
        && Uuid::parse_str(&j.id).is_ok()
        && j.expires_at > now()
        && j.expires_at <= now() + 65000
        && match j.op.as_str() {
            "discover" => {
                j.device_id.is_none()
                    && j.candidate_id.is_none()
                    && j.button.is_none()
                    && j.request_id.is_none()
            }
            "connect" => {
                j.candidate_id
                    .as_ref()
                    .is_some_and(|s| Uuid::parse_str(s).is_ok())
                    && j.device_id.is_none()
                    && j.button.is_none()
                    && j.request_id.is_none()
            }
            "inspect" => {
                j.device_id
                    .as_ref()
                    .is_some_and(|s| Uuid::parse_str(s).is_ok())
                    && j.candidate_id.is_none()
                    && j.button.is_none()
                    && j.request_id.is_none()
            }
            "press" => {
                j.device_id
                    .as_ref()
                    .is_some_and(|s| Uuid::parse_str(s).is_ok())
                    && j.candidate_id.is_none()
                    && j.button.is_some()
                    && j.request_id
                        .as_ref()
                        .is_some_and(|s| Uuid::parse_str(s).is_ok())
            }
            _ => false,
        }
}
impl Cloud {
    pub fn new(controller: Shared) -> Result<Arc<Self>, String> {
        let vault = Vault::open()?;
        let saved = vault.read::<Saved>("cloud.bin")?.unwrap_or_default();
        let (changed, _) = watch::channel(0);
        Ok(Arc::new(Self {
            controller,
            vault,
            state: Mutex::new(Runtime {
                saved,
                online: false,
                message: String::new(),
            }),
            changed,
            activity: Mutex::new(Activity::default()),
        }))
    }
    async fn persist(&self, saved: &Saved) -> Result<(), String> {
        self.vault.write("cloud.bin", saved)
    }
    async fn status(&self) -> Value {
        let s = self.state.lock().await;
        let activity = self.activity.lock().await;
        json!({"status":if s.online{"connected"}else if s.saved.grant.is_some(){"offline"}else if s.saved.pending.is_some(){"pending"}else{"not_connected"},"platform":platform(),"message":s.message,"helperId":s.saved.grant.as_ref().map(|g|&g.helper_id),"pending":s.saved.pending.as_ref().map(|p|json!({"userCode":p.user_code,"approvalUrl":p.approval_url,"expiresAt":p.expires_at})),"activity":activity.events})
    }
    async fn authenticated(&self, path: &str, payload: Option<Value>) -> Result<Value, String> {
        let grant = self
            .state
            .lock()
            .await
            .saved
            .grant
            .clone()
            .ok_or("Link this helper to your StreamGPT account first.")?;
        if grant.expires_at <= now() {
            return Err("Link this helper again.".into());
        }
        let client = client()?;
        let builder = if let Some(payload) = payload {
            client.post(format!("{ORIGIN}{path}")).json(&payload)
        } else {
            client.get(format!("{ORIGIN}{path}"))
        };
        let value = read_json(
            builder
                .bearer_auth(&grant.token)
                .send()
                .await
                .map_err(|_| {
                    "Response interrupted. Check status before repeating a connection or command."
                })?,
        )
        .await?;
        if self
            .state
            .lock()
            .await
            .saved
            .grant
            .as_ref()
            .map(|g| &g.token)
            != Some(&grant.token)
        {
            return Err("Account link changed. Refresh the remote.".into());
        }
        Ok(value)
    }
    pub async fn command(&self, app: tauri::AppHandle, input: CloudInput) -> Result<Value, String> {
        match input {
            CloudInput::Status {} => {}
            CloudInput::OpenRemote {} => {
                app.opener()
                    .open_url(format!("{ORIGIN}/app"), None::<&str>)
                    .map_err(|_| "Could not open your browser.")?;
            }
            CloudInput::Snapshot {} => {
                return self.authenticated("/api/helpers/snapshot", None).await
            }
            CloudInput::Action { action } => {
                if !valid_action(&action) {
                    return Err("Unsupported remote action.".into());
                }
                return self
                    .authenticated("/api/helpers/action", Some(json!({"action":action})))
                    .await;
            }
            CloudInput::Start { name } => {
                let name = name.trim();
                if name.is_empty()
                    || name.encode_utf16().count() > 80
                    || name.chars().any(char::is_control)
                {
                    return Err("Choose a short name for this helper.".into());
                }
                let generation = {
                    let state = self.state.lock().await;
                    if state.saved.grant.is_some() {
                        return Err("Disconnect this helper before linking another account.".into());
                    }
                    *self.changed.borrow()
                };
                let value = read_json(
                    client()?
                        .post(format!("{ORIGIN}/api/helpers/link/start"))
                        .json(&json!({"name":name,"platform":platform()}))
                        .send()
                        .await
                        .map_err(|_| "Could not reach StreamGPT.")?,
                )
                .await?;
                let pending: Pending =
                    serde_json::from_value(value).map_err(|_| "Invalid linking response.")?;
                if !approval_valid(&pending) {
                    return Err("Invalid linking response.".into());
                }
                let mut state = self.state.lock().await;
                if *self.changed.borrow() != generation || state.saved.grant.is_some() {
                    return Err("Link changed while waiting. Check its current status.".into());
                }
                let saved = Saved {
                    grant: None,
                    pending: Some(pending),
                };
                self.persist(&saved).await?;
                state.saved = saved;
                state.message =
                    "Open approval and sign in to the same StreamGPT account you use in ChatGPT."
                        .into();
                self.changed.send_modify(|v| *v += 1);
            }
            CloudInput::OpenApproval {} => {
                let state = self.state.lock().await;
                let p = state.saved.pending.as_ref().ok_or("Start linking first.")?;
                if !approval_valid(p) {
                    return Err("Approval expired. Start linking again.".into());
                }
                app.opener()
                    .open_url(&p.approval_url, None::<&str>)
                    .map_err(|_| "Could not open your browser.")?;
            }
            CloudInput::Disconnect {} => {
                let mut s = self.state.lock().await;
                // Cancel in-flight native work immediately; cloud persistence has no controller lock.
                self.changed.send_modify(|v| *v += 1);
                self.persist(&Saved::default()).await?;
                s.saved = Saved::default();
                s.online = false;
                self.activity.lock().await.events.clear();
                s.message="Sharing stopped on this device. You can remove its listing in StreamGPT's Connection view.".into();
                self.changed.send_modify(|v| *v += 1);
            }
            CloudInput::Ask {
                message,
                request_id,
            } => {
                if message.trim().is_empty()
                    || message.chars().count() > 600
                    || Uuid::parse_str(&request_id).is_err()
                {
                    return Err("Enter a short request.".into());
                }
                return self
                    .authenticated(
                        "/api/helpers/ask",
                        Some(json!({"message":message,"requestId":request_id})),
                    )
                    .await;
            }
        }
        Ok(self.status().await)
    }
    async fn claim(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        let Some(p) = state.saved.pending.clone() else {
            return Ok(());
        };
        if p.expires_at <= now() {
            state.saved.pending = None;
            self.persist(&state.saved).await?;
            state.message = "Approval expired. Start linking again.".into();
            return Ok(());
        }
        let generation = *self.changed.borrow();
        drop(state); // Status and Disconnect remain responsive during a slow HTTP request.
        let value = read_json(
            client()?
                .post(format!("{ORIGIN}/api/helpers/link/claim"))
                .json(&json!({"linkId":p.link_id,"pollToken":p.poll_token}))
                .send()
                .await
                .map_err(|_| "Waiting for StreamGPT.")?,
        )
        .await?;
        self.claim_result(&p, generation, value).await
    }
    async fn claim_result(&self, p: &Pending, generation: u64, value: Value) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if *self.changed.borrow() != generation
            || state.saved.pending.as_ref().map(|current| &current.link_id) != Some(&p.link_id)
        {
            return Ok(());
        }
        if value["status"] == "linked" {
            let grant: Grant =
                serde_json::from_value(value).map_err(|_| "Invalid account link.")?;
            if p.expires_at <= now()
                || grant.helper_id != p.link_id
                || Uuid::parse_str(&grant.helper_id).is_err()
                || grant.token.len() < 32
                || grant.token.len() > 2048
                || grant.expires_at <= now()
            {
                return Err("Invalid account link.".into());
            }
            let saved = Saved {
                grant: Some(grant),
                pending: None,
            };
            self.persist(&saved).await?;
            state.saved = saved;
            state.message = "Account linked. Connecting your helper.".into();
        }
        Ok(())
    }
    pub async fn run(self: Arc<Self>) {
        let mut changed = self.changed.subscribe();
        loop {
            // Observe the epoch before reading authority. Consuming it after cloning a
            // grant could lose a concurrent disconnect and reconnect the old account.
            let _ = *changed.borrow_and_update();
            let saved = self.state.lock().await.saved.clone();
            if saved.pending.is_some() {
                if let Err(e) = self.claim().await {
                    self.state.lock().await.message = e;
                }
            }
            let grant = self.state.lock().await.saved.grant.clone();
            if let Some(grant) = grant {
                if grant.expires_at <= now() {
                    let mut state = self.state.lock().await;
                    state.online = false;
                    state.message = "Account link expired. Disconnect and link again.".into();
                } else {
                    let result = self.socket(&grant, &mut changed).await;
                    let mut state = self.state.lock().await;
                    state.online = false;
                    if let Err(e) = result {
                        state.message = e;
                    }
                }
            }
            tokio::select! {_ = tokio::time::sleep(Duration::from_secs(5))=>{},_ = changed.changed()=>{}}
        }
    }
    async fn hello(&self) -> Message {
        let c = self.controller.lock().await;
        Message::Text(
            json!({"type":"hello","devices":public_devices(&c.data.devices)})
                .to_string()
                .into(),
        )
    }
    async fn socket(
        &self,
        grant: &Grant,
        changed: &mut watch::Receiver<u64>,
    ) -> Result<(), String> {
        let url = format!(
            "wss://streamgpt.dev/api/helpers/socket?helperId={}",
            grant.helper_id
        );
        self.socket_at(grant, changed, &url).await
    }
    // Private transport seam for loopback-only tests; renderer/server cannot choose a URL.
    async fn socket_at(
        &self,
        grant: &Grant,
        changed: &mut watch::Receiver<u64>,
        url: &str,
    ) -> Result<(), String> {
        let mut request = url
            .into_client_request()
            .map_err(|_| "Invalid helper route.")?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", grant.token)
                .parse()
                .map_err(|_| "Invalid helper credential.")?,
        );
        let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(65536))
            .max_frame_size(Some(65536));
        // Keep cloud trust separate from LG's local, explicitly approved certificates.
        let roots = rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| "Cloud TLS unavailable.")?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let connection = tokio_tungstenite::connect_async_tls_with_config(
            request,
            Some(config),
            false,
            Some(tokio_tungstenite::Connector::Rustls(Arc::new(tls))),
        );
        let (mut socket, _) = tokio::select! {_ = changed.changed()=>return Ok(()), result=tokio::time::timeout(Duration::from_secs(12),connection)=>result.map_err(|_|"StreamGPT connection timed out.")?.map_err(|_|"Helper offline. Reconnecting to StreamGPT; no remote commands will be replayed.")?};
        let mut inventory = self.hello().await;
        socket
            .send(inventory.clone())
            .await
            .map_err(|_| "Connection closed.")?;
        {
            let mut s = self.state.lock().await;
            if s.saved.grant.as_ref().map(|g| &g.token) != Some(&grant.token) {
                return Err("Account link changed. Helper disconnected.".into());
            }
            s.online = true;
            s.message =
                "Connected to StreamGPT. Approved TVs are available to your account.".into();
        }
        let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
        heartbeat.tick().await; // Initial inventory already supplied this heartbeat.
        let mut last_received = tokio::time::Instant::now();
        let mut candidates: HashMap<String, (u64, Value)> = HashMap::new();
        loop {
            tokio::select! {
                biased;
                _=changed.changed()=>{let _=socket.close(None).await;return Ok(());},
                _=heartbeat.tick()=>{
                    if grant.expires_at<=now(){return Err("Account link expired.".into());}
                    if last_received.elapsed()>Duration::from_secs(65){return Err("Server stopped responding.".into());}
                    socket.send(Message::Ping(Vec::new().into())).await.map_err(|_|"Connection closed.")?;
                    inventory=self.hello().await;
                    socket.send(inventory.clone()).await.map_err(|_|"Connection closed.")?;
                },
                frame=tokio::time::timeout(Duration::from_secs(65),socket.next())=>{
                    let frame=frame.map_err(|_|"Server stopped responding.")?.ok_or("Connection closed.")?.map_err(|_|"Connection closed.")?;
                    last_received=tokio::time::Instant::now();
                    match frame {
                        Message::Text(text)=>{
                            let job:Job=match serde_json::from_str(&text){Ok(j) if valid_job(&j)=>j,_=>continue};
                            // Refresh server liveness before a potentially long LG approval.
                            socket.send(inventory.clone()).await.map_err(|_|"Connection closed.")?;
                            let operation=self.dispatch(&job,&mut candidates);
                            tokio::pin!(operation);
                            let result=loop {
                                tokio::select! {
                                    biased;
                                    _=changed.changed()=>{self.activity.lock().await.push(&job,"failed");return Ok(());},
                                    frame=socket.next()=>{
                                        last_received=tokio::time::Instant::now();
                                        match frame {
                                            Some(Ok(Message::Ping(bytes)))=>{socket.send(Message::Pong(bytes)).await.map_err(|_|"Connection closed.")?;},
                                            Some(Ok(Message::Pong(_)))=>{},
                                            _=>{self.activity.lock().await.push(&job,"failed");return Err("Helper connection interrupted. Check TV status before repeating a request.".into());}
                                        }
                                    },
                                    result=&mut operation=>break result
                                }
                            };
                            let response=match result{Ok(result)=>json!({"type":"result","id":job.id,"ok":true,"result":result}),Err(error)=>json!({"type":"result","id":job.id,"ok":false,"error":error})};
                            socket.send(Message::Text(response.to_string().into())).await.map_err(|_|"Connection closed. Check the TV before repeating commands.")?;
                            inventory=self.hello().await;
                            socket.send(inventory.clone()).await.map_err(|_|"Connection closed.")?;
                        },
                        Message::Ping(bytes)=>{socket.send(Message::Pong(bytes)).await.map_err(|_|"Connection closed.")?;},
                        Message::Close(_)=>return Err("Helper disconnected. Check the account connection.".into()),
                        _=>{}
                    }
                }
            }
        }
    }
    async fn dispatch(
        &self,
        job: &Job,
        candidates: &mut HashMap<String, (u64, Value)>,
    ) -> Result<Value, String> {
        if !valid_job(job) {
            return Err("Request expired or invalid. No command sent.".into());
        }
        self.activity.lock().await.push(job, "started");
        // Includes waiting for the controller and vendor registration. An expired
        // press must not send a button after a slow LG reconnect finishes.
        let result = tokio::time::timeout(
            Duration::from_millis(job.expires_at.saturating_sub(now())),
            self.dispatch_inner(job, candidates),
        )
        .await
        .unwrap_or_else(|_| Err("Request expired. Check TV status before trying again.".into()));
        self.activity.lock().await.push(
            job,
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            },
        );
        result
    }
    async fn dispatch_inner(
        &self,
        job: &Job,
        candidates: &mut HashMap<String, (u64, Value)>,
    ) -> Result<Value, String> {
        let mut controller = self.controller.lock().await;
        if !valid_job(job) {
            return Err("Request expired or invalid. No command sent.".into());
        }
        match job.op.as_str() {
            "discover" => {
                let found = controller.dispatch(Input::Discover {}).await?;
                candidates.clear();
                let mut public = Vec::new();
                for c in found
                    .as_array()
                    .ok_or("Invalid discovery response.")?
                    .iter()
                    .take(32)
                {
                    let id = Uuid::new_v4().to_string();
                    candidates.insert(id.clone(), (now() + 300000, c.clone()));
                    public.push(json!({"candidateId":id,"name":public_label(c["name"].as_str().unwrap_or("TV")),"brand":c["brand"],"model":public_label(c["model"].as_str().unwrap_or("TV"))}));
                }
                Ok(json!({"candidates":public}))
            }
            "connect" => {
                let (expires, candidate) = candidates
                    .remove(job.candidate_id.as_ref().unwrap())
                    .ok_or("Search again before connecting this TV.")?;
                if expires <= now() {
                    return Err("Discovery expired. Search again.".into());
                }
                let host = candidate["host"]
                    .as_str()
                    .ok_or("Invalid discovered address.")?
                    .to_owned();
                let brand: Brand = serde_json::from_value(candidate["brand"].clone())
                    .map_err(|_| "Unsupported TV.")?;
                let existing = controller
                    .data
                    .devices
                    .iter()
                    .find(|d| d.host == host && d.brand == brand)
                    .map(|d| d.id.clone());
                let id = if let Some(id) = existing {
                    id
                } else {
                    controller
                        .dispatch(Input::Add {
                            host,
                            brand,
                            name: candidate["name"]
                                .as_str()
                                .unwrap_or("TV")
                                .chars()
                                .take(40)
                                .collect(),
                        })
                        .await?;
                    controller
                        .data
                        .devices
                        .last()
                        .ok_or("TV was not saved.")?
                        .id
                        .clone()
                };
                if job.expires_at <= now() {
                    return Err("Connection request expired.".into());
                }
                controller.dispatch(Input::Pair { device_id: id }).await?;
                Ok(json!({"devices":public_devices(&controller.data.devices)}))
            }
            "inspect" => {
                let value = controller
                    .dispatch(Input::Inspect {
                        device_id: job.device_id.clone().unwrap(),
                    })
                    .await?;
                Ok(json!({"info":public_info(&value["info"])}))
            }
            "press" => {
                let device = controller
                    .data
                    .devices
                    .iter()
                    .find(|d| Some(&d.id) == job.device_id.as_ref() && d.paired)
                    .ok_or("TV is not approved.")?;
                let button = job.button.clone().unwrap();
                let button_name = serde_json::to_value(&button).unwrap();
                if !buttons(device).contains(&button_name.as_str().unwrap_or_default()) {
                    return Err("This button is not supported for this device.".into());
                }
                let device_id = device.id.clone();
                let value = controller
                    .dispatch(Input::Press {
                        device_id,
                        button,
                        request_id: job.request_id.clone().unwrap(),
                    })
                    .await?;
                Ok(json!({"receipt":public_receipt(&value["receipt"])}))
            }
            _ => Err("Unsupported request.".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn connection_failure_codes_are_bounded_and_never_echo_provider_text() {
        for (code, expected) in [
            ("LG_APPROVAL_TIMEOUT", "LG_APPROVAL_TIMEOUT"),
            ("LG_SECURE_CONNECTION_FAILED", "LG_SECURE_CONNECTION_FAILED"),
            ("REMOTE_BUSY", "REMOTE_BUSY"),
            ("HELPER_UNAVAILABLE", "HELPER_UNAVAILABLE"),
            ("ROKU_CONTROL_DISABLED", "ROKU_CONTROL_DISABLED"),
            ("private pairing key and address", "StreamGPT could not complete this request. Check status before repeating a connection or command."),
        ] {
            let router = axum::Router::new().route("/", axum::routing::get(move || async move {
                (axum::http::StatusCode::BAD_GATEWAY, axum::Json(json!({"error":code})))
            }));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
            let response = client().unwrap().get(format!("http://{addr}/")).send().await.unwrap();
            assert_eq!(read_json(response).await.unwrap_err(), expected);
            server.abort();
        }
    }
    #[tokio::test]
    async fn unauthorized_is_exact_auth_message_even_with_non_json_body() {
        let router = axum::Router::new().route(
            "/",
            axum::routing::get(|| async {
                (axum::http::StatusCode::UNAUTHORIZED, "private invalid body")
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let response = client()
            .unwrap()
            .get(format!("http://{addr}/"))
            .send()
            .await
            .unwrap();
        assert_eq!(
            read_json(response).await.unwrap_err(),
            "Link this helper to StreamGPT again."
        );
        server.abort();
    }

    fn isolated_cloud() -> (tempfile::TempDir, Arc<Cloud>, Grant) {
        let dir = tempfile::tempdir().unwrap();
        let controller = Arc::new(Mutex::new(crate::controller::Controller {
            data: crate::model::Data::default(),
            vault: Vault::isolated_test(dir.path().to_path_buf()),
            config: String::new(),
        }));
        let grant = Grant {
            helper_id: Uuid::new_v4().to_string(),
            token: "synthetic-test-token".into(),
            expires_at: now() + 60000,
        };
        let (changed, _) = watch::channel(0);
        let cloud = Arc::new(Cloud {
            controller,
            vault: Vault::isolated_test(dir.path().to_path_buf()),
            state: Mutex::new(Runtime {
                saved: Saved {
                    grant: Some(grant.clone()),
                    pending: None,
                },
                online: false,
                message: String::new(),
            }),
            changed,
            activity: Mutex::new(Activity::default()),
        });
        (dir, cloud, grant)
    }
    #[tokio::test]
    async fn status_and_link_persistence_do_not_wait_for_tv_controller() {
        let (_dir, cloud, _) = isolated_cloud();
        let _busy = cloud.controller.lock().await;
        tokio::time::timeout(Duration::from_millis(200), cloud.status())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_millis(200), cloud.persist(&Saved::default()))
            .await
            .unwrap()
            .unwrap();
    }
    #[tokio::test]
    async fn late_claim_cannot_restore_disconnected_or_replaced_authority() {
        let (_dir, cloud, mut grant) = isolated_cloud();
        let id = Uuid::new_v4().to_string();
        grant.helper_id = id.clone();
        let pending = Pending {
            link_id: id.clone(),
            poll_token: "a".repeat(64),
            user_code: "ABCD-EFGH".into(),
            approval_url: format!("{ORIGIN}/connect-helper?linkId={id}"),
            expires_at: now() + 600000,
        };
        cloud.state.lock().await.saved = Saved {
            grant: None,
            pending: Some(pending.clone()),
        };
        let mut response = serde_json::to_value(grant).unwrap();
        response["status"] = json!("linked");
        cloud.changed.send_modify(|v| *v += 1);
        cloud.state.lock().await.saved = Saved::default();
        cloud.claim_result(&pending, 0, response).await.unwrap();
        assert!(cloud.state.lock().await.saved.grant.is_none());
    }
    #[tokio::test]
    async fn deadline_includes_controller_wait_and_never_dispatches_late() {
        let (_dir, cloud, _) = isolated_cloud();
        let guard = cloud.controller.lock().await;
        let job:Job=serde_json::from_value(json!({"type":"request","id":Uuid::new_v4(),"op":"press","deviceId":Uuid::new_v4(),"button":"home","requestId":Uuid::new_v4(),"expiresAt":now()+30})).unwrap();
        let mut candidates = HashMap::new();
        let result = cloud.dispatch(&job, &mut candidates).await;
        assert!(result.unwrap_err().contains("expired"));
        assert!(guard.data.receipts.is_empty());
        let activity = cloud.activity.lock().await;
        assert_eq!(activity.events.len(), 2);
        assert_eq!(activity.events[1]["phase"], "failed");
    }
    #[tokio::test]
    async fn socket_close_cancels_pending_native_work_without_tv_io() {
        let (_dir, cloud, grant) = isolated_cloud();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/fixture", listener.local_addr().unwrap());
        let (ready, wait_ready) = tokio::sync::oneshot::channel();
        let (send_job, wait_job) = tokio::sync::oneshot::channel();
        let job_id = Uuid::new_v4().to_string();
        let expected = job_id.clone();
        let observer = cloud.clone();
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let hello = socket.next().await.unwrap().unwrap();
            assert!(hello.into_text().unwrap().contains("hello"));
            ready.send(()).unwrap();
            wait_job.await.unwrap();
            socket.send(Message::Text(json!({"type":"request","id":job_id,"op":"inspect","deviceId":Uuid::new_v4(),"expiresAt":now()+10000}).to_string().into())).await.unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while !observer
                    .activity
                    .lock()
                    .await
                    .events
                    .iter()
                    .any(|e| e["id"] == job_id && e["phase"] == "started")
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            socket.close(None).await.unwrap();
        });
        let worker = cloud.clone();
        let task = tokio::spawn(async move {
            let mut changed = worker.changed.subscribe();
            worker.socket_at(&grant, &mut changed, &url).await
        });
        wait_ready.await.unwrap();
        let guard = cloud.controller.lock().await;
        send_job.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert!(result.is_err());
        assert!(guard.data.receipts.is_empty());
        let events = &cloud.activity.lock().await.events;
        assert!(events
            .iter()
            .any(|e| e["id"] == expected && e["phase"] == "failed"));
        peer.await.unwrap();
    }
    #[test]
    fn approval_is_bound_to_exact_origin_and_link() {
        let id = Uuid::new_v4().to_string();
        let mut pending = Pending {
            link_id: id.clone(),
            poll_token: "a".repeat(64),
            user_code: "ABCD-EFGH".into(),
            approval_url: format!("{ORIGIN}/connect-helper?linkId={id}"),
            expires_at: now() + 600000,
        };
        assert!(approval_valid(&pending));
        for url in [
            format!("https://example.com/connect-helper?linkId={id}"),
            format!("{ORIGIN}/connect-helper?linkId={}", Uuid::new_v4()),
            format!("{ORIGIN}/connect-helper?linkId={id}&redirect=https://example.com"),
        ] {
            pending.approval_url = url;
            assert!(!approval_valid(&pending));
        }
    }
    #[test]
    fn renderer_actions_cannot_inject_routes_or_authority() {
        assert!(valid_action(
            &json!({"type":"get_tv_status","deviceId":"tv"})
        ));
        assert!(valid_action(
            &json!({"type":"connect_local","helperId":Uuid::new_v4(),"candidateId":Uuid::new_v4()})
        ));
        for value in [
            json!({"type":"fetch","url":"http://192.168.1.1"}),
            json!({"type":"refresh_devices","actor":"other"}),
            json!({"type":"connect_local","host":"192.168.1.1"}),
        ] {
            assert!(!valid_action(&value));
        }
        assert!(
            serde_json::from_value::<CloudInput>(json!({"op":"snapshot","token":"injected"}))
                .is_err()
        );
    }
    #[test]
    fn native_status_normalizes_provider_fields_without_metadata() {
        assert_eq!(
            public_info(&json!({"power":"PowerOn","serial":"private","host":"192.168.1.1"})),
            json!({"online":true,"power":"on"})
        );
        assert_eq!(
            public_info(&json!({"volumeStatus":{"volume":12,"mute":true},"client-key":"private"})),
            json!({"online":true,"volume":12,"muted":true})
        );
        assert_eq!(
            public_info(&json!({"volume":101,"power":"unrecognized"})),
            json!({"online":true,"power":"unknown"})
        );
    }
    #[test]
    fn cloud_receipt_matches_strict_wire_not_local_journal() {
        let id = Uuid::new_v4().to_string();
        let local = json!({"id":id,"status":"accepted","message":"Accepted.","device_id":"private","button":"home","at":now()});
        let wire = public_receipt(&local);
        assert_eq!(
            wire,
            json!({"id":id,"status":"accepted","message":"Accepted."})
        );
        assert_eq!(wire.as_object().unwrap().len(), 3);
        let denied = public_receipt(
            &json!({"id":id,"status":"rejected","message":"safe","reason":"ROKU_CONTROL_DISABLED"}),
        );
        assert_eq!(denied["reason"], "ROKU_CONTROL_DISABLED");
        for (status, reason) in [
            ("accepted", "ROKU_CONTROL_DISABLED"),
            ("rejected", "PRIVATE_PROVIDER_ERROR"),
        ] {
            assert!(public_receipt(
                &json!({"id":id,"status":status,"message":"safe","reason":reason})
            )
            .get("reason")
            .is_none());
        }
    }
    #[test]
    fn activity_is_bounded_ordered_and_has_no_provider_payload() {
        let job: Job = serde_json::from_value(
            json!({"type":"request","id":Uuid::new_v4(),"op":"discover","expiresAt":now()+10000}),
        )
        .unwrap();
        let mut log = Activity::default();
        for _ in 0..20 {
            log.push(&job, "started");
            log.push(&job, "completed");
        }
        assert_eq!(log.events.len(), 30);
        assert_eq!(log.events[0]["seq"], 11);
        assert_eq!(log.events[29]["seq"], 40);
        assert!(log.events.iter().all(|e| e.as_object().unwrap().len() == 5));
    }
    #[test]
    fn rejects_expired_or_overpowered_jobs() {
        let base =
            json!({"type":"request","id":Uuid::new_v4(),"op":"discover","expiresAt":now()+10000});
        assert!(valid_job(&serde_json::from_value(base.clone()).unwrap()));
        let mut value = base.clone();
        value["expiresAt"] = json!(now() - 1);
        assert!(!valid_job(&serde_json::from_value(value).unwrap()));
        let mut value = base;
        value["deviceId"] = json!(Uuid::new_v4());
        assert!(!valid_job(&serde_json::from_value(value).unwrap()));
    }
    #[test]
    fn projection_omits_lan_address_and_unpaired_devices() {
        let mut d = Device {
            id: Uuid::new_v4().to_string(),
            name: "Roku".into(),
            host: "192.168.1.2".into(),
            brand: Brand::Roku,
            model: "Express".into(),
            paired: true,
            reachable: true,
            last_seen: None,
            control_permission: None,
        };
        let value = public_devices(&[d.clone()]);
        assert!(!value.to_string().contains("192.168"));
        assert!(!buttons(&d).contains(&"volume_up"));
        d.paired = false;
        assert_eq!(public_devices(&[d]), json!([]));
    }
    fn native_wire_fixture() -> Value {
        let roku = Device {
            id: "11111111-1111-4111-8111-111111111111".into(),
            name: "Living room Roku".into(),
            host: "fixture.invalid".into(),
            brand: Brand::Roku,
            model: "Express".into(),
            paired: true,
            reachable: false,
            last_seen: Some("1700000000000".into()),
            control_permission: Some(crate::model::ControlPermission::Enabled),
        };
        let lg = Device {
            id: "33333333-3333-4333-8333-333333333333".into(),
            name: "Bedroom LG".into(),
            brand: Brand::Lg,
            model: "webOS".into(),
            control_permission: None,
            ..roku.clone()
        };
        let receipt = crate::model::Receipt {
            id: "22222222-2222-4222-8222-222222222222".into(),
            device_id: roku.id.clone(),
            button: Button::Play,
            status: "rejected".into(),
            at: 1700000000000,
            message: "Enable network control.".into(),
            reason: Some(crate::model::ReceiptReason::RokuControlDisabled),
        };
        json!({"devices":public_devices(&[roku,lg]),"deniedReceipt":public_receipt(&serde_json::to_value(receipt).unwrap())})
    }
    #[test]
    fn native_wire_serialization_matches_checked_fixture() {
        let expected: Value =
            serde_json::from_str(include_str!("../tests/native-wire-v1.json")).unwrap();
        assert_eq!(native_wire_fixture(), expected);
        for device in expected["devices"].as_array().unwrap() {
            for button in device["buttons"].as_array().unwrap() {
                let parsed: Button = serde_json::from_value(button.clone()).unwrap();
                assert_eq!(serde_json::to_value(parsed).unwrap(), *button);
            }
        }
    }
    #[test]
    #[ignore = "explicit fixture export only; set STREAMGPT_WIRE_FIXTURE_OUT"]
    fn export_native_wire_fixture() {
        let path =
            std::env::var("STREAMGPT_WIRE_FIXTURE_OUT").expect("explicit output path required");
        std::fs::write(
            path,
            serde_json::to_string_pretty(&native_wire_fixture()).unwrap() + "\n",
        )
        .unwrap();
    }
}
