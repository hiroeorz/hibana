import { Command } from 'commander';

export const registerDatabaseCommands = (program: Command): void => {
  program
    .command('db:schema:pull')
    .description('Sync the schema manifest from the configured D1 database')
    .action(async () => {
      console.log('Pulling D1 schema into schema.manifest.json...');
      console.log('Implementation pending: call Wrangler D1 inspect and write manifest.');
    });

  program
    .command('db:migrate')
    .description('Apply SQL migrations in db/migrations to the D1 database')
    .option('--dry-run', 'Validate migrations without applying them', false)
    .action(async (options: { dryRun?: boolean }) => {
      if (options.dryRun) {
        console.log('Running migration dry-run against D1...');
      } else {
        console.log('Applying migrations to D1...');
      }
      console.log('Implementation pending: execute Wrangler D1 migrations apply.');
    });
};
