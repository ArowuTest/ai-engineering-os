import { startServer } from './server.js';

const runtime = await startServer();
console.log('AI Engineering OS API listening');

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`Stopping API after ${signal}`);
  await runtime.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
