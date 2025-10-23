import { createCommand } from 'commander';

import { registerDatabaseCommands } from './commands/database.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerDevCommand } from './commands/dev.js';
import { registerNewCommand } from './commands/new.js';

const program = createCommand();

program
  .name('hibana')
  .description('Scaffold and operate Hibana edge applications')
  .enablePositionalOptions()
  .showHelpAfterError();

registerNewCommand(program);
registerDevCommand(program);
registerDeployCommand(program);
registerDatabaseCommands(program);

program.parseAsync().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
