import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export function desktopPaths(directory, environment = process.env, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const state = platform === 'win32'
    ? paths.join(environment.LOCALAPPDATA || paths.join(os.homedir(), 'AppData', 'Local'), 'Dideban')
    : paths.join(directory, '.data');
  return {
    data: environment.DATA_DIR ? paths.resolve(directory, environment.DATA_DIR) : platform === 'win32' ? paths.join(state, 'data') : state,
    log: paths.join(state, 'startup.log'),
  };
}

async function portIsFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve(true)));
  });
}

export async function selectPort(value, preferred = 3001) {
  const explicit = value !== undefined && value !== '';
  const port = explicit ? Number(value) : preferred;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535.');
  if (await portIsFree(port)) return port;
  if (explicit) throw new Error(`Port ${port} is already in use. Close the other application or remove PORT from .env.`);
  // Let the operating system choose a free port; the child reports the exact port.
  return 0;
}

export function browserCommand(platform, address) {
  if (!/^http:\/\/127\.0\.0\.1:\d+(?:\/\?v=\d+\.\d+\.\d+)?$/.test(address)) throw new Error('Invalid local application address.');
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/s', '/c', `start "" "${address}"`], windowsVerbatimArguments: true };
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [address] };
}

export async function runLauncher({ directory = root, environment = process.env, platform = process.platform } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Dideban requires Node.js 24 or newer.');
  const locations = desktopPaths(directory, environment, platform);
  mkdirSync(path.dirname(locations.log), { recursive: true, mode: 0o700 });
  const log = createWriteStream(locations.log, { flags: 'w', mode: 0o600 });
  log.on('error', () => process.stderr.write(`Could not write the startup log at ${locations.log}.\n`));
  const write = (message, error = false) => {
    const line = `${message}\n`;
    log.write(line);
    (error ? process.stderr : process.stdout).write(line);
  };
  write('Starting Dideban...');
  write(`Startup log: ${locations.log}`);
  let server;
  let interrupted = false;
  const stop = signal => { interrupted = true; server?.kill(signal); };
  const stopInterrupt = () => stop('SIGINT');
  const stopTerminate = () => stop('SIGTERM');
  try {
    const port = await selectPort(environment.PORT);
    server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...environment, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: locations.data },
    });
    server.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
    server.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
    const completed = new Promise(resolve => server.once('close', (code, signal) => resolve({ code, signal })));
    process.on('SIGINT', stopInterrupt);
    process.on('SIGTERM', stopTerminate);
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup took too long. Check the startup log.')), 15_000);
      const cleanup = () => { clearTimeout(timer); server.off('message', message); server.off('error', failed); server.off('exit', exited); };
      const failed = error => { cleanup(); reject(error); };
      const exited = () => failed(new Error('The application could not start. Check the startup log above.'));
      const message = value => {
        if (value?.type === 'dideban-error') return failed(new Error(value.code === 'EADDRINUSE' ? 'The selected port was taken before startup. Run Dideban again.' : 'The local server could not start. Check the startup log.'));
        if (value?.type !== 'dideban-ready') return;
        if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return failed(new Error('The server returned an invalid port.'));
        cleanup(); resolve(value.port);
      };
      server.on('message', message);
      server.once('error', failed);
      server.once('exit', exited);
    });
    const address = `http://127.0.0.1:${ready}`;
    const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!response.ok || health.status !== 'ok' || health.storage !== 'sqlite') throw new Error('The application did not pass its startup check.');
    const entry = await fetch(address + '/', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const html = await entry.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(match => match[1]);
    if (!entry.ok || !assets.length) throw new Error('Application page is missing. Extract the complete ZIP into a new folder.');
    for (const asset of assets) {
      const file = await fetch(address + asset, { signal: AbortSignal.timeout(3000) });
      await file.body?.cancel();
      if (!file.ok || file.headers.get('content-type')?.includes('text/html')) throw new Error('Application files are incomplete. Extract the complete ZIP into a new folder.');
    }
    const version = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
    const openAddress = /^\d+\.\d+\.\d+$/.test(version) ? `${address}/?v=${version}` : address;
    write(`\nDideban is ready: ${address}\nKeep this window open. Press Ctrl+C to stop.\n`);
    if (environment.DIDEBAN_NO_BROWSER !== '1') {
      const openerConfig = browserCommand(platform, openAddress);
      const opener = spawn(openerConfig.command, openerConfig.args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: openerConfig.windowsVerbatimArguments });
      opener.on('error', () => write(`Open ${address} in your browser.`));
      opener.on('exit', code => { if (code) write(`Open ${address} in your browser.`); });
      opener.unref();
    }
    const outcome = await completed;
    if (outcome.code && !interrupted) throw new Error(`Dideban stopped unexpectedly (exit ${outcome.code}). Check the startup log.`);
  } catch (error) {
    write(`\nCould not start Dideban: ${error.message}`, true);
    server?.kill('SIGTERM');
    throw error;
  } finally {
    process.off('SIGINT', stopInterrupt);
    process.off('SIGTERM', stopTerminate);
    log.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runLauncher(); }
  catch { process.exitCode = 1; }
}
