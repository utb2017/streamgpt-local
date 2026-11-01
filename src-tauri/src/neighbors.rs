//! Read-only Windows neighbor-cache projection for explicit TV discovery.
//! No address resolution, process execution, or network probes occur in this module.
use super::private_host;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    net::Ipv4Addr,
    time::Duration,
};
use windows_sys::Win32::{
    NetworkManagement::{IpHelper::*, Ndis::IfOperStatusUp},
    Networking::WinSock::{
        IpDadStatePreferred, NlnsDelay, NlnsPermanent, NlnsProbe, NlnsReachable, NlnsStale,
        AF_INET, SOCKADDR_INET,
    },
};

pub(super) const MAX_DESTINATIONS: usize = 32;
const MAX_TABLE_ROWS: usize = 4096;
const CACHE_WAIT: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Adapter {
    index: u32,
    luid: u64,
}
#[derive(Clone, Copy)]
struct Local {
    adapter: Adapter,
    ip: Ipv4Addr,
    prefix: u8,
}
#[derive(Clone, Copy)]
struct Neighbor {
    adapter: Adapter,
    ip: Ipv4Addr,
    resolved: bool,
}
struct Cache {
    physical: BTreeSet<Adapter>,
    locals: Vec<Local>,
    neighbors: Vec<Neighbor>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Destination {
    pub source: Ipv4Addr,
    pub peer: Ipv4Addr,
}

fn on_link(local: &Local, peer: Ipv4Addr) -> bool {
    if !(1..=32).contains(&local.prefix) {
        return false;
    }
    let mask = u32::MAX << (32 - local.prefix);
    let network = u32::from(local.ip) & mask;
    let address = u32::from(peer);
    address & mask == network
        && (local.prefix >= 31 || (address != network && address != (network | !mask)))
}

fn select(cache: Cache, allowed_sources: &[Ipv4Addr]) -> Vec<Destination> {
    // Exclude every local address, including one belonging to a different adapter.
    let own: BTreeSet<_> = cache
        .locals
        .iter()
        .map(|local| local.ip)
        .chain(allowed_sources.iter().copied())
        .collect();
    let locals: Vec<_> = cache
        .locals
        .iter()
        .filter(|local| {
            cache.physical.contains(&local.adapter)
                && allowed_sources.contains(&local.ip)
                && private_host(&local.ip.to_string()).is_ok()
        })
        .collect();
    let mut peers = BTreeMap::new();
    for neighbor in cache.neighbors {
        if !neighbor.resolved
            || own.contains(&neighbor.ip)
            || private_host(&neighbor.ip.to_string()).is_err()
        {
            continue;
        }
        if let Some(local) = locals
            .iter()
            .filter(|local| local.adapter == neighbor.adapter && on_link(local, neighbor.ip))
            .max_by_key(|local| local.prefix)
        {
            peers.entry(neighbor.ip).or_insert(local.ip);
        }
    }
    peers
        .into_iter()
        .take(MAX_DESTINATIONS)
        .map(|(peer, source)| Destination { source, peer })
        .collect()
}

fn physical_adapter(row: &MIB_IF_ROW2) -> Option<Adapter> {
    let flags = row.InterfaceAndOperStatusFlags._bitfield;
    // HardwareInterface, no filter/unauthenticated/disconnected/paused/low-power/endpoint flags.
    if row.OperStatus != IfOperStatusUp
        || flags & 1 == 0
        || flags & 0xfa != 0
        || !matches!(row.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211)
    {
        return None;
    }
    // SAFETY: NET_LUID_LH.Value is the documented integer representation of this union.
    Some(Adapter {
        index: row.InterfaceIndex,
        luid: unsafe { row.InterfaceLuid.Value },
    })
}

fn ipv4(address: &SOCKADDR_INET) -> Option<Ipv4Addr> {
    // SAFETY: the family discriminant is common to both variants. Only read Ipv4
    // when AF_INET; S_addr bytes are in network order in the native structure.
    unsafe {
        (address.si_family == AF_INET)
            .then(|| Ipv4Addr::from(address.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()))
    }
}

fn neighbor(row: &MIB_IPNET_ROW2) -> Option<Neighbor> {
    let mac = row
        .PhysicalAddress
        .get(..row.PhysicalAddressLength as usize)?;
    let resolved = [NlnsReachable, NlnsStale, NlnsDelay, NlnsProbe, NlnsPermanent].contains(&row.State)
        && mac.len() == 6 && mac[0] & 1 == 0 && mac.iter().any(|byte| *byte != 0)
        // SAFETY: Flags is the documented byte representation of this union.
        && unsafe { row.Anonymous.Flags & 2 == 0 };
    Some(Neighbor {
        // SAFETY: documented integer representation, as above.
        adapter: Adapter {
            index: row.InterfaceIndex,
            luid: unsafe { row.InterfaceLuid.Value },
        },
        ip: ipv4(&row.Address)?,
        resolved,
    })
}

struct MibTable<T>(*mut T);
impl<T> Drop for MibTable<T> {
    fn drop(&mut self) {
        // SAFETY: created only from a successful IP Helper table allocation, freed once.
        unsafe {
            FreeMibTable(self.0.cast());
        }
    }
}
fn table<T>(get: impl FnOnce(*mut *mut T) -> u32) -> Option<MibTable<T>> {
    let mut pointer = std::ptr::null_mut();
    if get(&mut pointer) != 0 || pointer.is_null() {
        None
    } else {
        Some(MibTable(pointer))
    }
}

fn read_cache() -> Option<Cache> {
    // SAFETY: each output pointer has the exact table type required by the API.
    // These functions retrieve existing local tables; none performs neighbor resolution.
    let interfaces = table(|out| unsafe { GetIfTable2(out) })?;
    let addresses = table(|out| unsafe { GetUnicastIpAddressTable(AF_INET, out) })?;
    let entries = table(|out| unsafe { GetIpNetTable2(AF_INET, out) })?;
    macro_rules! rows {
        ($table:ident, $row:ty) => {{
            // SAFETY: successful API output owns NumEntries contiguous, aligned rows.
            // Use the actual Table field offset (not sizeof(u32)), accounting for padding.
            // All slices are consumed while the MibTable guard is alive.
            unsafe {
                let count = (*$table.0).NumEntries as usize;
                if count > MAX_TABLE_ROWS {
                    return None;
                }
                std::slice::from_raw_parts(
                    std::ptr::addr_of!((*$table.0).Table).cast::<$row>(),
                    count,
                )
            }
        }};
    }
    let physical = rows!(interfaces, MIB_IF_ROW2)
        .iter()
        .filter_map(physical_adapter)
        .collect();
    let locals = rows!(addresses, MIB_UNICASTIPADDRESS_ROW)
        .iter()
        .filter_map(|row| {
            if row.DadState != IpDadStatePreferred {
                return None;
            }
            Some(Local {
                // SAFETY: documented integer union representation.
                adapter: Adapter {
                    index: row.InterfaceIndex,
                    luid: unsafe { row.InterfaceLuid.Value },
                },
                ip: ipv4(&row.Address)?,
                prefix: row.OnLinkPrefixLength,
            })
        })
        .collect();
    let neighbors = rows!(entries, MIB_IPNET_ROW2)
        .iter()
        .filter_map(neighbor)
        .collect();
    Some(Cache {
        physical,
        locals,
        neighbors,
    })
}

async fn best_effort(
    result: impl Future<Output = Option<Vec<Destination>>>,
    wait: Duration,
) -> Vec<Destination> {
    tokio::time::timeout(wait, result)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub(super) async fn known(allowed_sources: Vec<Ipv4Addr>) -> Vec<Destination> {
    // Bound caller latency. A slow OS read may finish on the blocking pool, but can
    // never send traffic after the bounded cache lookup has returned. Its owned tables are freed on completion.
    let job = tokio::task::spawn_blocking(move || {
        read_cache().map(|cache| select(cache, &allowed_sources))
    });
    best_effort(async move { job.await.ok().flatten() }, CACHE_WAIT).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Networking::WinSock::{NlnsIncomplete, NlnsUnreachable};
    fn ip(value: &str) -> Ipv4Addr {
        value.parse().unwrap()
    }
    fn adapter(index: u32) -> Adapter {
        Adapter {
            index,
            luid: index as u64,
        }
    }
    fn cache() -> Cache {
        Cache {
            physical: BTreeSet::from([adapter(1)]),
            locals: vec![Local {
                adapter: adapter(1),
                ip: ip("192.168.40.8"),
                prefix: 24,
            }],
            neighbors: vec![],
        }
    }
    fn cached(value: &str) -> Neighbor {
        Neighbor {
            adapter: adapter(1),
            ip: ip(value),
            resolved: true,
        }
    }

    #[test]
    fn cached_peers_must_be_private_on_link_resolved_and_not_self() {
        let mut fixture = cache();
        fixture.neighbors = [
            "192.168.40.9",
            "192.168.40.9",
            "192.168.40.8",
            "192.168.40.0",
            "192.168.40.255",
            "192.168.41.9",
            "8.8.8.8",
            "224.0.0.1",
            "127.0.0.1",
            "169.254.1.1",
        ]
        .map(cached)
        .to_vec();
        fixture.neighbors.push(Neighbor {
            resolved: false,
            ..cached("192.168.40.10")
        });
        fixture.neighbors.push(Neighbor {
            adapter: adapter(2),
            ..cached("192.168.40.11")
        });
        fixture.neighbors.push(Neighbor {
            adapter: Adapter { index: 1, luid: 99 },
            ..cached("192.168.40.12")
        });
        assert_eq!(
            select(fixture, &[ip("192.168.40.8")]),
            vec![Destination {
                source: ip("192.168.40.8"),
                peer: ip("192.168.40.9")
            }]
        );
    }

    #[test]
    fn global_cap_and_matching_physical_source_are_required() {
        let mut fixture = cache();
        fixture.neighbors = (10..100)
            .map(|last| cached(&format!("192.168.40.{last}")))
            .collect();
        let result = select(fixture, &[ip("192.168.40.8")]);
        assert_eq!(result.len(), MAX_DESTINATIONS);
        assert!(result
            .iter()
            .all(|entry| entry.source == ip("192.168.40.8")));
        let mut fixture = cache();
        fixture.neighbors.push(cached("192.168.40.9"));
        fixture.physical.clear();
        assert!(select(fixture, &[ip("192.168.40.8")]).is_empty());
        let mut fixture = cache();
        fixture.neighbors.push(cached("192.168.40.9"));
        assert!(select(fixture, &[ip("10.1.1.2")]).is_empty());
    }

    #[test]
    fn subnet_edges_and_invalid_prefixes_do_not_widen_targets() {
        let mut local = cache().locals[0];
        for prefix in [0, 33, 255] {
            local.prefix = prefix;
            assert!(!on_link(&local, ip("192.168.40.9")));
        }
        local.prefix = 25;
        for peer in ["192.168.40.0", "192.168.40.127", "192.168.40.128"] {
            assert!(!on_link(&local, ip(peer)));
        }
        assert!(on_link(&local, ip("192.168.40.126")));
    }

    #[test]
    fn win32_rows_reject_virtual_down_and_unresolved_entries() {
        let mut row = MIB_IF_ROW2 {
            Type: IF_TYPE_ETHERNET_CSMACD,
            OperStatus: IfOperStatusUp,
            ..Default::default()
        };
        row.InterfaceAndOperStatusFlags._bitfield = 1;
        assert!(physical_adapter(&row).is_some());
        row.Type = IF_TYPE_IEEE80211;
        assert!(physical_adapter(&row).is_some());
        row.InterfaceAndOperStatusFlags._bitfield = 0;
        assert!(physical_adapter(&row).is_none());
        row.InterfaceAndOperStatusFlags._bitfield = 1 | 16;
        assert!(physical_adapter(&row).is_none());
        row.InterfaceAndOperStatusFlags._bitfield = 1;
        row.OperStatus = 2;
        assert!(physical_adapter(&row).is_none());
        row.OperStatus = IfOperStatusUp;
        row.Type = 131;
        assert!(physical_adapter(&row).is_none());
        let mut row = MIB_IPNET_ROW2 {
            State: NlnsStale,
            PhysicalAddressLength: 6,
            ..Default::default()
        };
        row.Address.Ipv4.sin_family = AF_INET;
        row.Address.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes([192, 168, 40, 9]);
        row.PhysicalAddress[..6].copy_from_slice(&[2, 1, 2, 3, 4, 5]);
        assert_eq!(neighbor(&row).unwrap().ip, ip("192.168.40.9"));
        assert!(neighbor(&row).unwrap().resolved);
        for state in [NlnsIncomplete, NlnsUnreachable] {
            row.State = state;
            assert!(!neighbor(&row).unwrap().resolved);
        }
        row.State = NlnsReachable;
        row.Anonymous.Flags = 2;
        assert!(!neighbor(&row).unwrap().resolved);
        row.Anonymous.Flags = 0;
        row.PhysicalAddress[0] = 1;
        assert!(!neighbor(&row).unwrap().resolved);
    }

    #[tokio::test]
    async fn unavailable_or_slow_cache_is_an_empty_optional_fallback() {
        assert!(best_effort(async { None }, Duration::from_millis(5))
            .await
            .is_empty());
        assert!(
            best_effort(std::future::pending(), Duration::from_millis(5))
                .await
                .is_empty()
        );
    }
}
