import { execSync } from 'node:child_process';

const port = Number(process.argv[2] || 1420);

function freePortWindows(p) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: 'utf8' },
    );
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[free-port] killed PID ${pid} on :${p}`);
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing listening
  }
}

if (process.platform === 'win32') {
  freePortWindows(port);
} else {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: 'ignore' });
  } catch {
    // ignore
  }
}
