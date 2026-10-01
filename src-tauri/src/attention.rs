//! What deserves a notification, and what the Dock badge counts (PLAN-notifications.md).
//! Pure: `notifications.rs` does the posting.
//!
//! A notification is a transition into needs you, done or failed, for a session with an
//! id (terminal-tab rows have none, so a tap couldn't open them). The first list after
//! launch is the baseline and notifies nothing, so a relaunch never replays old news.
//! A key first seen after that, already in one of the three states, counts.

use std::collections::{HashMap, HashSet};

use crate::sessions::{Session, UiState};

/// One notification: its identifier is the session's id, so a newer one replaces it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
}

/// The last state of every session with an id; `None` until the baseline.
#[derive(Default)]
pub struct Attention {
    last: Option<HashMap<String, UiState>>,
}

fn notifies(state: UiState) -> bool {
    matches!(state, UiState::NeedsYou | UiState::Done | UiState::Failed)
}

impl Attention {
    /// The notes this list's transitions make, given every group label by `cwd`.
    pub fn update(&mut self, list: &[Session], labels: &HashMap<String, String>) -> Vec<Note> {
        let now: HashMap<String, UiState> =
            list.iter().filter_map(|s| Some((s.id.clone()?, s.state))).collect();
        let Some(last) = self.last.replace(now) else {
            return Vec::new();
        };
        list.iter()
            .filter(|s| notifies(s.state))
            .filter_map(|s| {
                let id = s.id.as_ref()?;
                (last.get(id) != Some(&s.state)).then(|| note(id, s, labels))
            })
            .collect()
    }
}

fn note(id: &str, s: &Session, labels: &HashMap<String, String>) -> Note {
    let body = match s.state {
        UiState::NeedsYou => match s.waiting_for.as_deref().map(str::trim) {
            Some(w) if !w.is_empty() => w.to_string(),
            _ => "Needs you".into(),
        },
        UiState::Done => "Done".into(),
        _ => "Failed".into(),
    };
    Note {
        id: id.to_string(),
        title: s.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| id.to_string()),
        subtitle: labels.get(&s.cwd).cloned().unwrap_or_else(|| label_of(&s.cwd, 1)),
        body,
    }
}

/// What the Dock badge counts: needs-you sessions, the visible one included.
pub fn needs_you(list: &[Session]) -> usize {
    list.iter().filter(|s| s.id.is_some() && s.state == UiState::NeedsYou).count()
}

/// Whether `id` is on screen: its pane is selected, and the window is key and not
/// minimized. Only then is its transition not notified.
pub fn visible(selected: Option<&str>, focused: bool, minimized: bool, id: &str) -> bool {
    focused && !minimized && selected == Some(id)
}

const NO_FOLDER: &str = "No folder";

fn segments(cwd: &str) -> Vec<&str> {
    cwd.split('/').filter(|s| !s.is_empty()).collect()
}

/// The last `depth` segments of `cwd`, or the whole path when it has fewer.
fn label_of(cwd: &str, depth: usize) -> String {
    let parts = segments(cwd);
    let tail = parts[parts.len().saturating_sub(depth)..].join("/");
    if !tail.is_empty() {
        tail
    } else if !cwd.is_empty() {
        cwd.to_string()
    } else {
        NO_FOLDER.to_string()
    }
}

/// Every group's label by `cwd`, as the sidebar shows it (`src/groups.ts`,
/// `groupSessions`): the basename, with parent segments added until no two groups share
/// one, or until colliding paths have none left.
pub fn labels<'a>(cwds: impl IntoIterator<Item = &'a str>) -> HashMap<String, String> {
    let unique: HashSet<&str> = cwds.into_iter().collect();
    let mut depth: HashMap<&str, usize> = unique.iter().map(|&c| (c, 1)).collect();
    loop {
        let mut holders: HashMap<String, Vec<&str>> = HashMap::new();
        for (&cwd, &d) in &depth {
            holders.entry(label_of(cwd, d)).or_default().push(cwd);
        }
        let mut deepened = false;
        for cwds in holders.values().filter(|c| c.len() > 1) {
            for &cwd in cwds {
                let d = depth.get_mut(cwd).unwrap();
                if *d < segments(cwd).len() {
                    *d += 1;
                    deepened = true;
                }
            }
        }
        if !deepened {
            break;
        }
    }
    depth.into_iter().map(|(cwd, d)| (cwd.to_string(), label_of(cwd, d))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::parse;

    fn fixture(name: &str) -> Vec<Session> {
        let path = format!("{}/fixtures/agents/{name}", env!("CARGO_MANIFEST_DIR"));
        parse(&std::fs::read(&path).unwrap()).unwrap()
    }

    fn with(list: &[Session], key: &str, state: UiState, waiting: Option<&str>) -> Vec<Session> {
        let mut next = list.to_vec();
        let s = next.iter_mut().find(|s| s.key == key).unwrap();
        s.state = state;
        s.waiting_for = waiting.map(Into::into);
        next
    }

    fn ids(notes: &[Note]) -> Vec<&str> {
        notes.iter().map(|n| n.id.as_str()).collect()
    }

    #[test]
    fn the_first_list_is_the_baseline() {
        let mut a = Attention::default();
        let list = fixture("all-states.json");
        // a2blocked, a3done and a4failed are already in a notifying state.
        assert!(a.update(&list, &HashMap::new()).is_empty());
        assert!(a.update(&list, &HashMap::new()).is_empty());
    }

    #[test]
    fn each_transition_into_the_three_states_notes_once() {
        let mut a = Attention::default();
        let list = fixture("all-states.json");
        let labels = labels(list.iter().map(|s| s.cwd.as_str()));
        a.update(&list, &labels);

        let blocked = with(&list, "a1working", UiState::NeedsYou, Some("approve Edit"));
        let notes = a.update(&blocked, &labels);
        assert_eq!(ids(&notes), ["a1working"]);
        assert_eq!(notes[0].body, "approve Edit");
        assert_eq!(notes[0].title, list[0].name.clone().unwrap_or("a1working".into()));
        assert_eq!(notes[0].subtitle, labels[&list[0].cwd]);
        assert!(a.update(&blocked, &labels).is_empty(), "no change, no note");

        let done = with(&blocked, "a1working", UiState::Done, None);
        assert_eq!(a.update(&done, &labels)[0].body, "Done");
        let failed = with(&done, "a1working", UiState::Failed, None);
        assert_eq!(a.update(&failed, &labels)[0].body, "Failed");
    }

    #[test]
    fn other_states_and_terminal_tabs_never_note() {
        let mut a = Attention::default();
        let list = fixture("all-states.json");
        a.update(&list, &HashMap::new());
        for state in [UiState::Working, UiState::Paused, UiState::Stopped, UiState::Unknown] {
            assert!(a.update(&with(&list, "a2blocked", state, None), &HashMap::new()).is_empty());
        }
        // Back to the baseline's states (a2blocked's return to blocked notes), then a tab.
        a.update(&list, &HashMap::new());
        let tab = "11111111-2222-3333-4444-555555555555";
        assert!(a.update(&with(&list, tab, UiState::NeedsYou, None), &HashMap::new()).is_empty());
    }

    #[test]
    fn a_new_key_after_the_baseline_counts() {
        let mut a = Attention::default();
        let list = fixture("all-states.json");
        a.update(&list, &HashMap::new());
        let mut next = list.clone();
        next[1].key = "fresh".into();
        next[1].id = Some("fresh".into());
        next[1].waiting_for = None;
        let notes = a.update(&next, &HashMap::new());
        assert_eq!(ids(&notes), ["fresh"]);
        assert_eq!(notes[0].body, "Needs you");
    }

    #[test]
    fn the_badge_counts_needs_you_with_an_id() {
        let list = fixture("all-states.json");
        assert_eq!(needs_you(&list), 1);
        let tab = "11111111-2222-3333-4444-555555555555";
        assert_eq!(needs_you(&with(&list, tab, UiState::NeedsYou, None)), 1);
        assert_eq!(needs_you(&with(&list, "a1working", UiState::NeedsYou, None)), 2);
    }

    #[test]
    fn item4_visible_only_when_selected_focused_and_not_minimized() {
        assert!(visible(Some("a"), true, false, "a"));
        assert!(!visible(Some("a"), false, false, "a"));
        assert!(!visible(Some("a"), true, true, "a"));
        assert!(!visible(Some("a"), false, true, "a"));
        assert!(!visible(Some("b"), true, false, "a"));
        assert!(!visible(None, true, false, "a"));
    }

    #[test]
    fn labels_match_the_sidebar() {
        let got = labels(["/u/code/beta", "/u/other/beta", "/u/gamma", ""]);
        assert_eq!(got["/u/code/beta"], "code/beta");
        assert_eq!(got["/u/other/beta"], "other/beta");
        assert_eq!(got["/u/gamma"], "gamma");
        assert_eq!(got[""], "No folder");
        let deep = labels(["/a/x/repo", "/b/x/repo"]);
        assert_eq!(deep["/a/x/repo"], "a/x/repo");
        assert_eq!(deep["/b/x/repo"], "b/x/repo");
        assert_eq!(labels(["/"])["/"], "/");
    }
}
