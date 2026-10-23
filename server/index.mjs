import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { app, store, sync } = createApp({ directory: process.env.DATA_DIR || path.join(root, '.data'), distDirectory: path.join(root, 'dist') });
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, error => {
  if (error) {
    clearTimeout(initialSync);
    clearInterval(interval);
    store.close();
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Dideban could not start its local server.');
    process.send?.({ type: 'dideban-error', code: error.code || 'START_FAILED' });
    process.exitCode = 1;
    process.disconnect?.();
    return;
  }
  const actualPort = server.address().port;
  console.log(`Didban API listening on ${host}:${actualPort}`);
  process.send?.({ type: 'dideban-ready', port: actualPort });
});
const runSync = () => { sync().catch(() => console.error('Scheduled synchronization did not complete.')); };
const initialSync = process.env.AUTO_SYNC === '0' ? null : setTimeout(runSync, 3000);
initialSync?.unref();
const interval = process.env.AUTO_SYNC === '0' ? null : setInterval(runSync, 15 * 60 * 1000);
interval?.unref();
function shutdown() {
  clearInterval(interval);
  clearTimeout(initialSync);
  server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
