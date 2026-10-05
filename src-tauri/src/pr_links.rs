//! A session's PR links (PLAN-notifications.md, slice 2) and its last activity
//! (PLAN-ui-pass.md, slice 3), read from its job's `state.json`: `children[]` entries with
//! `kind: "pr"`, and `updatedAt`.
//!
//! This is invariant 2's one exception: the file is "not a stable interface", so every
//! miss means no links, or no time, and nothing else. Each kind of miss is logged once
//! per session, not on every poll. It only reads (invariant 5).

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

/// Why a session has no links (or fewer than its file names), or no time.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Miss {
    NoFile,
    Unreadable,
    NotJson,
    NoChildren,
    /// A PR child without a string or number `id`, or whose `href` isn't `https://`.
    BadPr,
    NoUpdatedAt,
    /// An `updatedAt` that isn't a UTC time as Claude Code writes it,
    /// `2026-10-04T23:17:49.030Z`.
    BadUpdatedAt,
}

impl Miss {
    /// What the miss costs the row. A miss of the whole file costs both.
    fn costs(self) -> &'static str {
        match self {
            Miss::NoFile | Miss::Unreadable | Miss::NotJson => "PR links or time",
            Miss::NoChildren | Miss::BadPr => "PR links",
            Miss::NoUpdatedAt | Miss::BadUpdatedAt => "time",
        }
    }
}

/// What one `state.json` gives a row.
#[derive(Debug, Default, PartialEq)]
pub struct JobState {
    /// Oldest first.
    pub prs: Vec<Pr>,
    /// `updatedAt`, in ms since the epoch.
    pub updated_at: Option<i64>,
    pub misses: Vec<Miss>,
}

impl JobState {
    fn missed(miss: Miss) -> JobState {
        JobState { misses: vec![miss], ..Default::default() }
    }
}

/// The PRs and the time a `state.json` names, and what was wrong with it.
pub fn parse(bytes: &[u8]) -> JobState {
    let Ok(json) = serde_json::from_slice::<Value>(bytes) else {
        return JobState::missed(Miss::NotJson);
    };
    let mut misses = Vec::new();
    let updated_at = match json.get("updatedAt") {
        None | Some(Value::Null) => {
            misses.push(Miss::NoUpdatedAt);
            None
        }
        Some(v) => {
            let ms = v.as_str().and_then(iso_ms);
            if ms.is_none() {
                misses.push(Miss::BadUpdatedAt);
            }
            ms
        }
    };
    let (prs, pr_misses) = prs(&json);
    misses.extend(pr_misses);
    JobState { prs, updated_at, misses }
}

fn prs(json: &Value) -> (Vec<Pr>, Vec<Miss>) {
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

/// `2026-10-04T23:17:49.030Z` in ms since the epoch: the form Claude Code writes, with
/// any fraction or none. Anything else, an offset included, is `None`.
pub fn iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let digits = &s[r];
        digits.bytes().all(|c| c.is_ascii_digit()).then(|| digits.parse().ok()).flatten()
    };
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut ms = 0;
    let rest = match s[19..].strip_prefix('.') {
        Some(frac) => {
            let digits = frac.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 {
                return None;
            }
            // The first three digits are the milliseconds.
            let first: String = frac[..digits].chars().chain("00".chars()).take(3).collect();
            ms = first.parse::<i64>().ok()?;
            &frac[digits..]
        }
        None => &s[19..],
    };
    if rest != "Z" || !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // Days since the epoch from the civil date (Howard Hinnant's `days_from_civil`).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + sec * 1000 + ms)
}

/// Reads one job's `state.json`.
pub fn read(state_json: &Path) -> JobState {
    match std::fs::read(state_json) {
        Ok(bytes) => parse(&bytes),
        Err(e) if e.kind() == ErrorKind::NotFound => JobState::missed(Miss::NoFile),
        Err(_) => JobState::missed(Miss::Unreadable),
    }
}

/// Fills in each listed session's `prs` and `updated_at`, on the poll thread.
pub struct PrLinks {
    jobs: PathBuf,
    logged: HashSet<(String, Miss)>,
}

impl PrLinks {
    pub fn new(jobs: PathBuf) -> PrLinks {
        PrLinks { jobs, logged: HashSet::new() }
    }

    /// Sets `prs` and `updated_at` on every session with an id, and returns the lines it
    /// logged: one per session and kind of miss, the first time it's seen.
    pub fn attach(&mut self, sessions: &mut [Session]) -> Vec<String> {
        let mut lines = Vec::new();
        for s in sessions.iter_mut() {
            // Ids are letters and digits; anything else never becomes a path.
            let Some(id) = s.id.clone().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
            else {
                continue;
            };
            let job = read(&self.jobs.join(&id).join("state.json"));
            s.prs = job.prs;
            s.updated_at = job.updated_at;
            for miss in job.misses {
                if self.logged.insert((id.clone(), miss)) {
                    let line = format!("oscillate: no {} for {id}: {miss:?}", miss.costs());
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

    const UPDATED: &str = "2026-10-04T23:17:49.030Z";
    /// `UPDATED`, as `Date.parse` reads it.
    const UPDATED_MS: i64 = 1_791_155_869_030;

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
        serde_json::to_vec(&serde_json::json!({ "state": "done", "updatedAt": UPDATED, "children": children }))
            .unwrap()
    }

    fn prs_of(bytes: &[u8]) -> (Vec<Pr>, Vec<Miss>) {
        let job = parse(bytes);
        let misses = job.misses.into_iter().filter(|m| m.costs() != "time").collect();
        (job.prs, misses)
    }

    #[test]
    fn reads_pr_children_in_order() {
        let job = parse(&ade5c70a());
        assert!(job.misses.is_empty(), "{:?}", job.misses);
        let numbers: Vec<_> = job.prs.iter().map(|p| p.number.as_str()).collect();
        assert_eq!(numbers, ["42", "43", "44", "45", "46"]);
        assert_eq!(job.prs[4].href, "https://github.com/KjemalB14/clipped/pull/46");
    }

    #[test]
    fn every_miss_is_no_links() {
        assert_eq!(prs_of(b""), (vec![], vec![Miss::NotJson]));
        assert_eq!(prs_of(b"{not json"), (vec![], vec![Miss::NotJson]));
        assert_eq!(prs_of(br#"{"state":"done"}"#), (vec![], vec![Miss::NoChildren]));
        assert_eq!(prs_of(br#"{"children":{}}"#), (vec![], vec![Miss::NoChildren]));
        let other = br#"{"children":[{"id":"x","href":"https://e.com","kind":"task"}]}"#;
        assert_eq!(prs_of(other), (vec![], vec![]));
        let http = br#"{"children":[{"id":"7","href":"http://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(prs_of(http), (vec![], vec![Miss::BadPr]));
        let file = br#"{"children":[{"id":"7","href":"file:///etc/passwd","kind":"pr"}]}"#;
        assert_eq!(prs_of(file), (vec![], vec![Miss::BadPr]));
        let no_id = br#"{"children":[{"href":"https://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(prs_of(no_id), (vec![], vec![Miss::BadPr]));
    }

    #[test]
    fn a_number_id_is_kept() {
        let json = br#"{"children":[{"id":7,"href":"https://e.com/pull/7","kind":"pr"}]}"#;
        assert_eq!(parse(json).prs[0].number, "7");
    }

    #[test]
    fn item12_reads_updated_at_as_claude_code_writes_it() {
        assert_eq!(parse(&ade5c70a()).updated_at, Some(UPDATED_MS));
        assert_eq!(iso_ms(UPDATED), Some(UPDATED_MS));
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("1970-01-01T00:00:00.5Z"), Some(500));
        assert_eq!(iso_ms("2000-02-29T12:00:00.123456Z"), Some(951_825_600_123));
        assert_eq!(iso_ms("1969-12-31T23:59:59.000Z"), Some(-1000));
    }

    #[test]
    fn item12_a_missing_or_bad_updated_at_is_no_time_and_keeps_the_links() {
        let job = parse(br#"{"children":[{"id":"7","href":"https://e.com/pull/7","kind":"pr"}]}"#);
        assert_eq!((job.updated_at, job.misses.as_slice()), (None, &[Miss::NoUpdatedAt][..]));
        assert_eq!(job.prs.len(), 1);
        assert_eq!(parse(br#"{"updatedAt":null,"children":[]}"#).misses, [Miss::NoUpdatedAt]);
        for bad in [
            r#"1791155869030"#,
            r#""""#,
            r#""yesterday""#,
            r#""2026-10-04""#,
            r#""2026-10-04T23:17:49""#,
            r#""2026-10-04T23:17:49.030+01:00""#,
            r#""2026-10-04 23:17:49.030Z""#,
            r#""2026-13-04T23:17:49.030Z""#,
            r#""2026-10-04T25:17:49.030Z""#,
            r#""2026-10-04T23:17:49.Z""#,
            r#""2026-1o-04T23:17:49.030Z""#,
            r#""+2026-10-04T23:17:49Z""#,
        ] {
            let job = parse(format!(r#"{{"updatedAt":{bad},"children":[]}}"#).as_bytes());
            assert_eq!((job.updated_at, job.misses.as_slice()), (None, &[Miss::BadUpdatedAt][..]), "{bad}");
        }
        assert_eq!(parse(b"{").updated_at, None);
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
        job("bare", br#"{"state":"done","updatedAt":"2026-10-04T23:17:49.030Z"}"#);
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
    fn item12_a_time_miss_logs_once_per_session() {
        let dir = tempfile::tempdir().unwrap();
        let job = |id: &str, body: &str| {
            std::fs::create_dir_all(dir.path().join(id)).unwrap();
            std::fs::write(dir.path().join(id).join("state.json"), body).unwrap();
        };
        job("timed", &format!(r#"{{"updatedAt":"{UPDATED}","children":[]}}"#));
        job("untimed", r#"{"children":[]}"#);
        job("badtime", r#"{"updatedAt":"soon","children":[]}"#);
        let mut links = PrLinks::new(dir.path().to_path_buf());
        let mut list: Vec<Session> = ["timed", "untimed", "badtime", "nofile"].into_iter().map(session).collect();

        let lines = links.attach(&mut list);
        assert_eq!(
            lines,
            [
                "oscillate: no time for untimed: NoUpdatedAt",
                "oscillate: no time for badtime: BadUpdatedAt",
                "oscillate: no PR links or time for nofile: NoFile",
            ]
        );
        let times: Vec<_> = list.iter().map(|s| s.updated_at).collect();
        assert_eq!(times, [Some(UPDATED_MS), None, None, None]);
        for _ in 0..3 {
            assert!(links.attach(&mut list).is_empty(), "a repeat logs nothing more");
        }

        // A time that goes away is gone from the row, and logs once.
        job("timed", r#"{"children":[]}"#);
        assert_eq!(links.attach(&mut list), ["oscillate: no time for timed: NoUpdatedAt"]);
        assert_eq!(list[0].updated_at, None);
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
