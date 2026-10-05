import { pathToFileURL } from 'node:url';
// IPC closes even when the parent bot is killed: no orphan helper after restart.
process.once('disconnect', () => process.exit(0));
const entry = process.argv[2];
process.argv = [process.execPath, entry, '--host', '127.0.0.1', '--port', '4416'];
await import(pathToFileURL(entry).href);
