/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

import * as yaml from '@std/yaml';
import { join } from '@std/path';
import { colors } from '@cliffy/ansi/colors';
import { Input, prompt, Secret, Select } from '@cliffy/prompt';
import { AutorenderBaseApi, AutorenderConnectUri, UserAgent } from './constants.ts';
import { getOptions } from './cli.ts';
import { logger } from './logger.ts';
import { RenderQuality } from '~/shared/models.ts';

export const supportedQualities: RenderQuality[] = [
  RenderQuality.UHD_2160p,
  RenderQuality.QHD_1440p,
  RenderQuality.FHD_1080p,
  RenderQuality.HD_720p,
  RenderQuality.SD_480p,
];
export type GameMods = 'portal2';
export interface GameConfig {
  exe: 'hl2.wrap.exe';
  proc: 'hl2.exe';
  mod: 'portal2';
  dir: string;
}
export interface Config {
  autorender: {
    'access-token': string;
    'connect-uri': string;
    'base-api': string;
    'folder-name': string;
    protocol: string;
    'max-supported-quality': RenderQuality;
    'check-interval': number;
    'scale-timeout': number;
    'load-timeout': number;
    'base-timeout': number;
  };
  games: [GameConfig];
}
type ConfigDescription<T> = Record<Extract<keyof T, string> & `${Extract<keyof T, string>}*`, string>;
export const configExplanation: {
  autorender: ConfigDescription<Config['autorender']>;
  games: ConfigDescription<GameConfig>[];
} = {
  autorender: {
    'access-token': 'Copied access token from the website.',
    'connect-uri': 'Connection URI to the server.',
    'base-api': 'Base API URI to the website.',
    'folder-name': 'Folder inside portal2 used for demos and native Source captures.',
    protocol: 'Client/server protocol version.',
    'max-supported-quality*': `Maximum render quality. Options: ${supportedQualities.join(', ')}`,
    'check-interval*': 'Seconds between checks for work.',
    'scale-timeout*': 'Render timeout multiplier.',
    'load-timeout*': 'Seconds allowed for demo loading.',
    'base-timeout*': 'Seconds allowed for starting and exiting 852_0.',
  },
  games: [{
    exe: 'Must be hl2.wrap.exe.',
    proc: 'Must be hl2.exe.',
    mod: 'Must be portal2.',
    dir: 'Extracted 852_0 game folder containing hl2.wrap.exe and portal2.',
  }],
};

const configFile = join(Deno.env.get('PWD') ?? '', 'autorender.yaml');
let config: Config | null = null;
const bail = (message: string): never => {
  console.log(colors.red(`❌️ ${message}`));
  Deno.exit(1);
};

export const parseAndValidateConfig = async () => {
  const parsed = yaml.parse(await Deno.readTextFile(configFile)) as Partial<Config>;
  if (parsed.autorender?.['access-token'] === '$AUTORENDER_ACCESS_TOKEN') {
    parsed.autorender['access-token'] = Deno.env.get('AUTORENDER_ACCESS_TOKEN') ?? '';
  }
  if (!parsed.autorender || typeof parsed.autorender !== 'object') bail('Missing autorender settings.');
  if (!Array.isArray(parsed.games) || parsed.games.length !== 1) {
    bail('Exactly one Portal 2 beta 852_0 build must be configured.');
  }
  const autorender = parsed.autorender!;
  const games = parsed.games!;
  const game = games[0] as Partial<GameConfig>;
  if (game.exe !== 'hl2.wrap.exe' || game.proc !== 'hl2.exe' || game.mod !== 'portal2') {
    bail('The configured game must be Portal 2 beta 852_0.');
  }
  if (!game.dir || typeof game.dir !== 'string') bail('Missing the extracted 852_0 game directory.');
  for (const key of ['access-token', 'connect-uri', 'base-api', 'folder-name', 'protocol'] as const) {
    if (typeof autorender[key] !== 'string') bail(`Invalid autorender setting: ${key}.`);
  }
  for (const key of ['check-interval', 'scale-timeout', 'load-timeout', 'base-timeout'] as const) {
    if (typeof autorender[key] !== 'number') bail(`Invalid autorender setting: ${key}.`);
  }
  if (!supportedQualities.includes(autorender['max-supported-quality'] as RenderQuality)) {
    bail('Invalid maximum render quality.');
  }
  return parsed as Config;
};
export const getConfig = async () => {
  if (!config) {
    try {
      config = await parseAndValidateConfig();
    } catch {
      config = await createConfig();
    }
  }
  return config;
};
export const getConfigOnly = async () => {
  if (!config) {
    try {
      config = await parseAndValidateConfig();
    } catch {
      return null;
    }
  }
  return config;
};

const createConfig = async () => {
  if (Deno.build.os !== 'windows') bail('Portal 2 beta 852_0 rendering currently requires Windows.');
  const options = getOptions()!;
  const [connectUri, baseApi] = options.devMode
    ? [AutorenderConnectUri.dev, AutorenderBaseApi.dev]
    : [AutorenderConnectUri.prod, AutorenderBaseApi.prod];
  console.log(colors.bold.white('Portal 2 beta 852_0 Autorender setup'));
  console.log(colors.white(`Visit ${baseApi} to get your token.`));
  const setup = await prompt([
    {
      name: 'access_token',
      message: '🔑️ Enter or paste your access token:',
      type: Secret,
      after: async ({ access_token }, next) => {
        if (access_token) {
          const res = await fetch(`${baseApi}/tokens/test`, {
            method: 'POST',
            headers: { 'User-Agent': UserAgent },
            body: JSON.stringify({ token_key: access_token }),
          });
          if (res.ok) return await next();
          console.warn(colors.yellow(`Token was rejected: ${res.statusText}`));
        }
        await next('access_token');
      },
    },
    {
      name: 'supported_quality',
      message: '📺️ Maximum render quality:',
      type: Select,
      options: [
        { name: '1080p (default)', value: RenderQuality.FHD_1080p },
        { name: '480p', value: RenderQuality.SD_480p },
        { name: '720p', value: RenderQuality.HD_720p },
        { name: '1440p', value: RenderQuality.QHD_1440p },
        { name: '4K', value: RenderQuality.UHD_2160p },
      ],
    },
    {
      name: 'game_dir',
      message: '📂️ Extracted 852_0 game folder (the folder containing hl2.wrap.exe):',
      type: Input,
      after: async ({ game_dir }, next) => {
        if (game_dir) {
          try {
            const stat = await Deno.stat(game_dir);
            await Deno.stat(join(game_dir, 'hl2.wrap.exe'));
            await Deno.stat(join(game_dir, 'portal2', 'gameinfo.txt'));
            if (stat.isDirectory) return await next();
          } catch (err) {
            options.verboseMode && logger.error(err);
          }
        }
        console.log(colors.red('That is not a valid extracted 852_0 game folder.'));
        await next('game_dir');
      },
    },
  ]);
  const result: Config = {
    autorender: {
      'access-token': setup.access_token!,
      'connect-uri': connectUri,
      'base-api': baseApi,
      'folder-name': 'autorender',
      protocol: 'autorender-v1',
      'max-supported-quality': setup.supported_quality as RenderQuality,
      'check-interval': 1,
      'scale-timeout': 9,
      'load-timeout': 5,
      'base-timeout': 30,
    },
    games: [{ exe: 'hl2.wrap.exe', proc: 'hl2.exe', mod: 'portal2', dir: setup.game_dir! }],
  };
  await Deno.mkdir(join(result.games[0].dir, 'portal2', result.autorender['folder-name']), { recursive: true });
  // deno-lint-ignore no-explicit-any
  await Deno.writeTextFile(configFile, yaml.stringify(result as any));
  console.log(colors.green(`🛠️  Generated config file ${configFile}`));
  return result;
};
