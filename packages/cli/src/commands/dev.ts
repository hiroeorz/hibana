import { Command } from 'commander';

import { runDevServer } from '../runtime/dev-server.js';

export const registerDevCommand = (program: Command): void => {
  const dev = program.command('dev').description('Run the local development server');

  dev
    .option('--port <port>', 'Override the default Wrangler port')
    .allowExcessArguments(true)
    .passThroughOptions()
    .action(async (options: { port?: string }, command: Command) => {
      try {
        const wranglerArgs = command.args ?? [];
        await runDevServer({
          port: options.port,
          wranglerArgs,
          projectRoot: command.parent?.getOptionValue('cwd') ?? process.cwd()
        });
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
