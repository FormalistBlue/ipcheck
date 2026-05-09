import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '8788', 10);

const app = buildApp();

try {
  await app.listen({ host, port });
  app.log.info({ host, port }, 'ipcheck api listening');
} catch (error) {
  app.log.error(error, 'failed to start ipcheck api');
  process.exit(1);
}
