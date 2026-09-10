/* Copyright (c) 2023-2025, NeKz - SPDX-License-Identifier: MIT */
import { colors } from '@cliffy/ansi/colors';
import { Cell, Table } from '@cliffy/table';
import { Options } from './cli.ts';
import { Config, configExplanation, parseAndValidateConfig } from './config.ts';
import { GameProcess } from './game.ts';
import { realGameModFolder } from './utils.ts';

export const runCheck = async (options: Options) => {
  try {
    const config = await parseAndValidateConfig();
    const game = config.games[0];
    for (
      const file of [
        game.dir,
        `${game.dir}\\hl2.wrap.exe`,
        `${game.dir}\\portal2\\gameinfo.txt`,
        realGameModFolder(game, config.autorender['folder-name']),
      ]
    ) {
      await Deno.stat(file);
      console.log(colors.green(`Found ${file}`));
    }
    const ffmpeg = await new Deno.Command('ffmpeg', { args: ['-version'], stdout: 'null', stderr: 'null' }).output();
    if (!ffmpeg.success) throw new Error('FFmpeg could not be started.');
    console.log(colors.green('Portal 2 beta 852_0 renderer passed all checks.'));
    Deno.exit(0);
  } catch (err) {
    options.verboseMode && console.error(err);
    console.log(colors.red('852_0 renderer check failed.'));
    Deno.exit(1);
  }
};

export const runExplain = () => {
  const entries = Object.entries(configExplanation);
  const explanation = new Table(
    ...entries.map(([key, value]) => {
      const descriptions = Object.entries(Array.isArray(value) ? value[0] : value);
      const first = descriptions[0]!;
      return [
        [new Cell(key).rowSpan(descriptions.length), new Cell(first[0]), new Cell(String(first[1]))],
        ...descriptions.slice(1).map(([name, description]) => [new Cell(name), new Cell(String(description))]),
      ];
    }).flat(),
  );
  explanation.border().render();
  Deno.exit(0);
};

export const launchGame = async (config: Config | null, options: Options) => {
  if (!config) {
    console.log(colors.red('❌️ autorender.yaml is missing or invalid.'));
    Deno.exit(1);
  }
  const gameProcess = new GameProcess();
  try {
    await gameProcess.launch({ config, game: config.games[0], noTimeout: true, noAutoexec: true });
  } catch (err) {
    options.verboseMode && console.error(err);
    gameProcess.tryKillGameProcess();
    Deno.exit(1);
  }
  Deno.exit(0);
};
