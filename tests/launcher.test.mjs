import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectPort, desktopPaths, browserCommand } from '../launch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));

test('a busy default port falls back to an OS-selected port; an explicit port is never silently changed', async () => {
  const occupied = net.createServer();
  const port = await listen(occupied);
  try {
    assert.equal(await selectPort(undefined, port), 0);
    await assert.rejects(() => selectPort(String(port)), /already in use/);
    await assert.rejects(() => selectPort('invalid'), /between 1 and 65535/);
  } finally { await close(occupied); }
});

test('Windows desktop state is per user and explicit data paths are preserved', () => {
  const locations = desktopPaths('C:\\Downloads\\Dideban', { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' }, 'win32');
  assert.equal(locations.data, 'C:\\Users\\Tester\\AppData\\Local\\Dideban\\data');
  assert.equal(locations.log, 'C:\\Users\\Tester\\AppData\\Local\\Dideban\\startup.log');
  assert.equal(desktopPaths('C:\\Downloads\\Dideban', { LOCALAPPDATA: 'C:\\Local', DATA_DIR: 'D:\\NewsData' }, 'win32').data, 'D:\\NewsData');
  const command = browserCommand('win32', 'http://127.0.0.1:4567');
  assert.equal(command.command, 'cmd.exe');
  assert.equal(command.args.at(-1), 'start "" "http://127.0.0.1:4567"');
  assert.equal(command.windowsVerbatimArguments, true);
  assert.throws(() => browserCommand('win32', 'http://example.com/&command'), /Invalid/);
});

test('the launcher refuses an occupied explicit port without opening or querying the unrelated server', async t => {
  let requests = 0;
  const unrelated = http.createServer((_req, res) => { requests++; res.end('{"status":"ok","storage":"sqlite"}'); });
  const port = await listen(unrelated);
  const data = mkdtempSync(path.join(os.tmpdir(), 'dideban-launch-failure-'));
  const child = spawn(process.execPath, ['launch.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data, DIDEBAN_NO_BROWSER: '1', AUTO_SYNC: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { child.kill('SIGTERM'); await close(unrelated); rmSync(data, { force: true, recursive: true }); });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 1);
  assert.match(output, /already in use/);
  assert.ok(!output.includes('Dideban is ready:'));
  assert.equal(requests, 0);
});

test('the launcher waits for its own child readiness and serves the built app from a clean data directory', async t => {
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  const data = mkdtempSync(path.join(os.tmpdir(), 'dideban-launch-ready-'));
  const child = spawn(process.execPath, ['launch.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data, DIDEBAN_NO_BROWSER: '1', AUTO_SYNC: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const finished = new Promise(resolve => child.once('close', resolve));
  let output = '';
  t.after(async () => { child.kill('SIGTERM'); await finished; rmSync(data, { force: true, recursive: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Launcher did not become ready: ${output}`)), 10_000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes(`Dideban is ready: http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Launcher exited early (${code}): ${output}`)); });
  });
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(health.storage, 'sqlite');
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /خبرنما/);
  const dashboard = await (await fetch(`http://127.0.0.1:${port}/api/dashboard`)).json();
  assert.equal(dashboard.articles.length, 0);
  assert.equal(dashboard.sources.filter(source => source.enabled).length, 4);
  assert.equal(dashboard.sources.filter(source => source.countryCode === 'IR').length, 4);
  // The log location is stable even when news data is moved elsewhere.
  assert.match(readFileSync(path.join(root, '.data', 'startup.log'), 'utf8'), /Dideban is ready:/);
});

test('direct server startup reports a bind failure instead of claiming it is listening', async t => {
  const occupied = net.createServer();
  const port = await listen(occupied);
  const data = mkdtempSync(path.join(os.tmpdir(), 'dideban-bind-failure-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data, AUTO_SYNC: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  const messages = [];
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('message', message => messages.push(message));
  t.after(async () => { child.kill('SIGTERM'); await close(occupied); rmSync(data, { force: true, recursive: true }); });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1);
  assert.match(output, /already in use/);
  assert.ok(!output.includes('API listening'));
  assert.ok(messages.some(message => message.type === 'dideban-error' && message.code === 'EADDRINUSE'));
  assert.ok(!messages.some(message => message.type === 'dideban-ready'));
});
