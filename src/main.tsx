import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// WebdriverIO's plugin, in `npm run e2e` builds only (`VITE_E2E=1`).
if (import.meta.env.VITE_E2E) await import("@wdio/tauri-plugin");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
