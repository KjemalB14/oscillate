//! A repo group's avatar (PLAN-ui-pass.md, slice 3): its GitHub owner's image.
//!
//! - The owner comes from the `origin` URL in the repo's own git config file, found by
//!   walking up from the group's directory. A worktree's `.git` file is followed to its
//!   common dir. No `git` process is started.
//! - The image is fetched once from `https://github.com/<owner>.png` and kept in
//!   `<data dir>/avatars/<owner>`, so a relaunch never fetches it again. **This is the
//!   app's one unprompted outbound request.** E2e builds fetch from the base URL in the
//!   file `OSCILLATE_E2E_AVATAR_BASE` names instead, and never from GitHub.
//! - Any miss (no repo, no origin, not GitHub, a failed fetch, not an image) is no
//!   avatar, and the page shows a folder glyph. Each repo's miss is logged once. A miss
//!   isn't kept on disk, so the next launch tries again.
//!
//! Nothing under the Claude dir is read (invariant 5): a repo there is a miss.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;

/// Why a repo has no avatar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Miss {
    /// No `.git` in the directory or above it.
    NoRepo,
    /// A `.git` file or config that couldn't be read or followed.
    BadGitDir,
    NoOrigin,
    NotGitHub,
    UnderClaudeDir,
    Fetch(String),
    NotAnImage,
}

/// The largest avatar kept; GitHub's are a few KB at `size=64`.
const MAX_BYTES: usize = 1 << 20;
const TIMEOUT: Duration = Duration::from_secs(10);

/// The git config file for the repo `dir` is in: `.git/config`, or for a worktree, the
/// config in the common dir its `.git` file leads to.
pub fn git_config(dir: &Path) -> Result<PathBuf, Miss> {
    let dot_git = dir.ancestors().map(|d| d.join(".git")).find(|g| g.exists()).ok_or(Miss::NoRepo)?;
    if dot_git.is_dir() {
        return Ok(dot_git.join("config"));
    }
    // A worktree: `gitdir: <path>`, relative to the `.git` file's directory.
    let text = std::fs::read_to_string(&dot_git).map_err(|_| Miss::BadGitDir)?;
    let gitdir = text.lines().find_map(|l| l.strip_prefix("gitdir:")).ok_or(Miss::BadGitDir)?.trim();
    let gitdir = dot_git.parent().unwrap().join(gitdir);
    // Its `commondir` names the main `.git`, relative to the worktree's gitdir.
    let common = match std::fs::read_to_string(gitdir.join("commondir")) {
        Ok(common) => gitdir.join(common.trim()),
        Err(_) => gitdir,
    };
    Ok(common.join("config"))
}

/// The `url` of `[remote "origin"]` in a git config file's text.
pub fn origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            // `[remote "origin"]`: the section name ignores case; the subsection doesn't.
            let header = line.trim_start_matches('[').split(']').next().unwrap_or("");
            let (name, sub) = header.split_once(char::is_whitespace).unwrap_or((header, ""));
            in_origin = name.eq_ignore_ascii_case("remote") && sub.trim() == "\"origin\"";
        } else if in_origin {
            let Some((key, value)) = line.split_once('=') else { continue };
            if key.trim().eq_ignore_ascii_case("url") {
                let value = value.trim();
                let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
                return Some(value.to_string()).filter(|v| !v.is_empty());
            }
        }
    }
    None
}

/// The owner in a GitHub remote URL: `https://github.com/<owner>/<repo>`,
/// `git@github.com:<owner>/<repo>.git`, or `ssh://git@github.com/<owner>/<repo>`. `None`
/// for any other host, or an owner GitHub wouldn't allow, so it never becomes an odd
/// path or URL.
pub fn github_owner(url: &str) -> Option<String> {
    let (host, path) = match url.split_once("://") {
        Some((scheme, rest)) => {
            if !["https", "http", "ssh", "git", "git+ssh"].contains(&scheme) {
                return None;
            }
            let (authority, path) = rest.split_once('/')?;
            (authority.rsplit('@').next()?, path)
        }
        // scp-like: `[user@]host:path`.
        None => {
            let (authority, path) = url.split_once(':')?;
            (authority.rsplit('@').next()?, path)
        }
    };
    let host = host.split(':').next()?.to_ascii_lowercase();
    if host != "github.com" && host != "www.github.com" {
        return None;
    }
    let mut parts = path.trim_start_matches('/').split('/');
    let owner = parts.next()?;
    parts.next().filter(|repo| !repo.is_empty())?;
    let valid = (1..=39).contains(&owner.len())
        && !owner.starts_with('-')
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    valid.then(|| owner.to_string())
}

/// The image's media type, from its first bytes: PNG, JPEG, GIF or WebP.
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Gets an owner's image bytes, or says why not.
pub type Fetch = dyn Fn(&str) -> Result<Vec<u8>, String> + Send + Sync;

type Found = Arc<OnceLock<Result<String, Miss>>>;

pub struct Avatars {
    /// `<data dir>/avatars`.
    cache: PathBuf,
    claude_dir: PathBuf,
    fetch: Box<Fetch>,
    /// Each owner's data URL or miss, found once per process.
    owners: Mutex<HashMap<String, Found>>,
    /// The repos whose miss has been logged.
    logged: Mutex<HashSet<PathBuf>>,
}

impl Avatars {
    /// The app's: fetched from GitHub, or in an e2e build, from the harness's server.
    pub fn new(data_dir: &Path, claude_dir: &Path) -> Avatars {
        Avatars::with_fetch(data_dir, claude_dir, Box::new(fetch_owner))
    }

    pub fn with_fetch(data_dir: &Path, claude_dir: &Path, fetch: Box<Fetch>) -> Avatars {
        Avatars {
            cache: data_dir.join("avatars"),
            claude_dir: claude_dir.to_path_buf(),
            fetch,
            owners: Mutex::new(HashMap::new()),
            logged: Mutex::new(HashSet::new()),
        }
    }

    /// The avatar for the repo `dir` is in, as a `data:` URL, and the line logged for its
    /// miss if this is the first one for `dir`.
    pub fn get(&self, dir: &Path) -> (Option<String>, Option<String>) {
        match self.lookup(dir) {
            Ok(url) => (Some(url), None),
            Err(miss) => {
                let first = self.logged.lock().unwrap().insert(dir.to_path_buf());
                let line = first.then(|| format!("oscillate: no avatar for {}: {miss:?}", dir.display()));
                if let Some(line) = &line {
                    eprintln!("{line}");
                }
                (None, line)
            }
        }
    }

    fn lookup(&self, dir: &Path) -> Result<String, Miss> {
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            return Err(Miss::NoRepo);
        }
        if dir.starts_with(&self.claude_dir) {
            return Err(Miss::UnderClaudeDir);
        }
        let config = git_config(dir)?;
        if config.starts_with(&self.claude_dir) {
            return Err(Miss::UnderClaudeDir);
        }
        let text = std::fs::read_to_string(&config).map_err(|_| Miss::BadGitDir)?;
        let owner = github_owner(&origin_url(&text).ok_or(Miss::NoOrigin)?).ok_or(Miss::NotGitHub)?;
        // One lookup per owner, however many repos or callers ask at once.
        let found = self.owners.lock().unwrap().entry(owner.clone()).or_default().clone();
        found.get_or_init(|| self.load(&owner)).clone()
    }

    /// The cached image, else a fetch, which is cached if it's an image.
    fn load(&self, owner: &str) -> Result<String, Miss> {
        let file = self.cache.join(owner);
        let bytes = match std::fs::read(&file) {
            Ok(bytes) if image_type(&bytes).is_some() => bytes,
            _ => {
                let bytes = (self.fetch)(owner).map_err(Miss::Fetch)?;
                if bytes.len() > MAX_BYTES || image_type(&bytes).is_none() {
                    return Err(Miss::NotAnImage);
                }
                if let Err(e) = write_atomic(&file, &bytes) {
                    eprintln!("oscillate: couldn't cache the avatar for {owner}: {e}");
                }
                bytes
            }
        };
        let kind = image_type(&bytes).unwrap();
        Ok(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
    }
}

fn write_atomic(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(file.parent().unwrap())?;
    let tmp = file.with_extension("part");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, file)
}

/// Where avatars come from: GitHub, or in an e2e build, the base URL in the file
/// `OSCILLATE_E2E_AVATAR_BASE` names. With no such file, an e2e build fetches nothing.
fn base_url() -> Result<String, String> {
    #[cfg(feature = "e2e")]
    {
        let file = std::env::var_os("OSCILLATE_E2E_AVATAR_BASE").ok_or("no avatar server (e2e)")?;
        let base = std::fs::read_to_string(file).map_err(|_| "no avatar server (e2e)")?;
        Ok(base.trim().trim_end_matches('/').to_string())
    }
    #[cfg(not(feature = "e2e"))]
    Ok("https://github.com".into())
}

fn fetch_owner(owner: &str) -> Result<Vec<u8>, String> {
    let url = format!("{}/{owner}.png?size=64", base_url()?);
    #[cfg(target_os = "macos")]
    return mac::get(&url, TIMEOUT);
    #[cfg(not(target_os = "macos"))]
    Err(format!("can't fetch {url}: not macOS"))
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_foundation::{
        NSData, NSError, NSHTTPURLResponse, NSString, NSURLRequest, NSURLRequestCachePolicy, NSURLResponse,
        NSURLSession, NSURL,
    };

    /// A GET through the shared `NSURLSession`, which follows GitHub's redirect to its
    /// avatar host. Only a 200's body is returned.
    pub fn get(url: &str, timeout: Duration) -> Result<Vec<u8>, String> {
        let ns_url = NSURL::URLWithString(&NSString::from_str(url)).ok_or_else(|| format!("not a URL: {url}"))?;
        let request = NSURLRequest::requestWithURL_cachePolicy_timeoutInterval(
            &ns_url,
            NSURLRequestCachePolicy::ReloadIgnoringLocalCacheData,
            timeout.as_secs_f64(),
        );
        let (tx, rx) = mpsc::channel();
        let done = RcBlock::new(move |data: *mut NSData, response: *mut NSURLResponse, error: *mut NSError| {
            // SAFETY: NSURLSession passes each as null or a live object for this call.
            let (data, response, error) = unsafe { (data.as_ref(), response.as_ref(), error.as_ref()) };
            let result = match error {
                Some(error) => Err(error.localizedDescription().to_string()),
                None => {
                    let status = response.and_then(|r| r.downcast_ref::<NSHTTPURLResponse>()).map(|r| r.statusCode());
                    match (status, data) {
                        (Some(200), Some(data)) => Ok(data.to_vec()),
                        (status, _) => Err(format!("HTTP {}", status.map_or("?".into(), |s| s.to_string()))),
                    }
                }
            };
            let _ = tx.send(result);
        });
        // SAFETY: the block is 'static and only sends on a channel, from any thread.
        let task = unsafe { NSURLSession::sharedSession().dataTaskWithRequest_completionHandler(&request, &done) };
        task.resume();
        rx.recv_timeout(timeout + Duration::from_secs(2)).unwrap_or_else(|_| {
            task.cancel();
            Err(format!("no answer in {timeout:?}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn item14_reads_origin_from_a_git_config() {
        let config = r#"
[core]
	bare = false
[remote "upstream"]
	url = https://github.com/someone/else.git
[Remote "origin"]
	# a comment
	URL = git@github.com:KjemalB14/oscillate.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
"#;
        assert_eq!(origin_url(config).as_deref(), Some("git@github.com:KjemalB14/oscillate.git"));
        assert_eq!(origin_url("[remote \"origin\"]\n\turl = \"https://x/y\"\n").as_deref(), Some("https://x/y"));
        assert_eq!(origin_url("[remote \"upstream\"]\n\turl = https://github.com/a/b\n"), None);
        assert_eq!(origin_url("[remote \"Origin\"]\n\turl = https://github.com/a/b\n"), None);
        assert_eq!(origin_url("[core]\n\tbare = false\n"), None);
        assert_eq!(origin_url(""), None);
    }

    #[test]
    fn item14_only_a_github_remote_has_an_owner() {
        for (url, owner) in [
            ("https://github.com/KjemalB14/oscillate.git", Some("KjemalB14")),
            ("https://github.com/KjemalB14/oscillate", Some("KjemalB14")),
            ("http://github.com/a-b/c", Some("a-b")),
            ("https://token@github.com/org/repo.git", Some("org")),
            ("git@github.com:KjemalB14/oscillate.git", Some("KjemalB14")),
            ("github.com:KjemalB14/oscillate.git", Some("KjemalB14")),
            ("ssh://git@github.com/KjemalB14/oscillate.git", Some("KjemalB14")),
            ("ssh://git@github.com:22/KjemalB14/oscillate.git", Some("KjemalB14")),
            ("https://GitHub.com/Owner/repo", Some("Owner")),
            ("https://gitlab.com/KjemalB14/oscillate.git", None),
            ("git@gitlab.com:KjemalB14/oscillate.git", None),
            ("https://github.com.evil.com/a/b", None),
            ("https://github.com/KjemalB14", None),
            ("https://github.com/../etc/passwd", None),
            ("https://github.com/-bad/repo", None),
            ("https://github.com/a%2Fb/repo", None),
            ("file:///Users/me/repo", None),
            ("/Users/me/repo", None),
            ("../repo", None),
            ("", None),
        ] {
            assert_eq!(github_owner(url).as_deref(), owner, "{url}");
        }
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn item14_finds_the_config_from_a_repo_a_subdir_and_a_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        write(&repo.join(".git/config"), "[remote \"origin\"]\n\turl = git@github.com:owner/repo.git\n");
        std::fs::create_dir_all(repo.join("src/deep")).unwrap();
        assert_eq!(git_config(&repo).unwrap(), repo.join(".git/config"));
        assert_eq!(git_config(&repo.join("src/deep")).unwrap(), repo.join(".git/config"));

        // A worktree inside the repo, as `.claude/worktrees/<name>`: a relative commondir.
        let wt = repo.join(".claude/worktrees/ui");
        let wt_gitdir = repo.join(".git/worktrees/ui");
        write(&wt.join(".git"), &format!("gitdir: {}\n", wt_gitdir.display()));
        write(&wt_gitdir.join("commondir"), "../..\n");
        let found = git_config(&wt).unwrap();
        assert_eq!(found.canonicalize().unwrap(), repo.join(".git/config").canonicalize().unwrap());

        // A worktree elsewhere whose `.git` file names its gitdir relatively.
        let far = tmp.path().join("far/wt");
        write(&far.join(".git"), "gitdir: ../../repo/.git/worktrees/far\n");
        write(&repo.join(".git/worktrees/far/commondir"), "../..\n");
        let found = git_config(&far.join(".")).unwrap();
        assert_eq!(found.canonicalize().unwrap(), repo.join(".git/config").canonicalize().unwrap());

        assert_eq!(git_config(&tmp.path().join("nowhere")), Err(Miss::NoRepo));
        write(&tmp.path().join("broken/.git"), "not a gitdir line\n");
        assert_eq!(git_config(&tmp.path().join("broken")), Err(Miss::BadGitDir));
    }

    struct Fixture {
        tmp: tempfile::TempDir,
        fetches: Arc<AtomicUsize>,
    }

    impl Fixture {
        fn new() -> Fixture {
            Fixture { tmp: tempfile::tempdir().unwrap(), fetches: Arc::new(AtomicUsize::new(0)) }
        }

        fn repo(&self, name: &str, origin: Option<&str>) -> PathBuf {
            let dir = self.tmp.path().join("repos").join(name);
            let remote = origin.map(|u| format!("[remote \"origin\"]\n\turl = {u}\n")).unwrap_or_default();
            write(&dir.join(".git/config"), &format!("[core]\n\tbare = false\n{remote}"));
            dir
        }

        /// Avatars over this fixture's data dir, whose fetch answers `answer`.
        fn avatars(&self, answer: fn(&str) -> Result<Vec<u8>, String>) -> Avatars {
            let fetches = self.fetches.clone();
            let fetch = move |owner: &str| {
                fetches.fetch_add(1, Ordering::SeqCst);
                answer(owner)
            };
            Avatars::with_fetch(&self.tmp.path().join("data"), &self.tmp.path().join("dot-claude"), Box::new(fetch))
        }

        fn fetches(&self) -> usize {
            self.fetches.load(Ordering::SeqCst)
        }
    }

    #[test]
    fn item14_fetched_once_cached_and_a_relaunch_makes_no_request() {
        let fx = Fixture::new();
        let a = fx.repo("a", Some("git@github.com:owner/a.git"));
        let b = fx.repo("b", Some("https://github.com/owner/b"));
        let avatars = fx.avatars(|_| Ok(PNG.to_vec()));

        let (url, logged) = avatars.get(&a);
        assert!(url.unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(logged, None);
        assert!(avatars.get(&b).0.is_some());
        assert!(avatars.get(&a).0.is_some());
        assert_eq!(fx.fetches(), 1, "one owner, one fetch");
        assert_eq!(std::fs::read(fx.tmp.path().join("data/avatars/owner")).unwrap(), PNG);

        // A relaunch: a new Avatars over the same data dir.
        let relaunched = fx.avatars(|_| panic!("a relaunch must not fetch"));
        assert!(relaunched.get(&a).0.is_some());
        assert_eq!(fx.fetches(), 1);
    }

    #[test]
    fn item14_every_miss_is_no_avatar_logged_once_per_repo() {
        let fx = Fixture::new();
        let none = fx.repo("none", None);
        let gitlab = fx.repo("gitlab", Some("git@gitlab.com:owner/repo.git"));
        let offline = fx.repo("offline", Some("git@github.com:offline/repo.git"));
        let html = fx.repo("html", Some("git@github.com:html/repo.git"));
        let plain = fx.tmp.path().join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let avatars = fx.avatars(|owner| match owner {
            "offline" => Err("The Internet connection appears to be offline.".into()),
            _ => Ok(b"<!DOCTYPE html><html>Not Found</html>".to_vec()),
        });

        for (dir, miss) in [
            (&none, "NoOrigin"),
            (&gitlab, "NotGitHub"),
            (&offline, "Fetch(\"The Internet connection appears to be offline.\")"),
            (&html, "NotAnImage"),
            (&plain, "NoRepo"),
        ] {
            let (url, logged) = avatars.get(dir);
            assert_eq!(url, None);
            assert_eq!(logged, Some(format!("oscillate: no avatar for {}: {miss}", dir.display())));
            assert_eq!(avatars.get(dir), (None, None), "logged once: {miss}");
        }
        assert_eq!(fx.fetches(), 2, "each owner is tried once per process");
        assert!(!fx.tmp.path().join("data/avatars/html").exists(), "a bad image isn't cached");
        assert!(!fx.tmp.path().join("data/avatars/offline").exists());
    }

    #[test]
    fn item14_a_bad_cached_file_is_fetched_again() {
        let fx = Fixture::new();
        let a = fx.repo("a", Some("git@github.com:owner/a.git"));
        write(&fx.tmp.path().join("data/avatars/owner"), "truncated");
        assert!(fx.avatars(|_| Ok(PNG.to_vec())).get(&a).0.is_some());
        assert_eq!(fx.fetches(), 1);
    }

    /// The real fetch, against GitHub: `cargo test real_github -- --ignored`. Never in the
    /// suite, which makes no request.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn real_github_avatar_and_a_missing_owner() {
        let bytes = mac::get("https://github.com/KjemalB14.png?size=64", TIMEOUT).unwrap();
        assert!(image_type(&bytes).is_some(), "{} bytes, not an image", bytes.len());
        let missing = mac::get("https://github.com/no-such-owner-0s.png?size=64", TIMEOUT);
        assert!(missing.unwrap_err().starts_with("HTTP 404"));
    }

    #[test]
    fn nothing_under_the_claude_dir_is_read() {
        let fx = Fixture::new();
        let inside = fx.tmp.path().join("dot-claude/jobs/x");
        write(&inside.join(".git/config"), "[remote \"origin\"]\n\turl = git@github.com:o/r.git\n");
        let avatars = fx.avatars(|_| Ok(PNG.to_vec()));
        assert_eq!(avatars.get(&inside).0, None);
        assert_eq!(avatars.get(Path::new("")).0, None);
        assert_eq!(avatars.get(Path::new("relative/dir")).0, None);
        assert_eq!(fx.fetches(), 0);
    }
}
