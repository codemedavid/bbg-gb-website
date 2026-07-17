import { createApp } from './app.js';
import { env } from './lib/env.js';
import { ensureBuckets } from './lib/storage.js';

const app = createApp();

ensureBuckets()
  .catch((e) => console.warn('[storage] bucket check skipped:', e.message))
  .finally(() => {
    app.listen(env.port, () => {
      console.log(`BBG Peptides API on http://localhost:${env.port}  (storage: ${env.storageDriver})`);
    });
  });
