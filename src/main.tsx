import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "@fontsource-variable/geist";
import "./fonts.css";
import App from "./App";
import { fontsReady, startTheme } from "./theme";

// WebdriverIO's plugin, in `npm run e2e` builds only (`VITE_E2E=1`).
if (import.meta.env.VITE_E2E) await import("@wdio/tauri-plugin");
// The speed gate's replay (`e2e/speed.check.ts`), likewise e2e builds only.
if (import.meta.env.VITE_E2E) await import("./bench");

startTheme();
// Terminals measure their cell once, when opened: the bundled face must be there first.
// The glass decides whether the window is painted (`glass.rs`); until then it is.
const [, glass] = await Promise.all([fontsReady(), invoke<boolean>("glass_state").catch(() => false)]);
if (glass) document.documentElement.dataset.glass = "on";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
