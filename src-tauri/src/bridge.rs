use crate::{model::Input, Shared};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
#[derive(Serialize, Deserialize)]
pub struct Connection {
    pub port: u16,
    pub token: String,
}
#[derive(Clone)]
struct Context {
    controller: Shared,
    token: String,
    host: String,
}
pub fn authorized(headers: &HeaderMap, token: &str, host: &str) -> bool {
    if headers.contains_key("origin")
        || headers.get("host").and_then(|v| v.to_str().ok()) != Some(host)
    {
        return false;
    }
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    supplied
        .as_bytes()
        .ct_eq(format!("Bearer {token}").as_bytes())
        .into()
}
async fn rpc(
    State(ctx): State<Context>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&headers, &ctx.token, &ctx.host) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Local authentication required."})),
        );
    }
    if !matches!(
        input,
        Input::Snapshot {} | Input::Discover {} | Input::Inspect { .. } | Input::Press { .. }
    ) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Manage devices in the desktop app."})),
        );
    }
    match ctx.controller.lock().await.dispatch(input).await {
        Ok(v) => (StatusCode::OK, Json(v)),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error":e}))),
    }
}
pub async fn start(controller: Shared) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not start the local MCP bridge.")?;
    let port = listener.local_addr().unwrap().port();
    let mut bytes = [0; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|v| format!("{v:02x}")).collect();
    controller.lock().await.vault.write(
        "bridge.bin",
        &Connection {
            port,
            token: token.clone(),
        },
    )?;
    let router = Router::new()
        .route("/rpc", post(rpc))
        .layer(DefaultBodyLimit::max(8192))
        .with_state(Context {
            controller,
            token,
            host: format!("127.0.0.1:{port}"),
        });
    axum::serve(listener, router)
        .await
        .map_err(|_| "Local bridge stopped.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_token_exact_host_and_no_browser_origin() {
        let mut h = HeaderMap::new();
        h.insert("host", "127.0.0.1:1234".parse().unwrap());
        h.insert("authorization", "Bearer secret".parse().unwrap());
        assert!(authorized(&h, "secret", "127.0.0.1:1234"));
        assert!(!authorized(&h, "other", "127.0.0.1:1234"));
        h.insert("origin", "https://example.com".parse().unwrap());
        assert!(!authorized(&h, "secret", "127.0.0.1:1234"));
        h.remove("origin");
        h.insert("host", "evil.example".parse().unwrap());
        assert!(!authorized(&h, "secret", "127.0.0.1:1234"));
    }
}
