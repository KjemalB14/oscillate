import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "./fonts.css";
import App from "./App";
import { fontsReady, startTheme } from "./theme";

// WebdriverIO's plugin, in `npm run e2e` builds only (`VITE_E2E=1`).
if (import.meta.env.VITE_E2E) await import("@wdio/tauri-plugin");

startTheme();
// Terminals measure their cell once, when opened: the bundled face must be there first.
await fontsReady();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
