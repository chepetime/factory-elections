// Loads the checkout's `.env` into process.env before anything reads it. Values already set in the
// environment win, so a one-off `FACTORY_ROOT=… pnpm web` still works. A missing file is fine.
import { join } from 'node:path';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
