//! Repos the author added with "Add repo…": they keep a group in the sidebar with no
//! sessions. Stored in the app's own `repos.json`, in its data directory, never under
//! `~/.claude/` (invariant 5). Each path is canonical, so adding a directory twice, or
//! through a symlink, keeps one entry, and it merges with the group its sessions make.
//!
//! `OSCILLATE_DATA_DIR` moves the file, so e2e runs keep it in their temp dir.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize)]
struct File {
    repos: Vec<String>,
}

pub struct Repos {
    file: PathBuf,
    list: Mutex<Vec<String>>,
}

impl Repos {
    /// Reads `<dir>/repos.json`. A missing file is an empty list; an unreadable one is
    /// too, with one log line.
    pub fn load(dir: &Path) -> Repos {
        let file = dir.join("repos.json");
        let list = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice::<File>(&bytes)
                .map(|f| f.repos)
                .unwrap_or_else(|e| {
                    eprintln!("oscillate: ignoring {}: {e}", file.display());
                    Vec::new()
                }),
            Err(_) => Vec::new(),
        };
        Repos { file, list: Mutex::new(list) }
    }

    pub fn list(&self) -> Vec<String> {
        self.list.lock().unwrap().clone()
    }

    /// Adds `dir`'s canonical path, once. Returns the new list.
    pub fn add(&self, dir: &Path) -> Result<Vec<String>, String> {
        let canonical = std::fs::canonicalize(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        if !canonical.is_dir() {
            return Err(format!("{} isn't a folder.", canonical.display()));
        }
        let path = canonical.to_str().ok_or("the folder's path isn't UTF-8")?.to_string();
        let mut list = self.list.lock().unwrap();
        if !list.contains(&path) {
            let mut next = list.clone();
            next.push(path);
            self.save(&next)?;
            *list = next;
        }
        Ok(list.clone())
    }

    /// Drops `path` exactly as listed. Returns the new list.
    pub fn remove(&self, path: &str) -> Result<Vec<String>, String> {
        let mut list = self.list.lock().unwrap();
        if list.iter().any(|p| p == path) {
            let next: Vec<String> = list.iter().filter(|p| *p != path).cloned().collect();
            self.save(&next)?;
            *list = next;
        }
        Ok(list.clone())
    }

    /// Writes a temp file and renames it over the old one, so a crash never leaves half.
    fn save(&self, repos: &[String]) -> Result<(), String> {
        let dir = self.file.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let json = serde_json::to_vec_pretty(&File { repos: repos.to_vec() }).unwrap();
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &self.file).map_err(|e| format!("{}: {e}", self.file.display()))
    }
}

/// Asks for a folder; `None` when cancelled. In e2e builds, `OSCILLATE_E2E_PICK` names a
/// file whose contents answer instead (empty or missing means cancel), because WebDriver
/// can't reach a native dialog.
pub fn pick_folder(app: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(hook) = std::env::var_os("OSCILLATE_E2E_PICK") {
        let answer = std::fs::read_to_string(hook).unwrap_or_default();
        let answer = answer.trim_end_matches('\n');
        return (!answer.is_empty()).then(|| PathBuf::from(answer));
    }
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().set_title("Add repo").blocking_pick_folder()?.into_path().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_is_stored_once_by_its_canonical_path() {
        let data = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        let link = data.path().join("link");
        std::os::unix::fs::symlink(repo.path(), &link).unwrap();
        let canonical = repo.path().canonicalize().unwrap().to_str().unwrap().to_string();

        let repos = Repos::load(data.path());
        assert_eq!(repos.add(repo.path()).unwrap(), [canonical.clone()]);
        assert_eq!(repos.add(&link).unwrap(), [canonical.clone()]);
        // It outlives the app.
        assert_eq!(Repos::load(data.path()).list(), [canonical.clone()]);

        assert_eq!(repos.remove(&canonical).unwrap(), Vec::<String>::new());
        assert_eq!(Repos::load(data.path()).list(), Vec::<String>::new());
    }

    #[test]
    fn a_missing_folder_or_a_file_is_refused() {
        let data = tempfile::tempdir().unwrap();
        let repos = Repos::load(data.path());
        assert!(repos.add(&data.path().join("nope")).is_err());
        let file = data.path().join("f");
        std::fs::write(&file, "").unwrap();
        assert!(repos.add(&file).is_err());
        assert!(!data.path().join("repos.json").exists());
    }

    #[test]
    fn an_unreadable_file_is_an_empty_list() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("repos.json"), "not json").unwrap();
        assert_eq!(Repos::load(data.path()).list(), Vec::<String>::new());
    }
}
