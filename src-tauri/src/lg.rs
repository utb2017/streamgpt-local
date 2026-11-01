use crate::{model::Button, network::private_host};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    client_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
    MaybeTlsStream, WebSocketStream,
};
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
#[derive(Clone, Serialize, Deserialize)]
struct Pairing {
    key: String,
    secure: bool,
    fingerprint: Option<String>,
}
fn fingerprint(cert: &[u8]) -> String {
    Sha256::digest(cert)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect()
}
// LG's older webOS firmware serves X.509 v1 certificates. The platform TLS
// stack supports these while still verifying TLS handshake signatures. Trust is
// established by explicit TV approval, then the exact certificate is pinned.
fn peer_fingerprint(stream: &MaybeTlsStream<TcpStream>) -> Result<Option<String>, String> {
    match stream {
        MaybeTlsStream::NativeTls(tls) => {
            let cert = tls
                .get_ref()
                .peer_certificate()
                .map_err(|_| "LG certificate unavailable.")?
                .ok_or("LG certificate unavailable.")?;
            let der = cert.to_der().map_err(|_| "LG certificate unavailable.")?;
            Ok(Some(fingerprint(&der)))
        }
        MaybeTlsStream::Plain(_) => Ok(None),
        _ => Err("Unsupported LG TLS connection.".into()),
    }
}
fn verify_pin(expected: Option<&str>, actual: Option<&str>) -> Result<(), String> {
    if let Some(expected) = expected {
        if actual != Some(expected) {
            return Err("LG_CERTIFICATE_CHANGED".into());
        }
    }
    Ok(())
}
async fn socket(url: &str, pin: Option<String>) -> Result<Socket, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid LG socket.")?;
    let host = parsed.host_str().ok_or("Invalid LG socket.")?;
    let port = parsed.port().ok_or("Invalid LG socket.")?;
    if !matches!(parsed.scheme(), "ws" | "wss") {
        return Err("Invalid LG socket.".into());
    }
    let connect = async {
        let tcp = TcpStream::connect((host, port)).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::ConnectionRefused {
                "connection_refused"
            } else {
                "Could not reach the LG TV."
            }
        })?;
        let stream = if parsed.scheme() == "wss" {
            let connector = native_tls::TlsConnector::builder()
                .min_protocol_version(Some(native_tls::Protocol::Tlsv12))
                // Local TVs use self-signed certificates without IP SANs. This
                // exception is scoped to LG only, never StreamGPT/cloud traffic.
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()
                .map_err(|_| "LG TLS unavailable.")?;
            let tls = tokio_native_tls::TlsConnector::from(connector)
                .connect(host, tcp)
                .await
                .map_err(|_| "LG_SECURE_CONNECTION_FAILED")?;
            MaybeTlsStream::NativeTls(tls)
        } else {
            MaybeTlsStream::Plain(tcp)
        };
        // Verify BEFORE the HTTP upgrade (including pointer URL), registration,
        // pairing key, or any control request is sent. Never downgrade a pin.
        let actual = peer_fingerprint(&stream)?;
        verify_pin(pin.as_deref(), actual.as_deref())?;
        let limits = WebSocketConfig::default()
            .max_message_size(Some(262144))
            .max_frame_size(Some(262144));
        client_async_with_config(url, stream, Some(limits))
            .await
            .map(|(socket, _)| socket)
            .map_err(|_| "LG WebSocket connection failed.".to_string())
    };
    tokio::time::timeout(Duration::from_secs(5), connect)
        .await
        .map_err(|_| "connection_timeout".to_string())?
}
pub struct Session {
    socket: Socket,
    host: String,
    pairing: Pairing,
}
impl Session {
    pub async fn open(host: &str, saved: Option<&str>) -> Result<Self, String> {
        private_host(host)?;
        let stored: Option<Pairing> = saved
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| "Stored pairing is invalid.")?;
        let mut secure = stored.as_ref().map(|s| s.secure).unwrap_or(true);
        let make_url = |secure: bool| {
            format!(
                "{}://{}:{}",
                if secure { "wss" } else { "ws" },
                host,
                if secure { 3001 } else { 3000 }
            )
        };
        let mut ws = match socket(
            &make_url(secure),
            stored.as_ref().and_then(|s| s.fingerprint.clone()),
        )
        .await
        {
            Ok(s) => s,
            Err(e)
                if stored.is_none() && (e == "connection_refused" || e == "connection_timeout") =>
            {
                secure = false;
                socket(&make_url(false), None).await?
            }
            Err(e) => return Err(e),
        };
        let cert = peer_fingerprint(ws.get_ref())?;
        let mut payload = json!({"forcePairing":false,"pairingType":"PROMPT","manifest":{"manifestVersion":1,"appVersion":"0.1.0","permissions":["CONTROL_AUDIO","CONTROL_POWER","READ_POWER_STATE","CONTROL_MOUSE_AND_KEYBOARD","CONTROL_INPUT_MEDIA_PLAYBACK"]}});
        if let Some(s) = &stored {
            payload["client-key"] = json!(s.key);
        }
        ws.send(Message::Text(
            json!({"id":"register","type":"register","payload":payload})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| "Could not request LG pairing.")?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(40);
        loop {
            let next = tokio::time::timeout_at(deadline, ws.next())
                .await
                .map_err(|_| "LG_APPROVAL_TIMEOUT")?
                .ok_or("LG_PAIRING_INTERRUPTED")?
                .map_err(|_| "LG_PAIRING_INTERRUPTED")?;
            if let Message::Text(text) = next {
                let value: Value =
                    serde_json::from_str(&text).map_err(|_| "Invalid LG response.")?;
                if value["type"] == "error" {
                    return Err("LG_APPROVAL_REJECTED".into());
                }
                if value["type"] == "registered" {
                    let key = value["payload"]["client-key"]
                        .as_str()
                        .or_else(|| stored.as_ref().map(|s| s.key.as_str()))
                        .filter(|s| !s.is_empty() && s.len() < 4096)
                        .ok_or("TV did not return a pairing key.")?
                        .to_string();
                    return Ok(Self {
                        socket: ws,
                        host: host.into(),
                        pairing: Pairing {
                            key,
                            secure,
                            fingerprint: cert,
                        },
                    });
                }
            }
        }
    }
    pub fn credentials(&self) -> String {
        serde_json::to_string(&self.pairing).unwrap()
    }
    pub async fn request(&mut self, uri: &str, payload: Value) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.socket
            .send(Message::Text(
                json!({"id":id,"type":"request","uri":uri,"payload":payload})
                    .to_string()
                    .into(),
            ))
            .await
            .map_err(|_| "LG request could not be sent.")?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let frame = tokio::time::timeout_at(deadline, self.socket.next())
                .await
                .map_err(|_| "LG response timed out.")?
                .ok_or("LG disconnected.")?
                .map_err(|_| "LG disconnected.")?;
            if let Message::Text(text) = frame {
                let data: Value =
                    serde_json::from_str(&text).map_err(|_| "Invalid TV response.")?;
                if data["id"] != id {
                    continue;
                }
                if data["type"] == "error" || data["payload"]["returnValue"] == false {
                    return Err("This LG TV does not support or permit that request.".into());
                }
                return Ok(data["payload"].clone());
            }
        }
    }
    pub async fn inspect(&mut self) -> Result<Value, String> {
        self.request("ssap://audio/getVolume", json!({})).await
    }
    pub async fn press(&mut self, button: &Button) -> Result<&'static str, String> {
        let name = match button {
            Button::Home => Some("HOME"),
            Button::Back => Some("BACK"),
            Button::Up => Some("UP"),
            Button::Down => Some("DOWN"),
            Button::Left => Some("LEFT"),
            Button::Right => Some("RIGHT"),
            Button::Select => Some("ENTER"),
            Button::Play => Some("PLAY"),
            Button::Pause => Some("PAUSE"),
            Button::Rewind => Some("REWIND"),
            Button::Forward => Some("FASTFORWARD"),
            _ => None,
        };
        if let Some(name) = name {
            let value = self
                .request(
                    "ssap://com.webos.service.networkinput/getPointerInputSocket",
                    json!({}),
                )
                .await?;
            let raw = value["socketPath"]
                .as_str()
                .ok_or("LG input socket unavailable.")?;
            validate_pointer(raw, &self.host, self.pairing.secure)?;
            let mut input = socket(raw, self.pairing.fingerprint.clone()).await?;
            input
                .send(Message::Text(
                    format!("type:button\nname:{name}\n\n").into(),
                ))
                .await
                .map_err(|_| "LG button could not be sent.")?;
            let _ = input.close(None).await;
            return Ok("uncertain"); // Input socket has no acknowledgement.
        }
        match button {
            Button::Mute => {
                let state = self.inspect().await?;
                let muted = state["muted"]
                    .as_bool()
                    .or_else(|| state["volumeStatus"]["mute"].as_bool())
                    .ok_or("Mute state unavailable.")?;
                self.request("ssap://audio/setMute", json!({"mute":!muted}))
                    .await?;
            }
            Button::PowerOff => {
                self.request("ssap://system/turnOff", json!({})).await?;
            }
            Button::VolumeUp => {
                self.request("ssap://audio/volumeUp", json!({})).await?;
            }
            Button::VolumeDown => {
                self.request("ssap://audio/volumeDown", json!({})).await?;
            }
            _ => return Err("Unsupported button.".into()),
        };
        Ok("accepted")
    }
}
pub fn validate_pointer(raw: &str, host: &str, secure: bool) -> Result<(), String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid LG socket.")?;
    if url.host_str() != Some(host)
        || url.scheme() != if secure { "wss" } else { "ws" }
        || url.port() != Some(if secure { 3001 } else { 3000 })
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("TV returned an unexpected input socket address.".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    // Public synthetic test identity; never loaded by production code.
    const V1_CERT: &[u8] = include_bytes!("../tests/fixtures/lg-v1-cert.der");
    const V1_KEY: &[u8] = include_bytes!("../tests/fixtures/lg-v1-test-key.der");
    #[tokio::test]
    async fn legacy_tls_certificate_supported_and_pin_checked_before_upgrade() {
        use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
        use tokio::io::AsyncReadExt;
        // Explicit resolver serves the legacy certificate as-is. The default
        // rustls certificate loader rejects v1 before a test server can start.
        #[derive(Debug)]
        struct Fixture(std::sync::Arc<rustls::sign::CertifiedKey>);
        impl rustls::server::ResolvesServerCert for Fixture {
            fn resolve(
                &self,
                _: rustls::server::ClientHello<'_>,
            ) -> Option<std::sync::Arc<rustls::sign::CertifiedKey>> {
                Some(self.0.clone())
            }
        }
        let signing = rustls::crypto::ring::sign::any_supported_type(&PrivateKeyDer::Pkcs8(
            PrivatePkcs8KeyDer::from(V1_KEY.to_vec()),
        ))
        .unwrap();
        let cert =
            rustls::sign::CertifiedKey::new(vec![CertificateDer::from(V1_CERT.to_vec())], signing);
        let config = rustls::ServerConfig::builder_with_provider(std::sync::Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_cert_resolver(std::sync::Arc::new(Fixture(std::sync::Arc::new(cert))));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let acceptor = tokio_rustls::TlsAcceptor::from(std::sync::Arc::new(config));
            for accepted in [true, true, false] {
                let (tcp, _) = listener.accept().await.unwrap();
                let mut tls = acceptor.accept(tcp).await.unwrap();
                if accepted {
                    let mut ws = tokio_tungstenite::accept_async(tls).await.unwrap();
                    // The client closes without registration or control messages.
                    assert!(matches!(
                        ws.next().await,
                        Some(Ok(Message::Close(_))) | None
                    ));
                } else {
                    let mut byte = [0];
                    let read = tokio::time::timeout(Duration::from_secs(2), tls.read(&mut byte))
                        .await
                        .unwrap();
                    assert!(
                        matches!(read, Ok(0) | Err(_)),
                        "A changed pin must send no HTTP bytes"
                    );
                }
            }
        });
        let url = format!("wss://{address}");
        for pin in [None, Some(fingerprint(V1_CERT))] {
            let mut ws = socket(&url, pin).await.unwrap();
            assert_eq!(
                peer_fingerprint(ws.get_ref()).unwrap(),
                Some(fingerprint(V1_CERT))
            );
            let _ = ws.close(None).await;
        }
        assert_eq!(
            socket(&url, Some("changed".into())).await.unwrap_err(),
            "LG_CERTIFICATE_CHANGED"
        );
        server.await.unwrap();
    }
    #[test]
    fn pin_cannot_be_downgraded_or_changed() {
        assert!(verify_pin(Some("saved"), None).is_err());
        assert!(verify_pin(Some("saved"), Some("other")).is_err());
        assert!(verify_pin(Some("saved"), Some("saved")).is_ok());
    }
    #[tokio::test]
    async fn request_correlates_replies_and_rejects_tv_errors() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
            for reject in [false, true] {
                let raw = ws.next().await.unwrap().unwrap().into_text().unwrap();
                let request: Value = serde_json::from_str(&raw).unwrap();
                assert_eq!(request["uri"], "ssap://audio/getVolume");
                ws.send(Message::Text(
                    json!({"id":"unrelated","payload":{"volume":99}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                ws.send(Message::Text(json!({"id":request["id"],"type":if reject {"error"} else {"response"},"payload":{"volume":12,"muted":false}}).to_string().into())).await.unwrap();
            }
        });
        let ws = socket(&format!("ws://{address}"), None).await.unwrap();
        let mut session = Session {
            socket: ws,
            host: "127.0.0.1".into(),
            pairing: Pairing {
                key: "fixture".into(),
                secure: false,
                fingerprint: None,
            },
        };
        assert_eq!(session.inspect().await.unwrap()["volume"], 12);
        assert!(session.inspect().await.is_err());
        peer.await.unwrap();
    }
    #[test]
    fn pointer_socket_cannot_escape_paired_tv() {
        assert!(validate_pointer(
            "wss://192.168.1.4:3001/resources/input",
            "192.168.1.4",
            true
        )
        .is_ok());
        for v in [
            "wss://8.8.8.8:3001/x",
            "ws://192.168.1.4:3000/x",
            "wss://192.168.1.4:80/x",
            "wss://user@192.168.1.4:3001/x",
        ] {
            assert!(validate_pointer(v, "192.168.1.4", true).is_err());
        }
    }
}
