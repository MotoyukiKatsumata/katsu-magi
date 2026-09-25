import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

/** Locate chrome.exe (Windows) or a Chrome binary on other platforms. */
export function findChromeExecutable(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`browser.executablePath does not exist: ${explicit}`);
    return explicit;
  }
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["LOCALAPPDATA"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) {
    throw new Error(`Google Chrome was not found (looked in: ${candidates.join(", ")}). Set browser.executablePath in the config.`);
  }
  return found;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export interface SpawnedChrome {
  process: ChildProcess;
  cdpUrl: string;
}

/**
 * Start Chrome ourselves with a DevTools port instead of letting Playwright launch it.
 * On some machines Chrome crashes immediately under Playwright's pipe-based launch; a plain
 * spawn with --remote-debugging-port works and also gives us full control over the flags
 * (no --enable-automation, no test-only switches).
 */
export async function spawnChrome(opts: {
  executablePath: string;
  userDataDir: string;
  windowSize?: string;
  startMinimized?: boolean;
  extraArgs?: string[];
}): Promise<SpawnedChrome> {
  const port = await freePort();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${opts.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Keep every tab running at full speed. Only one of the three site tabs can be foreground,
    // and the whole window is usually behind the user's other windows; without these, Chrome
    // throttles the background renderers and answers arrive far too late (or not at all).
    // CalculateNativeWinOcclusion is the Windows-specific "this window is covered" detection.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=Translate,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
    "--disable-blink-features=AutomationControlled",
    `--window-size=${opts.windowSize ?? "1280,900"}`,
    ...(opts.startMinimized ? ["--start-minimized"] : []),
    ...(opts.extraArgs ?? []),
    "about:blank",
  ];
  const child = spawn(opts.executablePath, args, { stdio: "ignore", windowsHide: false });
  const cdpUrl = `http://127.0.0.1:${port}`;

  await waitForCdp(cdpUrl, child, 30_000);
  return { process: child, cdpUrl };
}

async function waitForCdp(cdpUrl: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: number | null | undefined;
  child.once("exit", (code) => (exited = code));
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`Chrome exited during startup (code ${exited})`);
    try {
      const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome did not open its DevTools port within ${timeoutMs / 1000}s`);
}

/**
 * Kill Chrome processes that still hold our profile directory (left over when a previous
 * server was killed hard). Windows only; other platforms return 0. Returns the number killed.
 */
export async function killStaleChrome(userDataDir: string): Promise<number> {
  if (process.platform !== "win32") return 0;
  const needle = userDataDir.replace(/'/g, "''");
  const script =
    `$ps = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${needle}*' }; ` +
    `$n = ($ps | Measure-Object).Count; ` +
    `$ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ` +
    `Write-Output $n`;
  return new Promise((resolve) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.on("close", () => resolve(Number.parseInt(out.trim(), 10) || 0));
    p.on("error", () => resolve(0));
  });
}

/** Terminate Chrome and its whole process tree. */
export function killChrome(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}
