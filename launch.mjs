import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3001);
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Dideban requires Node.js 24 or newer: https://nodejs.org/');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a number between 1 and 65535.');
  process.exit(1);
}
const address = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
let finished = false;
server.once('error', () => {
  finished = true;
  console.error('Could not start Dideban. Check that Node.js is installed.');
  process.exitCode = 1;
});
server.once('exit', code => {
  finished = true;
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.kill(signal); });
}

let ready = false;
for (let attempt = 0; attempt < 40 && !finished; attempt++) {
  try {
    const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1000) });
    const health = await response.json();
    if (response.ok && health.status === 'ok' && health.storage === 'sqlite') { ready = true; break; }
  } catch { /* Wait for the local application to start. */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (ready && !finished) {
  console.log(`\nDideban is ready: ${address}\nKeep this window open. Press Ctrl+C to stop.\n`);
  if (process.env.DIDEBAN_NO_BROWSER !== '1') {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', address] : [address];
    const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
    opener.on('error', () => console.log(`Open ${address} in your browser.`));
    opener.unref();
  }
} else if (!finished) {
  console.error('Dideban did not start in time. Check the messages above.');
  server.kill('SIGTERM');
  process.exitCode = 1;
}
