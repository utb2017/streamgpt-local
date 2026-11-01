use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};
use tokio::{net::UdpSocket, time::Instant};

#[cfg(windows)]
#[path = "neighbors.rs"]
mod neighbors;

const LG_SERVICE: &str = "urn:lge-com:service:webos-second-screen:1";
const TARGETS: [&str; 3] = ["roku:ecp", LG_SERVICE, "ssdp:all"];
const SSDP: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(239, 255, 255, 250)), 1900);
const SCAN_WINDOW: Duration = Duration::from_secs(5);
const RETRY_INTERVAL: Duration = Duration::from_secs(1);
const SEND_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_PACKET: usize = 8192;
const MAX_CANDIDATES: usize = 64;
const MAX_PACKETS: usize = 512;

pub fn private_host(host: &str) -> Result<Ipv4Addr, String> {
    let ip: Ipv4Addr = host
        .parse()
        .map_err(|_| "Enter a local IPv4 address, such as 192.168.1.40.")?;
    if !ip.is_private() || ip.octets()[3] == 255 {
        return Err("Only private home-network addresses are supported.".into());
    }
    Ok(ip)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Brand {
    Lg,
    Roku,
}
// None is a conflicting host, retained so a later packet cannot undo the conflict.
type Candidates = BTreeMap<Ipv4Addr, Option<Brand>>;

fn parse_response(packet: &[u8]) -> Option<Brand> {
    if packet.len() > MAX_PACKET {
        return None;
    }
    let text = std::str::from_utf8(packet).ok()?;
    let (head, _) = text
        .split_once("\r\n\r\n")
        .or_else(|| text.split_once("\n\n"))?;
    if head
        .bytes()
        .any(|b| (b < 32 && !b"\r\n\t".contains(&b)) || b == 127)
    {
        return None;
    }
    let mut lines = head.lines();
    let mut status = lines.next()?.split_ascii_whitespace();
    if status.next()? != "HTTP/1.1" || status.next()? != "200" {
        return None;
    }
    let mut headers = HashMap::new();
    for (index, line) in lines.enumerate() {
        if index >= 64 || line.starts_with([' ', '\t']) {
            return None;
        }
        let (key, value) = line.split_once(':')?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || value.bytes().any(|b| (b < 32 && b != b'\t') || b == 127)
        {
            return None;
        }
        // Repeated identity headers are ambiguous even when the last one looks valid.
        if headers
            .insert(key.to_ascii_lowercase(), value.trim())
            .is_some()
        {
            return None;
        }
    }
    let st = headers.get("st")?.to_ascii_lowercase();
    let usn = headers.get("usn")?.to_ascii_lowercase();
    let identity = usn.strip_prefix("uuid:")?;
    if identity.is_empty() || identity.bytes().any(|b| b.is_ascii_whitespace()) {
        return None;
    }
    let typed_usn = identity.split_once("::");
    if st == LG_SERVICE
        && typed_usn.is_some_and(|(id, service)| !id.is_empty() && service == LG_SERVICE)
    {
        return Some(Brand::Lg);
    }
    if st == "roku:ecp"
        && (identity
            .strip_prefix("roku:ecp:")
            .is_some_and(|id| !id.is_empty() && !id.contains("::"))
            || typed_usn.is_some_and(|(id, service)| !id.is_empty() && service == "roku:ecp"))
    {
        return Some(Brand::Roku);
    }
    // SERVER/LOCATION/body substrings, generic DLNA and legacy NetCast do not prove
    // that the peer supports this controller's webOS second-screen protocol.
    None
}

fn merge(found: &mut Candidates, host: Ipv4Addr, brand: Option<Brand>) {
    if let Some(previous) = found.get_mut(&host) {
        if *previous != brand {
            *previous = None;
        }
    } else if found.len() < MAX_CANDIDATES {
        found.insert(host, brand);
    }
}

fn receive(found: &mut Candidates, packet: &[u8], peer: SocketAddr) {
    let Ok(host) = private_host(&peer.ip().to_string()) else {
        return;
    };
    if let Some(brand) = parse_response(packet) {
        merge(found, host, Some(brand));
    }
}

#[derive(Clone, Copy)]
struct Search {
    destination: SocketAddr,
    target: &'static str,
}

fn search_message(search: &Search) -> String {
    format!(
        "M-SEARCH * HTTP/1.1\r\nHOST: {}\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {}\r\n\r\n",
        search.destination, search.target
    )
}

// The private transport seam permits loss/delay/error fixtures without a LAN socket.
trait ProbeTransport: Sync {
    fn send(
        &self,
        packet: &[u8],
        destination: SocketAddr,
    ) -> impl Future<Output = io::Result<usize>> + Send;
    fn recv(
        &self,
        buffer: &mut [u8],
    ) -> impl Future<Output = io::Result<(usize, SocketAddr)>> + Send;
}
struct SsdpSocket(UdpSocket);
impl ProbeTransport for SsdpSocket {
    async fn send(&self, packet: &[u8], destination: SocketAddr) -> io::Result<usize> {
        self.0.send_to(packet, destination).await
    }
    async fn recv(&self, buffer: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
        self.0.recv_from(buffer).await
    }
}

fn interface_socket(ip: Ipv4Addr) -> io::Result<SsdpSocket> {
    let socket = std::net::UdpSocket::bind((ip, 0))?;
    // Binding the source address alone does not select multicast egress on every OS.
    socket2::SockRef::from(&socket).set_multicast_if_v4(&ip)?;
    socket.set_multicast_ttl_v4(1)?;
    socket.set_nonblocking(true)?;
    Ok(SsdpSocket(UdpSocket::from_std(socket)?))
}

#[derive(Default)]
struct Scan {
    sent: usize,
    receive_failed: bool,
    found: Candidates,
}

#[cfg(test)]
async fn probe(
    transport: &impl ProbeTransport,
    start: Instant,
    window: Duration,
    retry: Duration,
) -> Scan {
    let searches = TARGETS.map(|target| Search {
        destination: SSDP,
        target,
    });
    probe_queries(transport, start, window, retry, &searches, 3).await
}

async fn probe_queries(
    transport: &impl ProbeTransport,
    start: Instant,
    window: Duration,
    retry: Duration,
    searches: &[Search],
    rounds: u32,
) -> Scan {
    let deadline = start + window;
    let mut scan = Scan::default();
    if searches.is_empty() {
        return scan;
    }
    let mut round = 0;
    let mut packets = 0;
    // Receive a full UDP datagram, then apply the smaller SSDP parser limit.
    // An oversized unrelated datagram must not end discovery with a truncation error.
    let mut buffer = [0; 65535];
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(deadline) => break,
            _ = tokio::time::sleep_until(start + retry * round), if round < rounds => {
                // A stalled destination cannot serially consume the receive window.
                let sends = searches.iter().filter(|search| round < 2 || search.destination == SSDP).map(|search| async move {
                    let message = search_message(search);
                    let until = deadline.min(Instant::now() + SEND_TIMEOUT);
                    matches!(tokio::time::timeout_at(until, transport.send(message.as_bytes(), search.destination)).await, Ok(Ok(n)) if n == message.len())
                });
                scan.sent += futures_util::future::join_all(sends).await.into_iter().filter(|sent| *sent).count();
                round += 1;
                if round == rounds && scan.sent == 0 { break; }
            },
            result = transport.recv(&mut buffer) => {
                match result {
                    Ok((len, peer)) => {
                        // Directed discovery only accepts responses from selected cache peers.
                        let multicast = searches.iter().any(|s| s.destination == SSDP);
                        let directed_lg = searches.iter().any(|s| s.destination.ip() == peer.ip())
                            && parse_response(&buffer[..len]) == Some(Brand::Lg);
                        if multicast || directed_lg {
                            receive(&mut scan.found, &buffer[..len], peer);
                        }
                    },
                    Err(_) => { scan.receive_failed = true; break; }
                }
                packets += 1;
                if packets >= MAX_PACKETS { break; }
            }
        }
    }
    scan
}

fn private_interfaces(
    addresses: impl IntoIterator<Item = IpAddr>,
) -> Result<Vec<Ipv4Addr>, String> {
    let ips: BTreeSet<_> = addresses
        .into_iter()
        .filter_map(|ip| private_host(&ip.to_string()).ok())
        .collect();
    if ips.is_empty() {
        return Err("No private IPv4 network is available. Connect this computer to your home Ethernet or Wi-Fi network and try again.".into());
    }
    if ips.len() > 32 {
        return Err("Too many private network adapters. Disable unused VPN or virtual adapters and try Find TVs again.".into());
    }
    Ok(ips.into_iter().collect())
}

fn finish(scans: Vec<io::Result<Scan>>) -> Result<Vec<Value>, String> {
    let mut usable = 0;
    let mut sent = 0;
    let mut receiving = false;
    let mut all = BTreeMap::new();
    for scan in scans.into_iter().flatten() {
        usable += 1;
        sent += scan.sent;
        receiving |= scan.sent > 0 && !scan.receive_failed;
        // Merge all interfaces before limiting candidates; conflicting advertisements
        // from another adapter must not turn into a usable device.
        for (host, brand) in scan.found {
            all.entry(host)
                .and_modify(|old| {
                    if *old != brand {
                        *old = None;
                    }
                })
                .or_insert(brand);
        }
    }
    if usable == 0 {
        return Err("Could not open TV discovery on a private network adapter. Check your Ethernet/Wi-Fi connection, VPN and firewall, then try again.".into());
    }
    if sent == 0 {
        return Err("TV discovery probes could not be sent. Check your Ethernet/Wi-Fi connection, VPN and firewall permissions, then try again.".into());
    }
    if !receiving && all.values().all(Option::is_none) {
        return Err("TV discovery could not receive replies. Check your network and firewall permissions, then try again.".into());
    }
    Ok(all
        .into_iter()
        .filter_map(|(host, brand)| {
            brand.map(|brand| {
                let (brand, name) = match brand {
                    Brand::Lg => ("lg", "LG webOS TV"),
                    Brand::Roku => ("roku", "Roku device"),
                };
                json!({"host":host.to_string(),"brand":brand,"name":name})
            })
        })
        .take(MAX_CANDIDATES)
        .collect())
}

fn interface_searches(source: Ipv4Addr, cached: &[(Ipv4Addr, Ipv4Addr)]) -> Vec<Search> {
    let mut searches = TARGETS
        .map(|target| Search {
            destination: SSDP,
            target,
        })
        .to_vec();
    searches.extend(
        cached
            .iter()
            .filter(|(local, _)| *local == source)
            .map(|(_, peer)| Search {
                destination: SocketAddr::from((*peer, 1900)),
                target: LG_SERVICE,
            }),
    );
    searches
}

pub async fn discover() -> Result<Value, String> {
    let start = Instant::now();
    let interfaces = if_addrs::get_if_addrs().map_err(|_| {
        "Could not read network interfaces. Check your Ethernet/Wi-Fi connection and try again."
    })?;
    let ips = private_interfaces(interfaces.into_iter().map(|interface| interface.ip()))?;
    // LG replies may use an ephemeral source port. Keep multicast and directed
    // queries on the same interface socket, so one receive path collects both.
    // A separate directed-only socket missed the real LG on Windows.
    #[cfg(windows)]
    let cached: Vec<_> = neighbors::known(ips.clone())
        .await
        .into_iter()
        .map(|d| (d.source, d.peer))
        .collect();
    #[cfg(not(windows))]
    let cached: Vec<(Ipv4Addr, Ipv4Addr)> = Vec::new();
    let mut jobs = tokio::task::JoinSet::new();
    for ip in ips {
        let searches = interface_searches(ip, &cached);
        jobs.spawn(async move {
            let socket = interface_socket(ip)?;
            Ok(probe_queries(&socket, start, SCAN_WINDOW, RETRY_INTERVAL, &searches, 3).await)
        });
    }
    let mut scans = Vec::new();
    // A failed/panicked adapter must not discard later healthy adapter results.
    while let Some(result) = jobs.join_next().await {
        scans.push(result.unwrap_or_else(|_| Err(io::Error::other("Discovery task failed"))));
    }
    let mut candidates = finish(scans)?;
    // 5s SSDP + at most 1.5s parallel identity reads stays below the hosted 10s
    // deadline. Never follow LOCATION, resolve advertiser names, or contact an LG.
    let enrichment = candidates
        .iter_mut()
        .filter(|c| c["brand"] == "roku")
        .take(16)
        .map(|candidate| async move {
            let host = candidate["host"].as_str().unwrap_or_default().to_owned();
            if let Ok(Ok(info)) =
                tokio::time::timeout(Duration::from_millis(1500), crate::roku::inspect(&host)).await
            {
                candidate["model"] = info["model"].clone();
                if let Some(name) = info["name"].as_str().filter(|s| !s.trim().is_empty()) {
                    candidate["name"] = json!(name);
                }
            }
        });
    let _ = tokio::time::timeout_at(
        start + Duration::from_secs(7),
        futures_util::future::join_all(enrichment),
    )
    .await;
    Ok(json!(candidates))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    fn lg() -> Vec<u8> {
        format!("HTTP/1.1 200 OK\r\nST: {LG_SERVICE}\r\nUSN: uuid:synthetic-lg::{LG_SERVICE}\r\nSERVER: Linux/1 UPnP/1.0 WebOS/1\r\n\r\n").into_bytes()
    }
    fn roku() -> Vec<u8> {
        b"HTTP/1.1 200 OK\r\nST: roku:ecp\r\nUSN: uuid:roku:ecp:SYNTHETIC\r\nLOCATION: http://192.168.1.20:8060/\r\n\r\n".to_vec()
    }
    fn peer(host: &str) -> SocketAddr {
        format!("{host}:1900").parse().unwrap()
    }

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

    #[test]
    fn exact_services_and_case_insensitive_headers() {
        assert_eq!(parse_response(&lg()), Some(Brand::Lg));
        assert_eq!(parse_response(&roku()), Some(Brand::Roku));
        let lower = String::from_utf8(lg())
            .unwrap()
            .replace("ST:", "sT:\t")
            .replace("USN:", "usn:")
            .replace("\r\n", "\n");
        assert_eq!(parse_response(lower.as_bytes()), Some(Brand::Lg));
        let location = String::from_utf8(roku()).unwrap().replace(
            "http://192.168.1.20:8060/",
            "https://untrusted.invalid/webos",
        );
        assert_eq!(parse_response(location.as_bytes()), Some(Brand::Roku)); // Never followed.
    }

    #[test]
    fn malformed_and_non_tv_advertisements_do_not_become_candidates() {
        let valid = String::from_utf8(lg()).unwrap();
        for invalid in [
            valid.replace("200 OK", "404 Not Found"),
            valid.replace("200 OK", "200 OK\0"),
            valid.replace("HTTP/1.1 200 OK", "NOTIFY * HTTP/1.1"),
            valid.replace("ST:", "NT:"),
            valid.replace("USN:", "X-USN:"),
            valid.replace("ST:", " ST:"),
            valid.replace("uuid:synthetic-lg::", "uuid:synthetic-lg::wrong:"),
            valid.replace("ST:", "ST: other\r\nST:"),
            valid.replace("WebOS/1", "WebOS/1\0"),
            valid.trim_end().to_owned(),
            "HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nUSN: uuid:router::upnp:rootdevice\r\nSERVER: webos lge-com\r\nLOCATION: http://example.invalid/roku:ecp\r\n\r\nwebos".into(),
            "HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:speaker\r\nSERVER: LG WebOS\r\n\r\n".into(),
            valid.replace(LG_SERVICE, "urn:lge-com:service:netcast:1"),
        ] { assert_eq!(parse_response(invalid.as_bytes()), None, "{invalid:?}"); }
        assert_eq!(parse_response(&vec![b'x'; MAX_PACKET + 1]), None);
        assert_eq!(parse_response(&[255, 254]), None);
    }

    #[test]
    fn private_adapters_are_unique_and_public_only_is_actionable() {
        let ips = private_interfaces(
            [
                "192.168.1.2",
                "192.168.1.2",
                "10.0.0.2",
                "8.8.8.8",
                "127.0.0.1",
                "::1",
            ]
            .map(|s| s.parse().unwrap()),
        )
        .unwrap();
        assert_eq!(
            ips,
            vec![Ipv4Addr::new(10, 0, 0, 2), Ipv4Addr::new(192, 168, 1, 2)]
        );
        assert!(private_interfaces(["8.8.8.8".parse().unwrap()])
            .unwrap_err()
            .contains("private IPv4"));
    }

    #[test]
    fn duplicate_conflicting_and_public_peers_are_conservative() {
        let mut found = Candidates::new();
        receive(&mut found, &lg(), peer("192.168.1.10"));
        receive(&mut found, &lg(), peer("192.168.1.10"));
        receive(&mut found, &roku(), peer("8.8.8.8"));
        assert_eq!(found.len(), 1);
        receive(&mut found, &roku(), peer("192.168.1.10"));
        receive(&mut found, &lg(), peer("192.168.1.10"));
        assert_eq!(found.values().copied().collect::<Vec<_>>(), vec![None]);
    }

    #[test]
    fn failed_adapter_does_not_hide_good_results_or_honest_empty_scan() {
        let failed = || Err(io::Error::other("synthetic bind failure"));
        assert!(finish(vec![failed()])
            .unwrap_err()
            .contains("open TV discovery"));
        assert!(finish(vec![Ok(Scan::default())])
            .unwrap_err()
            .contains("could not be sent"));
        let empty = || {
            Ok(Scan {
                sent: 1,
                ..Scan::default()
            })
        };
        assert_eq!(
            finish(vec![failed(), empty()]).unwrap(),
            Vec::<Value>::new()
        );
        let mut scan = Scan {
            sent: 1,
            ..Scan::default()
        };
        receive(&mut scan.found, &lg(), peer("192.168.1.10"));
        assert_eq!(
            finish(vec![failed(), Ok(scan)]).unwrap(),
            vec![json!({"host":"192.168.1.10","brand":"lg","name":"LG webOS TV"})]
        );
        assert!(finish(vec![Ok(Scan {
            sent: 1,
            receive_failed: true,
            ..Scan::default()
        })])
        .unwrap_err()
        .contains("receive replies"));
    }

    struct Fixture {
        sends: Mutex<Vec<String>>,
        fail_sends: usize,
        packets: Mutex<VecDeque<(Instant, Vec<u8>, SocketAddr)>>,
    }
    impl ProbeTransport for Fixture {
        async fn send(&self, packet: &[u8], destination: SocketAddr) -> io::Result<usize> {
            let mut sends = self.sends.lock().unwrap();
            let message = String::from_utf8(packet.to_vec()).unwrap();
            assert!(message.contains(&format!("HOST: {destination}\r\n")));
            sends.push(message);
            if sends.len() <= self.fail_sends {
                Err(io::Error::other("synthetic send failure"))
            } else {
                Ok(packet.len())
            }
        }
        async fn recv(&self, buffer: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
            let next = self.packets.lock().unwrap().front().cloned();
            let Some((due, packet, peer)) = next else {
                return std::future::pending().await;
            };
            tokio::time::sleep_until(due).await;
            self.packets.lock().unwrap().pop_front();
            let len = buffer.len().min(packet.len());
            buffer[..len].copy_from_slice(&packet[..len]);
            Ok((len, peer))
        }
    }

    #[tokio::test]
    async fn delayed_reply_after_lost_round_is_collected_with_bounded_retries() {
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 3,
            packets: Mutex::new(VecDeque::from([
                (start + Duration::from_millis(35), lg(), peer("192.168.1.8")),
                (start + Duration::from_millis(40), lg(), peer("192.168.1.8")),
                (start + Duration::from_millis(45), roku(), peer("8.8.8.8")),
            ])),
        };
        let scan = probe(
            &fixture,
            start,
            Duration::from_millis(90),
            Duration::from_millis(25),
        )
        .await;
        assert_eq!(scan.sent, 6);
        assert_eq!(scan.found.len(), 1);
        let sends = fixture.sends.lock().unwrap();
        assert_eq!(sends.len(), 9);
        for target in TARGETS {
            assert_eq!(
                sends
                    .iter()
                    .filter(|s| s.contains(&format!("ST: {target}\r\n")))
                    .count(),
                3
            );
        }
        assert!(sends
            .iter()
            .all(|s| s.contains("MX: 2\r\n") && s.ends_with("\r\n\r\n")));
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn total_send_failure_is_retried_and_reported() {
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 9,
            packets: Mutex::new(VecDeque::new()),
        };
        let scan = probe(
            &fixture,
            start,
            Duration::from_millis(90),
            Duration::from_millis(20),
        )
        .await;
        assert_eq!(fixture.sends.lock().unwrap().len(), 9);
        assert!(finish(vec![Ok(scan)])
            .unwrap_err()
            .contains("could not be sent"));
    }

    #[tokio::test]
    async fn directed_queries_only_target_cached_peers_and_accept_matching_lg_replies() {
        let start = Instant::now();
        let searches = ["192.168.40.9", "192.168.40.10"].map(|host| Search {
            destination: peer(host),
            target: LG_SERVICE,
        });
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 0,
            packets: Mutex::new(VecDeque::from([
                (start, lg(), peer("192.168.40.99")), // Not selected from cache.
                (start, roku(), peer("192.168.40.10")), // Not the queried service.
                (
                    start,
                    b"HTTP/1.1 200 OK\r\nSERVER: WebOS/4.1.0\r\n\r\n".to_vec(),
                    peer("192.168.40.10"),
                ),
                (
                    start + Duration::from_millis(35),
                    lg(),
                    peer("192.168.40.9"),
                ),
                (
                    start + Duration::from_millis(40),
                    lg(),
                    peer("192.168.40.9"),
                ),
            ])),
        };
        let scan = probe_queries(
            &fixture,
            start,
            Duration::from_millis(70),
            Duration::from_millis(20),
            &searches,
            2,
        )
        .await;
        assert_eq!(scan.sent, 4);
        assert_eq!(
            finish(vec![Ok(scan)]).unwrap(),
            vec![json!({"host":"192.168.40.9","brand":"lg","name":"LG webOS TV"})]
        );
        let sends = fixture.sends.lock().unwrap();
        assert_eq!(sends.len(), 4);
        for search in searches {
            assert_eq!(sends.iter().filter(|message| message.contains(&format!("HOST: {}\r\n", search.destination))).count(), 2);
        }
        assert!(sends
            .iter()
            .all(|message| message.contains(&format!("ST: {LG_SERVICE}\r\n"))
                && !message.contains("239.255.255.250")));
    }

    #[tokio::test]
    async fn multicast_and_directed_search_share_one_receiver_and_bound_attempts() {
        let source: Ipv4Addr = "192.168.40.8".parse().unwrap();
        let tv: Ipv4Addr = "192.168.40.9".parse().unwrap();
        let searches = interface_searches(
            source,
            &[
                (source, tv),
                ("10.0.0.2".parse().unwrap(), "10.0.0.3".parse().unwrap()),
            ],
        );
        assert_eq!(searches.len(), 4);
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 0,
            packets: Mutex::new(VecDeque::from([(
                start + Duration::from_millis(10),
                lg(),
                SocketAddr::from((tv, 44754)),
            )])),
        };
        let scan = probe_queries(
            &fixture,
            start,
            Duration::from_millis(80),
            Duration::from_millis(20),
            &searches,
            3,
        )
        .await;
        assert_eq!(scan.sent, 11);
        assert_eq!(scan.found.get(&tv), Some(&Some(Brand::Lg)));
        let sends = fixture.sends.lock().unwrap();
        assert_eq!(
            sends
                .iter()
                .filter(|s| s.contains("HOST: 239.255.255.250:1900"))
                .count(),
            9
        );
        assert_eq!(
            sends
                .iter()
                .filter(|s| s.contains("HOST: 192.168.40.9:1900"))
                .count(),
            2
        );
        assert!(!sends.iter().any(|s| s.contains("10.0.0.3")));
    }

    #[tokio::test]
    async fn directed_fallback_has_no_targets_without_cache_and_cannot_reset_deadline() {
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 0,
            packets: Mutex::new(VecDeque::new()),
        };
        let scan = probe_queries(&fixture, start, SCAN_WINDOW, RETRY_INTERVAL, &[], 2).await;
        assert_eq!(scan.sent, 0);
        let searches = [Search {
            destination: peer("192.168.40.9"),
            target: LG_SERVICE,
        }];
        let scan = probe_queries(
            &fixture,
            start - Duration::from_millis(100),
            Duration::from_millis(40),
            RETRY_INTERVAL,
            &searches,
            2,
        )
        .await;
        assert_eq!(scan.sent, 0);
        assert!(fixture.sends.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn oversized_datagram_is_ignored_before_a_valid_reply() {
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 0,
            packets: Mutex::new(VecDeque::from([
                (start, vec![b'x'; MAX_PACKET + 1], peer("192.168.1.8")),
                (start, lg(), peer("192.168.1.8")),
            ])),
        };
        let scan = probe(
            &fixture,
            start,
            Duration::from_millis(60),
            Duration::from_millis(15),
        )
        .await;
        assert_eq!(
            scan.found.values().copied().collect::<Vec<_>>(),
            vec![Some(Brand::Lg)]
        );
        assert!(!scan.receive_failed);
    }

    #[tokio::test]
    async fn response_flood_is_bounded_and_candidates_are_capped() {
        let start = Instant::now();
        let fixture = Fixture {
            sends: Mutex::new(vec![]),
            fail_sends: 0,
            packets: Mutex::new(
                (0..MAX_PACKETS + 1)
                    .map(|n| {
                        (
                            start,
                            roku(),
                            SocketAddr::from(([10, 0, (n / 200) as u8, (n % 200 + 1) as u8], 1900)),
                        )
                    })
                    .collect(),
            ),
        };
        let scan = tokio::time::timeout(
            Duration::from_secs(1),
            probe(&fixture, start, Duration::from_secs(2), RETRY_INTERVAL),
        )
        .await
        .unwrap();
        assert_eq!(fixture.packets.lock().unwrap().len(), 1);
        assert_eq!(scan.found.len(), MAX_CANDIDATES);
        assert_eq!(finish(vec![Ok(scan)]).unwrap().len(), MAX_CANDIDATES);
    }

    #[tokio::test]
    async fn stalled_send_cannot_extend_the_scan_deadline() {
        struct Stalled;
        impl ProbeTransport for Stalled {
            async fn send(&self, _: &[u8], _: SocketAddr) -> io::Result<usize> {
                std::future::pending().await
            }
            async fn recv(&self, _: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
                std::future::pending().await
            }
        }
        let start = Instant::now();
        let scan = tokio::time::timeout(
            Duration::from_secs(1),
            probe(
                &Stalled,
                start,
                Duration::from_millis(40),
                Duration::from_millis(10),
            ),
        )
        .await
        .unwrap();
        assert_eq!(scan.sent, 0);
        assert!(scan.found.is_empty());
    }

    #[tokio::test]
    async fn multicast_interface_and_ttl_are_explicit_without_sending() {
        // Socket options only on loopback. This test never calls discover/send.
        let socket = interface_socket(Ipv4Addr::LOCALHOST).unwrap();
        let options = socket2::SockRef::from(&socket.0);
        assert_eq!(options.multicast_if_v4().unwrap(), Ipv4Addr::LOCALHOST);
        assert_eq!(options.multicast_ttl_v4().unwrap(), 1);
    }
}
