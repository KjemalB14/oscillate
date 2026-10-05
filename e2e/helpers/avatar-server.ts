/**
 * A local stand-in for `https://github.com/<owner>.png` (PLAN-ui-pass.md, criterion 14).
 *
 * The e2e build never fetches from GitHub. It fetches an avatar from the base URL in the
 * file `OSCILLATE_E2E_AVATAR_BASE` names (`fake.avatarBaseFile`), and with no such file
 * it fetches nothing: every GitHub repo is then a miss. `AvatarServer.start()` writes
 * that file, and `stop()` removes it. The server lives in the spec's own process.
 *
 * What the app keeps (`src-tauri/src/avatars.rs`, `src/avatars.ts`):
 * - Each owner is looked up once per app process, hit or miss. A miss isn't cached on
 *   disk, so only a relaunch tries again. Use a fresh owner name for each case.
 * - A hit is cached as `<data dir>/avatars/<owner>` (`fake.avatarCache()`), and a later
 *   launch reads it without a request.
 * - The page asks once per group directory per page load.
 */
import { createServer, type Server } from "node:http";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeClaude } from "./fake-claude.js";

const PNG = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "avatar.png"));

/**
 * How the server answers an owner:
 * - `png`: 200 with `fixtures/avatar.png` (8×8). The default.
 * - `not-found`: 404 with an HTML body, as GitHub answers an unknown owner.
 * - `html`: 200 with an HTML body, which isn't an image.
 * - `garbage`: 200 with bytes that aren't an image.
 */
export type AvatarAnswer = "png" | "not-found" | "html" | "garbage";

/** One request the server got. `owner` is the path's `<owner>` in `/<owner>.png`. */
export interface AvatarRequest {
  owner: string;
  path: string;
  at: number;
}

export class AvatarServer {
  private readonly answers = new Map<string, AvatarAnswer>();
  private readonly log: AvatarRequest[] = [];

  private constructor(
    private readonly server: Server,
    readonly base: string,
    private readonly fake: FakeClaude,
  ) {}

  /** Starts on a free local port and points the app at it. */
  static async start(): Promise<AvatarServer> {
    const fake = FakeClaude.shared();
    let self: AvatarServer | undefined;
    const server = createServer((req, res) => self!.handle(req.url ?? "/", res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    self = new AvatarServer(server, `http://127.0.0.1:${port}`, fake);
    self.online();
    return self;
  }

  private handle(url: string, res: import("node:http").ServerResponse) {
    const path = url.split("?")[0];
    const owner = decodeURIComponent(path.replace(/^\//, "").replace(/\.png$/, ""));
    this.log.push({ owner, path: url, at: Date.now() });
    switch (this.answers.get(owner) ?? "png") {
      case "png":
        res.writeHead(200, { "content-type": "image/png" }).end(PNG);
        break;
      case "not-found":
        res.writeHead(404, { "content-type": "text/html" }).end("<!DOCTYPE html><html>Not Found</html>");
        break;
      case "html":
        res.writeHead(200, { "content-type": "text/html" }).end("<!DOCTYPE html><html>a sign-in page</html>");
        break;
      case "garbage":
        res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from("not an image at all"));
        break;
    }
  }

  /** Sets how `owner` is answered from now on. */
  answer(owner: string, how: AvatarAnswer) {
    this.answers.set(owner, how);
  }

  /** Every request so far, in order, or only `owner`'s. */
  requests(owner?: string): AvatarRequest[] {
    return this.log.filter((r) => owner === undefined || r.owner === owner);
  }

  /**
   * Points the app at a port nothing listens on, as being offline: each fetch is
   * refused. The server still runs; `online()` points the app back at it.
   */
  offline() {
    writeFileSync(this.fake.avatarBaseFile, "http://127.0.0.1:9");
  }

  online() {
    writeFileSync(this.fake.avatarBaseFile, this.base);
  }

  /** Stops the server and removes the base file, so the app fetches nothing again. */
  async stop() {
    rmSync(this.fake.avatarBaseFile, { force: true });
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
