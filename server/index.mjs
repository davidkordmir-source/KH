import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { app, store, sync } = createApp({ directory: process.env.DATA_DIR || path.join(root, '.data'), distDirectory: path.join(root, 'dist') });
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Didban API listening on ${host}:${port}`));
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
