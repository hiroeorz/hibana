import { Command } from 'commander';

import { runDeploy } from '../runtime/deploy.js';

export const registerDeployCommand = (program: Command): void => {
  program
    .command('deploy')
    .description('Build and deploy the project to Cloudflare Workers')
    .option('--dry-run', 'Show the deployment plan without executing it', false)
    .action(async (options: { dryRun?: boolean }) => {
      try {
        await runDeploy({ dryRun: options.dryRun });
      } catch (error: unknown) {
        console.error('Deployment failed.');
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error(error);
        }
        process.exitCode = 1;
      }
    });
};
