/**
 * `npm run e2e:snapshot`: the app as its accessibility tree names it, for the spec author.
 * Writes `e2e/.results/snapshot.txt` after the app has read the fixture named by
 * `SNAPSHOT_FIXTURE` (default `all-states`), one line per element that has a role, a name
 * or its own text. Not a spec: it asserts nothing.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { show } from "./helpers/app.js";
import { RESULTS } from "./helpers/results.js";

describe("snapshot", () => {
  it("writes the accessibility tree", async () => {
    const fixture = process.env.SNAPSHOT_FIXTURE || "all-states";
    await show(fixture);
    await browser.pause(300); // the event and React's render, after the poll
    const tree = await browser.execute(() => {
      const IMPLICIT: Record<string, string> = {
        NAV: "navigation", MAIN: "main", BUTTON: "button", UL: "list", OL: "list",
        LI: "listitem", P: "paragraph", A: "link", H1: "heading", H2: "heading",
        H3: "heading", INPUT: "textbox", TEXTAREA: "textbox", CODE: "code",
      };
      const lines: string[] = [];
      const walk = (el: Element, depth: number) => {
        if (el.getAttribute("aria-hidden") === "true") return;
        // The terminal is one opaque widget here; its insides are xterm's, not the app's.
        if (el.classList.contains("xterm")) {
          lines.push(`${"  ".repeat(depth)}terminal`);
          return;
        }
        let role = el.getAttribute("role") ?? IMPLICIT[el.tagName] ?? "";
        if (el.tagName === "SECTION" && el.hasAttribute("aria-label")) role = "region";
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent!.trim())
          .filter(Boolean)
          .join(" ");
        const name = el.getAttribute("aria-label");
        const states = [...el.attributes]
          .filter((a) => a.name.startsWith("aria-") && a.name !== "aria-label" && a.name !== "aria-controls")
          .map((a) => `${a.name}=${a.value}`);
        const shown = role || name || own || states.length;
        if (shown) {
          const parts = [
            role || el.tagName.toLowerCase(),
            name ? `"${name}"` : "",
            own ? `text="${own}"` : "",
            ...states,
          ].filter(Boolean);
          lines.push(`${"  ".repeat(depth)}${parts.join(" ")}`);
        }
        for (const child of el.children) walk(child, shown ? depth + 1 : depth);
      };
      walk(document.body, 0);
      return lines.join("\n");
    });
    writeFileSync(join(RESULTS, "snapshot.txt"), `# fixture: ${fixture}\n${tree}\n`);
  });
});
