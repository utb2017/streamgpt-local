use crate::{model::Button, network::private_host};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
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
async fn request(host: &str, path: &str, post: bool) -> Result<String, String> {
    private_host(host)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|_| "Network unavailable.")?;
    let url = format!("http://{host}:8060/{path}");
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
            "Enable Control by mobile apps in Roku's advanced system settings."
        } else {
            "Roku did not accept the request."
        }
        .into());
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
    Ok(json!({"model":info.model,"power":info.power}))
}
pub async fn inspect(host: &str) -> Result<Value, String> {
    parse_info(&request(host, "query/device-info", false).await?)
}
pub async fn press(host: &str, button: &Button) -> Result<(), String> {
    request(host, &format!("keypress/{}", key(button)), true).await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
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
}
