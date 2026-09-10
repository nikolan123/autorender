/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

import { Command } from '@cliffy/command';
import { getConfigOnly } from './config.ts';
import { AutorenderVersion } from './constants.ts';
import { launchGame, runCheck, runExplain } from './commands.ts';

export interface Options {
  devMode: boolean;
  verboseMode: boolean;
  canary?: boolean;
}

let options: Options | null = null;

export const getOptions = () => options;

// @deno-fmt-ignore
const cli = new Command()
  .name('autorender')
  .version(AutorenderVersion)
  .description('Portal 2 beta build 852_0 demo renderer and uploader.')
  .globalOption('-v, --verbose', 'Turn on verbose error logging.')
  .globalOption('-d, --dev', 'Switch into developer mode.', { hidden: true })
  .globalAction(({ verbose, dev }) => {
    options = {
      devMode: !!dev,
      verboseMode: !!verbose,
    };
  })
  .command('check')
    .description('Health check of the app.')
    .action(async () => await runCheck(options!))
  .command('launch')
    .description('Test whether the configured 852_0 build can be launched.')
    .action(async () => await launchGame(await getConfigOnly(), options!))
  .command('explain')
    .description('Explain all config values in autorender.yaml.')
    .action(() => runExplain());

export const parseArgs = async () => {
  return await cli.parse(Deno.args);
};
