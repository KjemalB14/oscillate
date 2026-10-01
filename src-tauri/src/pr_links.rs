//! A session's PR links (PLAN-notifications.md, slice 2), read from its job's
//! `state.json`, `children[]` entries with `kind: "pr"`.
//!
//! This is invariant 2's one exception: the file is "not a stable interface", so every
//! miss means no links and nothing else. Each kind of miss is logged once per session,
//! not on every poll. It only reads (invariant 5).

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::sessions::Session;

/// One PR: `#<number>` on the row, `href` in the browser.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Pr {
    pub number: String,
    pub href: String,
}

/// Why a session has no links, or fewer than its file names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Miss {
    NoFile,
    Unreadable,
    NotJson,
    NoChildren,
    /// A PR child without a string or number `id`, or whose `href` isn't `https://`.
    BadPr,
}

/// The PRs a `state.json` names, oldest first, and what was wrong with it.
pub fn parse(bytes: &[u8]) -> (Vec<Pr>, Vec<Miss>) {
    let Ok(json) = serde_json::from_slice::<Value>(bytes) else {
        return (Vec::new(), vec![Miss::NotJson]);
    };
    let Some(children) = json.get("children").and_then(Value::as_array) else {
        return (Vec::new(), vec![Miss::NoChildren]);
    };
    let mut prs = Vec::new();
    let mut misses = Vec::new();
    for child in children.iter().filter(|c| c.get("kind").and_then(Value::as_str) == Some("pr")) {
        let number = match child.get("id") {
            Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.to_string()),
            _ => None,
        };
        let href = child.get("href").and_then(Value::as_str).filter(|h| h.starts_with("https://"));
        match (number, href) {
            (Some(number), Some(href)) => prs.push(Pr { number, href: href.to_string() }),
            _ => misses.push(Miss::BadPr),
        }
    }
    misses.dedup();
    (prs, misses)
}

/// Reads one job's links.
pub fn read(state_json: &Path) -> (Vec<Pr>, Vec<Miss>) {
    match std::fs::read(state_json) {
        Ok(bytes) => parse(&bytes),
        Err(e) if e.kind() == ErrorKind::NotFound => (Vec::new(), vec![Miss::NoFile]),
        Err(_) => (Vec::new(), vec![Miss::Unreadable]),
    }
}

/// Fills in each listed session's `prs`, on the poll thread.
pub struct PrLinks {
    jobs: PathBuf,
    logged: HashSet<(String, Miss)>,
}

impl PrLinks {
    pub fn new(jobs: PathBuf) -> PrLinks {
        PrLinks { jobs, logged: HashSet::new() }
    }

    /// Sets `prs` on every session with an id, and returns the lines it logged: one per
    /// session and kind of miss, the first time it's seen.
    pub fn attach(&mut self, sessions: &mut [Session]) -> Vec<String> {
        let mut lines = Vec::new();
        for s in sessions.iter_mut() {
            // Ids are letters and digits; anything else never becomes a path.
            let Some(id) = s.id.clone().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
            else {
                continue;
            };
            let (prs, misses) = read(&self.jobs.join(&id).join("state.json"));
            s.prs = prs;
            for miss in misses {
                if self.logged.insert((id.clone(), miss)) {
                    let line = format!("oscillate: no PR links for {id}: {miss:?}");
                    eprintln!("{line}");
                    lines.push(line);
                }
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::parse as parse_agents;

    fn ade5c70a() -> Vec<u8> {
        let children: Vec<Value> = (42..=46)
            .map(|n| {
                serde_json::json!({
                    "id": n.to_string(),
                    "href": format!("https://github.com/KjemalB14/clipped/pull/{n}"),
                    "kind": "pr",
                })
            })
            .collect();
        serde_json::to_vec(&serde_json::json!({ "state": "done", "children": children })).unwrap()
    }

    #[test]
    fn reads_pr_children_in_order() {
        let (prs, misses) = parse(&ade5c70a());
        assert!(misses.is_empty());
        let numbers: Vec<_> = prs.iter().map(|p| p.number.as_str()).collect();
        assert_eq!(numbers, ["42", "43", "44", "45", "46"]);
        assert_eq!(prs[4].href, "https://github.com/KjemalB14/clipped/pull/46");
    }

    #[test]
    fn every_miss_is_no_links() {
        assert_eq!(parse(b""), (vec![], vec![Miss::NotJson]));
        assert_eq!(parse(b"{not json"), (vec![], vec![Miss::NotJson]));
        assert_eq!(parse(br#"{"state":"done"}"#), (vec![], vec![Miss::NoChildren]));
        assert_eq!(parse(br#"{"children":{}}"#), (vec![], vec![Miss::NoChildren]));
        let other = br#"{"children":[{"id":"x","href":"https://e.com","kind":"task"}]}"#;
        assert_eq!(parse(other), (vec![], vec![]));
        let http = br#"{"children":[{"id":"7","href":"http://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(parse(http), (vec![], vec![Miss::BadPr]));
        let file = br#"{"children":[{"id":"7","href":"file:///etc/passwd","kind":"pr"}]}"#;
        assert_eq!(parse(file), (vec![], vec![Miss::BadPr]));
        let no_id = br#"{"children":[{"href":"https://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(parse(no_id), (vec![], vec![Miss::BadPr]));
    }

    #[test]
    fn a_number_id_is_kept() {
        let json = br#"{"children":[{"id":7,"href":"https://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(parse(json).0[0].number, "7");
    }

    fn session(id: &str) -> Session {
        let json = format!(r#"[{{"kind":"background","id":"{id}","cwd":"/r","state":"done"}}]"#);
        parse_agents(json.as_bytes()).unwrap().remove(0)
    }

    #[test]
    fn item16_each_miss_logs_once_per_session() {
        let dir = tempfile::tempdir().unwrap();
        let job = |id: &str, body: &[u8]| {
            std::fs::create_dir_all(dir.path().join(id)).unwrap();
            std::fs::write(dir.path().join(id).join("state.json"), body).unwrap();
        };
        job("good", &ade5c70a());
        job("garbled", b"{");
        job("bare", br#"{"state":"done"}"#);
        let mut links = PrLinks::new(dir.path().to_path_buf());
        let mut list: Vec<Session> =
            ["good", "garbled", "bare", "nofile"].into_iter().map(session).collect();

        let lines = links.attach(&mut list);
        assert_eq!(lines.len(), 3, "{lines:?}");
        assert!(lines.iter().any(|l| l.contains("garbled") && l.contains("NotJson")));
        assert!(lines.iter().any(|l| l.contains("bare") && l.contains("NoChildren")));
        assert!(lines.iter().any(|l| l.contains("nofile") && l.contains("NoFile")));
        assert_eq!(list[0].prs.len(), 5);
        assert!(list[1..].iter().all(|s| s.prs.is_empty()));

        assert!(links.attach(&mut list).is_empty(), "a repeat logs nothing more");

        // A new kind of miss for the same session is a new line.
        job("bare", b"");
        assert_eq!(links.attach(&mut list).len(), 1);
    }

    #[test]
    fn an_odd_id_never_becomes_a_path() {
        let dir = tempfile::tempdir().unwrap();
        let mut links = PrLinks::new(dir.path().to_path_buf());
        let mut list = vec![session("../etc")];
        assert!(links.attach(&mut list).is_empty());
        assert!(list[0].prs.is_empty());
    }
}
