import { Command } from 'commander';

import { createProject, ScaffoldError } from '../scaffold/create-project.js';

export const registerNewCommand = (program: Command): void => {
  program
    .command('new')
    .description('Generate a fresh Hibana project scaffold')
    .argument('<project-name>', 'Directory name for the new project')
    .option('--template <name>', 'Scaffold template to use', 'default')
    .action(async (projectName: string, options: { template: string }) => {
      try {
        const result = await createProject({
          projectName,
          templateName: options.template
        });

        console.log(`\nCreated ${result.metadata.projectName} using "${options.template}" template.`);
        console.log('Next steps:');
        console.log(`  cd ${result.metadata.projectName}`);
        console.log('  npm install');
        console.log('  bundle install');
        console.log('  npm run dev');
      } catch (error: unknown) {
        if (error instanceof ScaffoldError) {
          console.error(`Error: ${error.message}`);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
};
