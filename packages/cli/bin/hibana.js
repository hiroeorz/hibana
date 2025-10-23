#!/usr/bin/env node

import('../dist/index.js')
  .catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('The Hibana CLI is not built yet. Run `npm run build --workspace @hibana/cli` and try again.');
    } else {
      console.error('Failed to launch the Hibana CLI.');
      console.error(error);
    }
    process.exitCode = 1;
  });
