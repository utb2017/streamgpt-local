use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use serde::{de::DeserializeOwned, Serialize};
use std::{fs, path::PathBuf};
pub struct Vault {
    dir: PathBuf,
    key: [u8; 32],
}
impl Vault {
    #[cfg(test)]
    pub fn isolated_test(dir: PathBuf) -> Self {
        Self { dir, key: [7; 32] }
    }
    pub fn open() -> Result<Self, String> {
        let dir = directories::ProjectDirs::from("dev", "streamgpt", "StreamGPT Local")
            .ok_or("Application directory unavailable.")?
            .data_local_dir()
            .to_path_buf();
        fs::create_dir_all(&dir).map_err(|_| "Could not create application storage.")?;
        let entry = keyring::Entry::new("dev.streamgpt.local", "vault-key")
            .map_err(|_| "OS credential store unavailable.")?;
        let key = match entry.get_password() {
            Ok(s) => STANDARD.decode(s).map_err(|_| "Invalid vault key.")?,
            Err(keyring::Error::NoEntry) => {
                let mut b = [0; 32];
                rand::thread_rng().fill_bytes(&mut b);
                entry
                    .set_password(&STANDARD.encode(b))
                    .map_err(|_| "Could not save the vault key to your OS credential store.")?;
                b.to_vec()
            }
            Err(_) => return Err("Unlock your OS credential store to open StreamGPT Local.".into()),
        };
        Ok(Self {
            dir,
            key: key.try_into().map_err(|_| "Invalid vault key.")?,
        })
    }
    pub fn read<T: DeserializeOwned>(&self, name: &str) -> Result<Option<T>, String> {
        let bytes = match fs::read(self.dir.join(name)) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Cannot read local data.".into()),
        };
        if bytes.len() < 12 {
            return Err("Local data is damaged.".into());
        }
        let plain = Aes256Gcm::new_from_slice(&self.key)
            .unwrap()
            .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
            .map_err(|_| "Cannot decrypt local data.")?;
        serde_json::from_slice(&plain)
            .map(Some)
            .map_err(|_| "Local data is damaged.".into())
    }
    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<(), String> {
        let mut nonce = [0; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let plain = serde_json::to_vec(value).map_err(|_| "Cannot serialize local data.")?;
        let encrypted = Aes256Gcm::new_from_slice(&self.key)
            .unwrap()
            .encrypt(Nonce::from_slice(&nonce), plain.as_ref())
            .map_err(|_| "Cannot encrypt local data.")?;
        let mut bytes = nonce.to_vec();
        bytes.extend(encrypted);
        let tmp = self.dir.join(format!("{name}.tmp"));
        let mut file = fs::File::create(&tmp).map_err(|_| "Cannot save local data.")?;
        use std::io::Write;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot save local data.")?;
        fs::rename(tmp, self.dir.join(name)).map_err(|_| "Cannot commit local data.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypts_and_detects_tampering() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let v = Vault {
            dir: dir.clone(),
            key: [7; 32],
        };
        v.write("test.bin", &"private-pairing-key").unwrap();
        let mut raw = fs::read(dir.join("test.bin")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("private-pairing-key"));
        assert_eq!(
            v.read::<String>("test.bin").unwrap().unwrap(),
            "private-pairing-key"
        );
        raw[15] ^= 1;
        fs::write(dir.join("test.bin"), raw).unwrap();
        assert!(v.read::<String>("test.bin").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
