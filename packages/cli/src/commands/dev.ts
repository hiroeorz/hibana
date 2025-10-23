import { Command } from 'commander';

import { runDevServer } from '../runtime/dev-server.js';

export const registerDevCommand = (program: Command): void => {
  program
    .command('dev')
    .description('Run the local development server')
    .option('--port <port>', 'Override the default Wrangler port')
    .action(async (options: { port?: string }) => {
      try {
        await runDevServer({ port: options.port });
      } catch (error: unknown) {
        console.error('Failed to start Hibana dev server.');
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error(error);
        }
        process.exitCode = 1;
      }
    });
};
