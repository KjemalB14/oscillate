//! The window's layout as the author left it: the sidebar's width and whether it's
//! collapsed. Stored in the app's own `layout.json`, beside `repos.json` in its data
//! directory, never under `~/.claude/` (invariant 5). The width is always within
//! `MIN_WIDTH`–`MAX_WIDTH`, whatever the file says.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const MIN_WIDTH: u32 = 208;
pub const MAX_WIDTH: u32 = 400;
pub const DEFAULT_WIDTH: u32 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sidebar {
    pub sidebar_width: u32,
    pub sidebar_collapsed: bool,
}

impl Default for Sidebar {
    fn default() -> Self {
        Sidebar { sidebar_width: DEFAULT_WIDTH, sidebar_collapsed: false }
    }
}

impl Sidebar {
    fn clamped(self) -> Sidebar {
        Sidebar { sidebar_width: self.sidebar_width.clamp(MIN_WIDTH, MAX_WIDTH), ..self }
    }
}

pub struct Layout {
    file: PathBuf,
    now: Mutex<Sidebar>,
}

impl Layout {
    /// Reads `<dir>/layout.json`. A missing file is the default; an unreadable one is
    /// too, with one log line.
    pub fn load(dir: &Path) -> Layout {
        let file = dir.join("layout.json");
        let now = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice::<Sidebar>(&bytes).unwrap_or_else(|e| {
                eprintln!("oscillate: ignoring {}: {e}", file.display());
                Sidebar::default()
            }),
            Err(_) => Sidebar::default(),
        };
        Layout { file, now: Mutex::new(now.clamped()) }
    }

    pub fn get(&self) -> Sidebar {
        *self.now.lock().unwrap()
    }

    /// Stores `next`, its width clamped. Returns what was stored.
    pub fn set(&self, next: Sidebar) -> Result<Sidebar, String> {
        let next = next.clamped();
        let mut now = self.now.lock().unwrap();
        if *now != next {
            self.save(&next)?;
            *now = next;
        }
        Ok(next)
    }

    /// Writes a temp file and renames it over the old one, so a crash never leaves half.
    fn save(&self, layout: &Sidebar) -> Result<(), String> {
        let dir = self.file.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let json = serde_json::to_vec_pretty(layout).unwrap();
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &self.file).map_err(|e| format!("{}: {e}", self.file.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_is_the_default() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(Layout::load(data.path()).get(), Sidebar { sidebar_width: 256, sidebar_collapsed: false });
    }

    #[test]
    fn an_unreadable_file_is_the_default() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("layout.json"), "not json").unwrap();
        assert_eq!(Layout::load(data.path()).get(), Sidebar::default());
    }

    #[test]
    fn it_outlives_the_app() {
        let data = tempfile::tempdir().unwrap();
        let layout = Layout::load(data.path());
        let next = Sidebar { sidebar_width: 333, sidebar_collapsed: true };
        assert_eq!(layout.set(next).unwrap(), next);
        assert_eq!(Layout::load(data.path()).get(), next);
    }

    #[test]
    fn the_width_stays_within_bounds() {
        let data = tempfile::tempdir().unwrap();
        let layout = Layout::load(data.path());
        let wide = Sidebar { sidebar_width: 900, sidebar_collapsed: false };
        assert_eq!(layout.set(wide).unwrap().sidebar_width, MAX_WIDTH);
        let narrow = Sidebar { sidebar_width: 10, sidebar_collapsed: false };
        assert_eq!(layout.set(narrow).unwrap().sidebar_width, MIN_WIDTH);
        // A file edited out of bounds is clamped on load.
        std::fs::write(data.path().join("layout.json"), r#"{"sidebarWidth":5000,"sidebarCollapsed":false}"#).unwrap();
        assert_eq!(Layout::load(data.path()).get().sidebar_width, MAX_WIDTH);
    }
}
