import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Each group's avatar, asked for once per page load: a `data:` URL, or null for the
 * folder glyph. Rust fetches and caches it (`avatars.rs`). A failed ask is null too.
 */
const asked = new Map<string, Promise<string | null>>();

function avatarFor(cwd: string): Promise<string | null> {
  let p = asked.get(cwd);
  if (!p) {
    p = invoke<string | null>("repo_avatar", { cwd }).catch((e) => {
      console.error("repo_avatar:", e);
      return null;
    });
    asked.set(cwd, p);
  }
  return p;
}

/** `cwd`'s avatar: undefined while it's asked for, then a `data:` URL or null. */
export function useAvatar(cwd: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!cwd) return setUrl(null);
    let live = true;
    setUrl(undefined);
    void avatarFor(cwd).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [cwd]);
  return url;
}
