use crate::{model::Button, network::private_host};
use futures_util::{SinkExt, StreamExt};
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{protocol::WebSocketConfig, Error as WsError, Message},
    Connector, MaybeTlsStream, WebSocketStream,
};
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
#[derive(Clone, Serialize, Deserialize)]
struct Pairing {
    key: String,
    secure: bool,
    fingerprint: Option<String>,
}
#[derive(Debug)]
struct Pin(Option<String>);
fn fingerprint(cert: &[u8]) -> String {
    Sha256::digest(cert)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect()
}
impl ServerCertVerifier for Pin {
    fn verify_server_cert(
        &self,
        end: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if let Some(expected) = &self.0 {
            if expected != &fingerprint(end.as_ref()) {
                return Err(rustls::Error::General(
                    "TV certificate changed; pair again explicitly.".into(),
                ));
            }
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        msg: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            msg,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        msg: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            msg,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}
async fn socket(url: &str, pin: Option<String>) -> Result<Socket, String> {
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "TLS unavailable.")?
    .dangerous()
    .with_custom_certificate_verifier(Arc::new(Pin(pin)))
    .with_no_client_auth();
    let limits = WebSocketConfig::default()
        .max_message_size(Some(262144))
        .max_frame_size(Some(262144));
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        connect_async_tls_with_config(
            url,
            Some(limits),
            false,
            Some(Connector::Rustls(Arc::new(config))),
        ),
    )
    .await;
    match result {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(WsError::Io(e))) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
            Err("connection_refused".into())
        }
        Err(_) => Err("connection_timeout".into()),
        _ => Err(
            "LG connection failed. Check the TV, IP address, and saved pairing certificate.".into(),
        ),
    }
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
        let cert = match ws.get_ref() {
            MaybeTlsStream::Rustls(s) => s
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|c| c.first())
                .map(|c| fingerprint(c.as_ref())),
            _ => None,
        };
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
                .map_err(|_| "Approve StreamGPT's connection request on the TV, then try again.")?
                .ok_or("TV closed pairing.")?
                .map_err(|_| "LG pairing disconnected.")?;
            if let Message::Text(text) = next {
                let value: Value =
                    serde_json::from_str(&text).map_err(|_| "Invalid LG response.")?;
                if value["type"] == "error" {
                    return Err("TV rejected pairing. Enable LG Connect Apps / Mobile TV On and approve the request.".into());
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
