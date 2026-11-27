import '../../../scripts/load-env.ts';
import { dataRoot } from '@factory/adapters-fs';
import { serveBackend } from '@factory/backend/lifecycle';
// Sandboxes read the data root from the environment to hide it, so it must be the resolved path.
process.env.FACTORY_ROOT = dataRoot();
await serveBackend(process.env.FACTORY_ROOT);
