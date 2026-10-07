/**
 * Playwright global setup — boots wrangler dev once for the whole suite.
 *
 * Why: spinning up wrangler dev per test file is expensive (~5s each).
 * One shared dev server means tests run fast.
 *
 * Failure mode: if wrangler dev fails to boot (port conflict, missing
 * D1/KV bindings), every test fails with a clear connection error.
 */
import { spawn, ChildProcess, ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { request as httpRequest } from "node:http";

type WranglerProcess = ChildProcessByStdio<null, Readable, Readable>;
let wranglerProcess: WranglerProcess | null = null;
let baseURL = "";

const PORT = 8788;

export async function setup(): Promise<void> {
  console.log("[playwright-setup] starting wrangler dev on port", PORT);
  wranglerProcess = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Skip wrangler's interactive update prompts in CI
        WRANGLER_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  wranglerProcess.stdout?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    if (s.includes("Ready") || s.includes("Listening")) {
      console.log("[playwright-setup] wrangler ready:", s.trim().split("\n")[0]);
    }
  });
  wranglerProcess.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    // Miniflare prints "Ready on http://..." — that's our signal
    if (s.includes("Ready on")) {
      console.log("[playwright-setup] wrangler ready:", s.trim());
    }
  });

  baseURL = `http://127.0.0.1:${PORT}`;
  await waitForServer(baseURL, 60_000);
  console.log("[playwright-setup] server is up at", baseURL);
}

export async function teardown(): Promise<void> {
  const proc = wranglerProcess;
  if (proc && !proc.killed) {
    console.log("[playwright-setup] killing wrangler dev");
    proc.kill("SIGTERM");
    // Give it a moment, then SIGKILL if still alive
    await sleep(1000);
    if (!proc.killed) proc.kill("SIGKILL");
  }
}

/**
 * Expose the URL to tests via env var.
 */
export function getBaseURL(): string {
  return baseURL || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8788";
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await ping(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`wrangler dev did not respond at ${url} within ${timeoutMs}ms`);
}

function ping(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url + "/", { method: "GET", timeout: 2000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("ping timeout")));
    req.end();
  });
}

// Quiet TS unused-import linting
void ChildProcess;