import { Command } from 'commander';

export const registerDevCommand = (program: Command): void => {
  program
    .command('dev')
    .description('Run the local development server')
    .option('--port <port>', 'Override the default Wrangler port')
    .action(async (options: { port?: string }) => {
      const portInfo = options.port ? ` on port ${options.port}` : '';
      console.log(`Starting Hibana development server${portInfo}...`);
      console.log('Implementation pending: invoke Wrangler dev with WASM rebuild hooks.');
    });
};
