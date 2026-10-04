/**
 * `wdio run e2e/wdio.conf.ts --spec e2e/layers.check.ts`: a probe, not a criterion spec.
 * With one pane open on the fake, it prints every element stacked under three points of
 * the terminal (a cell, the padding strip, the grid's remainder) with its computed
 * background, and the alpha those backgrounds composite to. Slice 2 uses it to see
 * what paints the terminal's background (PLAN-ui-pass.md, *Slice 2*).
 */
import { attachable, show } from "./helpers/app.js";

describe("layers", () => {
  it("prints the background layers under the terminal", async () => {
    await show([attachable("layers1", { repo: "layers-repo" })]);
    await $("li*=layers1").click();
    await $(".terminal-pane:not(.hidden) .xterm").waitForExist();
    await browser.pause(500);
    const report = await browser.execute(() => {
      const host = document.querySelector(".terminal-pane:not(.hidden) .terminal-host")!;
      const xterm = host.querySelector(".xterm")!;
      const screen = host.querySelector(".xterm-screen")!;
      const h = host.getBoundingClientRect();
      const s = screen.getBoundingClientRect();
      const points: Record<string, [number, number]> = {
        cell: [s.left + 40, s.top + 40],
        strip: [h.left + 2, h.top + 40],
        remainder: [h.right - 2, h.top + 40],
      };
      const describe = (el: Element) => {
        const cs = getComputedStyle(el);
        const cls = typeof el.className === "string" ? el.className : "";
        return `${el.tagName.toLowerCase()}.${cls.split(" ").join(".")} bg=${cs.backgroundColor} opacity=${cs.opacity}`;
      };
      const out: string[] = [
        `html bg=${getComputedStyle(document.documentElement).backgroundColor} glass=${document.documentElement.dataset.glass}`,
        `.xterm classes: ${xterm.className}`,
        `host ${JSON.stringify(h)} screen ${JSON.stringify(s)}`,
      ];
      for (const [name, [x, y]] of Object.entries(points)) {
        out.push(`-- ${name} (${Math.round(x)},${Math.round(y)})`);
        for (const el of document.elementsFromPoint(x, y)) out.push(`   ${describe(el)}`);
      }
      for (const c of host.querySelectorAll("canvas")) {
        const gl = (c as HTMLCanvasElement).getContext("webgl2") as WebGL2RenderingContext | null;
        const attrs = gl?.getContextAttributes();
        out.push(`canvas.${c.className} ${c.width}x${c.height} webgl2=${!!gl} attrs=${JSON.stringify(attrs)}`);
      }
      return out.join("\n");
    });
    console.log(`\n=== layers ===\n${report}\n=== end ===`);
  });
});
