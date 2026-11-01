use crate::{
    model::{Button, ControlPermission},
    network::private_host,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Debug, PartialEq)]
pub enum Error {
    ControlDisabled,
    Other(String),
}
impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::Other(value)
    }
}
impl From<&str> for Error {
    fn from(value: &str) -> Self {
        Self::Other(value.into())
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ControlDisabled => f.write_str("ROKU_CONTROL_DISABLED"),
            Self::Other(message) => f.write_str(message),
        }
    }
}
pub fn key(button: &Button) -> &'static str {
    match button {
        Button::Home => "Home",
        Button::Back => "Back",
        Button::Up => "Up",
        Button::Down => "Down",
        Button::Left => "Left",
        Button::Right => "Right",
        Button::Select => "Select",
        Button::Play | Button::Pause => "Play",
        Button::Rewind => "Rev",
        Button::Forward => "Fwd",
        Button::VolumeUp => "VolumeUp",
        Button::VolumeDown => "VolumeDown",
        Button::Mute => "VolumeMute",
        Button::PowerOff => "PowerOff",
    }
}
async fn request(host: &str, path: &str, post: bool) -> Result<String, Error> {
    private_host(host)?;
    request_url(
        &format!("http://{host}:8060/{path}"),
        post,
        std::time::Duration::from_secs(5),
    )
    .await
}
async fn request_url(url: &str, post: bool, timeout: std::time::Duration) -> Result<String, Error> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| "Network unavailable.")?;
    let result = if post {
        client.post(url)
    } else {
        client.get(url)
    }
    .send()
    .await
    .map_err(|_| "Roku did not respond. Check its IP and network.")?;
    if !result.status().is_success() {
        return Err(if result.status() == 403 {
            Error::ControlDisabled
        } else {
            Error::Other("Roku did not accept the request.".into())
        });
    }
    let mut bytes = Vec::new();
    let mut stream = result.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Incomplete Roku response.")?;
        if bytes.len() + chunk.len() > 262144 {
            return Err("Device response too large.".into());
        }
        bytes.extend(chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Invalid device response.".into())
}
#[derive(Deserialize)]
struct Info {
    #[serde(rename = "model-name")]
    model: String,
    #[serde(rename = "power-mode", default)]
    power: String,
    #[serde(rename = "user-device-name", default)]
    name: String,
    #[serde(rename = "ecp-setting-mode", default)]
    permission: String,
}
pub fn parse_info(xml: &str) -> Result<Value, String> {
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("Unsupported XML document.".into());
    }
    let info: Info = quick_xml::de::from_str(xml)
        .map_err(|_| "This device did not identify itself as a Roku.")?;
    if info.model.len() > 100 {
        return Err("Invalid device model.".into());
    }
    let name = info.name.chars().take(60).collect::<String>();
    let permission = match info.permission.as_str() {
        "enabled" | "permissive" => ControlPermission::Enabled,
        "limited" => ControlPermission::Limited,
        "disabled" => ControlPermission::Disabled,
        _ => ControlPermission::Unknown,
    };
    Ok(json!({"model":info.model,"power":info.power,"name":name,"controlPermission":permission}))
}
pub async fn inspect(host: &str) -> Result<Value, String> {
    parse_info(
        &request(host, "query/device-info", false)
            .await
            .map_err(|e| e.to_string())?,
    )
}
pub async fn press(host: &str, button: &Button) -> Result<(), Error> {
    request(host, &format!("keypress/{}", key(button)), true).await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permission_requires_an_explicit_enabled_mode() {
        for (mode, expected) in [
            (None, "unknown"),
            (Some("limited"), "limited"),
            (Some("disabled"), "disabled"),
            (Some("permissive"), "enabled"),
            (Some("enabled"), "enabled"),
            (Some("future-value"), "unknown"),
        ] {
            let setting = mode
                .map(|v| format!("<ecp-setting-mode>{v}</ecp-setting-mode>"))
                .unwrap_or_default();
            let info = parse_info(&format!(
                "<device-info><model-name>Roku</model-name>{setting}</device-info>"
            ))
            .unwrap();
            assert_eq!(info["controlPermission"], expected);
        }
    }
    #[tokio::test]
    async fn actual_http_denial_differs_from_post_send_timeout() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for status in [Some(403), Some(200), None] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/keypress/Play", listener.local_addr().unwrap());
            let (seen, received) = tokio::sync::oneshot::channel();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0; 2048];
                let n = socket.read(&mut buf).await.unwrap();
                assert!(String::from_utf8_lossy(&buf[..n]).starts_with("POST /keypress/Play "));
                seen.send(()).unwrap();
                if let Some(status) = status {
                    socket.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
                } else {
                    std::future::pending::<()>().await;
                }
            });
            let result = request_url(&url, true, std::time::Duration::from_millis(200)).await;
            received.await.unwrap();
            match status {
                Some(403) => assert_eq!(result.unwrap_err(), Error::ControlDisabled),
                Some(200) => assert_eq!(result.unwrap(), ""),
                _ => assert!(matches!(result, Err(Error::Other(_)))),
            }
            server.abort();
        }
    }
    #[test]
    fn parses_device_info() {
        assert_eq!(parse_info("<device-info><model-name>Roku Ultra</model-name><power-mode>PowerOn</power-mode></device-info>").unwrap()["model"],"Roku Ultra");
        assert!(parse_info("<!DOCTYPE x><device-info/>").is_err());
        assert!(parse_info("<html>Not a TV</html>").is_err());
    }
    #[test]
    fn play_pause_is_a_toggle() {
        assert_eq!(key(&Button::Play), key(&Button::Pause));
    }
    #[test]
    fn reads_optional_friendly_name_without_exposing_other_device_fields() {
        let info = parse_info("<device-info><model-name>Roku Express</model-name><user-device-name>Living room</user-device-name><serial-number>private</serial-number></device-info>").unwrap();
        assert_eq!(info["name"], "Living room");
        assert!(info.get("serial-number").is_none());
        assert_eq!(
            parse_info("<device-info><model-name>Roku</model-name></device-info>").unwrap()["name"],
            ""
        );
    }
}
