import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AddedRepos {
  /** Canonical paths from the app's `repos.json`; empty until Rust answers. */
  list: string[];
  /** "Add repo…": the folder picker, then the add. A cancel changes nothing. */
  add: () => void;
  /** "Remove from list". */
  remove: (path: string) => void;
}

/** The repos added with "Add repo…" (`src-tauri/src/repos.rs`). */
export function useAddedRepos(): AddedRepos {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("repos_list")
      .then(setList)
      .catch((e) => console.error("repos:", e));
  }, []);

  const apply = (call: Promise<string[]>) =>
    call.then(setList).catch((e) => console.error("repos:", e));
  return {
    list,
    add: () => void apply(invoke<string[]>("repos_add")),
    remove: (path) => void apply(invoke<string[]>("repos_remove", { path })),
  };
}
