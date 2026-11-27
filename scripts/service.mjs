#!/usr/bin/env node
// Runs the factory stack as a macOS launchd user agent, outside any terminal or agent session:
// it starts at login, restarts after a crash, and its agent turns never inherit a Claude Code
// session's permission limits. Stopping it drains the backend (ExitTimeOut covers the drain).
//   node scripts/service.mjs print      Show the plist it would install (changes nothing)
//   node scripts/service.mjs install    Write ~/Library/LaunchAgents/<label>.plist and load it
//   node scripts/service.mjs uninstall  Stop the agent (with its drain) and remove the plist
//   node scripts/service.mjs status     Whether the agent is loaded, and its PID
//   node scripts/service.mjs restart    Stop with drain, then start again (what pnpm restart uses)
// Run install from your own terminal: a plist written from an agent session keeps that session's PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABEL = 'dev.factory-elections.stack';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = `gui/${userInfo().uid}`;
const dataRoot = process.env.FACTORY_ROOT ?? join(homedir(), '.local', 'share', 'factory');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The plist: `node scripts/start.mjs --dev` in this checkout, logs in the data root. */
export function plist({ node = process.execPath, path = process.env.PATH ?? '/usr/bin:/bin' } = {}) {
  const log = join(dataRoot, 'logs', 'stack.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(node)}</string>
    <string>${escape(join(repo, 'scripts', 'start.mjs'))}</string>
    <string>--dev</string>
  </array>
  <key>WorkingDirectory</key><string>${escape(repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escape(path)}</string>
    <key>HOME</key><string>${escape(homedir())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Restart after a crash, not after a clean stop. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <!-- SIGTERM, then this long for the backend drain (up to 5 min) before SIGKILL. -->
  <key>ExitTimeOut</key><integer>360</integer>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`;
}

const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });
const loaded = () => launchctl('print', `${domain}/${LABEL}`).status === 0;

function status() {
  const out = launchctl('print', `${domain}/${LABEL}`);
  if (out.status !== 0)
    return { label: LABEL, loaded: false, plist: existsSync(plistPath) ? plistPath : null };
  const pid = /\bpid = (\d+)/.exec(out.stdout)?.[1];
  return { label: LABEL, loaded: true, pid: pid ? Number(pid) : null, plist: plistPath };
}

const command = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === 'print') process.stdout.write(plist());
  else if (command === 'status') console.log(JSON.stringify(status()));
  else if (command === 'install') {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    if (dirname(common) !== repo)
      throw new Error('Install from the primary checkout, not a linked worktree.');
    if (process.env.CLAUDECODE === '1' || process.env.CLAUDE_CODE_SESSION_ID)
      throw new Error('Run install from your own terminal, not from a Claude Code session.');
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(join(dataRoot, 'logs'), { recursive: true });
    writeFileSync(plistPath, plist());
    if (loaded()) launchctl('bootout', `${domain}/${LABEL}`);
    const boot = launchctl('bootstrap', domain, plistPath);
    if (boot.status !== 0) throw new Error(`launchctl bootstrap failed: ${boot.stderr.trim()}`);
    console.log(`Installed and started ${LABEL}. Logs: ${join(dataRoot, 'logs', 'stack.log')}`);
  } else if (command === 'uninstall') {
    if (loaded()) launchctl('bootout', `${domain}/${LABEL}`);
    rmSync(plistPath, { force: true });
    console.log(`Removed ${LABEL}.`);
  } else if (command === 'restart') {
    if (!loaded()) throw new Error(`${LABEL} is not loaded; run install first.`);
    // -k: stop the running instance (SIGTERM, drain within ExitTimeOut), then start it again.
    execFileSync('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`], { stdio: 'inherit' });
    console.log(`Restarted ${LABEL}.`);
  } else {
    console.error('Usage: node scripts/service.mjs print|install|uninstall|status|restart');
    process.exit(2);
  }
}
