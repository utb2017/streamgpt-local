use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr},
    time::Duration,
};
use tokio::net::UdpSocket;
pub fn private_host(host: &str) -> Result<Ipv4Addr, String> {
    let ip: Ipv4Addr = host
        .parse()
        .map_err(|_| "Enter a local IPv4 address, such as 192.168.1.40.")?;
    if !ip.is_private() || ip.octets()[3] == 255 {
        return Err("Only private home-network addresses are supported.".into());
    }
    Ok(ip)
}
pub async fn discover() -> Result<Value, String> {
    let interfaces = if_addrs::get_if_addrs().map_err(|_| "Could not read network interfaces.")?;
    let mut jobs = tokio::task::JoinSet::new();
    for interface in interfaces {
        if let IpAddr::V4(ip) = interface.ip() {
            if private_host(&ip.to_string()).is_err() {
                continue;
            }
            jobs.spawn(async move{
  let socket=UdpSocket::bind((ip,0)).await.map_err(|_|())?;let mut found=HashMap::new();
  for st in ["roku:ecp","urn:lge-com:service:webos-second-screen:1"]{let text=format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n");let _=socket.send_to(text.as_bytes(),"239.255.255.250:1900").await;}
  let deadline=tokio::time::Instant::now()+Duration::from_millis(3000);let mut buffer=[0;8192];
  while let Ok(Ok((len,peer)))=tokio::time::timeout_at(deadline,socket.recv_from(&mut buffer)).await{
   if found.len()>=64{break;}let host=peer.ip().to_string();if private_host(&host).is_err(){continue;}
   let text=String::from_utf8_lossy(&buffer[..len]).to_lowercase();let brand=if text.contains("roku:ecp"){"roku"}else if text.contains("webos")||text.contains("lge-com"){"lg"}else{continue;};
   found.insert(host.clone(),json!({"host":host,"brand":brand,"name":if brand=="lg"{"LG webOS TV"}else{"Roku device"}}));
  }Ok::<_,()>(found)
 });
        }
    }
    let mut all = HashMap::new();
    while let Some(Ok(Ok(result))) = jobs.join_next().await {
        all.extend(result);
    }
    Ok(json!(all.into_values().take(64).collect::<Vec<_>>()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_network_targets() {
        for v in [
            "127.0.0.1",
            "169.254.169.254",
            "8.8.8.8",
            "localhost",
            "192.168.1.1:80",
            "192.168.1.255",
            "[::1]",
        ] {
            assert!(private_host(v).is_err(), "{v}");
        }
        for v in ["192.168.1.20", "10.0.0.4", "172.16.0.8"] {
            assert!(private_host(v).is_ok());
        }
    }
}
