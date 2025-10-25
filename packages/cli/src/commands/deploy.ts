import { Command } from 'commander';

import { runDeploy } from '../runtime/deploy.js';

export const registerDeployCommand = (program: Command): void => {
  const deploy = program.command('deploy').description('Build and deploy the project to Cloudflare Workers');

  deploy
    .option('--dry-run', 'Show the deployment plan without executing it', false)
    .option('--skip-ruby-build', 'Skip running bundle exec rake wasm:build before deploy', false)
    .option('--skip-assets-build', 'Skip running npm run build before deploy', false)
    .allowExcessArguments(true)
    .passThroughOptions()
    .action(
      async (
        options: { dryRun?: boolean; skipRubyBuild?: boolean; skipAssetsBuild?: boolean },
        command: Command
      ) => {
        try {
          const wranglerArgs = command.args ?? [];
          await runDeploy({
            dryRun: options.dryRun,
            skipRubyBuild: options.skipRubyBuild,
            skipAssetsBuild: options.skipAssetsBuild,
            wranglerArgs,
            projectRoot: command.parent?.getOptionValue('cwd') ?? process.cwd()
          });
        } catch (error: unknown) {
          console.error('Deployment failed.');
          if (error instanceof Error) {
            console.error(error.message);
          } else {
            console.error(error);
          }
          process.exitCode = 1;
        }
      }
    );
};
