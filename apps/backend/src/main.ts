import { dataRoot } from '@factory/adapters-fs';
import { serveBackend } from '@factory/backend/lifecycle';
await serveBackend(dataRoot());
