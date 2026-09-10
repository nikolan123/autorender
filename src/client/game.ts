/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

import { dirname, join } from '@std/path';
import { Config, GameConfig } from './config.ts';
import { logger } from './logger.ts';
import { colors } from '@cliffy/ansi/colors';
import { gameFolder, realGameModFolder } from './utils.ts';
import { VideoPayload } from './protocol.ts';
import { RenderQuality } from '~/shared/models.ts';

/**
 * Request access to the game's subdirectory and create all folders for rendering.
 */
export const createFolders = async (config: Config | null) => {
  if (!config) {
    logger.error(colors.red(`❌️ Failed to find autorender.yaml config file`));
    Deno.exit(1);
  }

  for (const game of config.games) {
    const commonDir = dirname(game.dir);

    const gameDirReadAccess = await Deno.permissions.query({ name: 'read', path: game.dir });
    const gameDirWiteAccess = await Deno.permissions.query({ name: 'write', path: game.dir });

    if (gameDirReadAccess.state !== 'granted' || gameDirWiteAccess.state !== 'granted') {
      const { state: readAccess } = await Deno.permissions.request({
        name: 'read',
        path: commonDir,
      });

      if (readAccess !== 'granted') {
        logger.error(`Unable to get read access for path ${commonDir}`);
        Deno.exit(1);
      }

      const { state: writeAccess } = await Deno.permissions.request({
        name: 'write',
        path: commonDir,
      });

      if (writeAccess !== 'granted') {
        logger.error(`Unable to get write access for path ${commonDir}`);
        Deno.exit(1);
      }
    }

    try {
      const autorenderDir = realGameModFolder(game, config.autorender['folder-name']);
      await Deno.mkdir(autorenderDir);
      logger.info(`Created autorender directory ${autorenderDir}`);
      // deno-lint-ignore no-empty
    } catch {}
  }
};

/**
 * Get window width and height.
 * NOTE: This will also be used for the custom crosshair.
 */
const getGameResolution = (renderQuality: VideoPayload['render_quality']): [number, number] => {
  switch (renderQuality) {
    case RenderQuality.SD_480p:
      return [768, 480];
    case RenderQuality.HD_720p:
      return [1280, 720];
    case RenderQuality.FHD_1080p:
      return [1920, 1080];
    case RenderQuality.QHD_1440p:
      return [2560, 1440];
    case RenderQuality.UHD_2160p:
      return [3840, 2160];
    default:
      return [1280, 720];
  }
};

/**
 * Prepares autoexec.cfg to queue all demos.
 */
export const prepareGameLaunch = async (
  options: {
    config: Config;
    game: GameConfig;
    videos?: VideoPayload[];
    noAutoexec?: boolean;
  },
): Promise<[string, Deno.Command]> => {
  const { config, game, videos } = options;

  const getDemoName = (filename: string) => {
    return join(config.autorender['folder-name'], filename);
  };

  const firstVideo = videos?.at(0);

  // Quality for each video here should be the same which is handled server-side.
  const [width, height] = getGameResolution(firstVideo?.render_quality ?? RenderQuality.SD_480p);

  let autoexecFile = '';

  if (!options.noAutoexec) {
    const renderOptions = firstVideo?.render_options?.split('\n')?.join(';') ?? '';
    const demoFile = firstVideo?.video_id;

    const autoexec = [
      'fps_max 60',
      'engine_no_focus_sleep 0',
      'host_framerate 60',
      'demo_quitafterplayback 1',
      renderOptions,
      ...(demoFile ? [`startmovie ${getDemoName(demoFile)} tga wav`, `playdemo ${getDemoName(demoFile)}`] : []),
    ].filter(Boolean);

    autoexecFile = realGameModFolder(game, 'cfg', 'autoexec.cfg');

    await Deno.writeTextFile(autoexecFile, autoexec.join('\n'));
  }

  const getCommand = (): [string, string] => {
    const command = gameFolder(game, game.exe);

    switch (Deno.build.os) {
      case 'windows':
        return [command, game.exe];
      case 'linux':
        return ['/bin/bash', command];
      default:
        throw new Error('Unsupported operating system');
    }
  };

  const [command, argv0] = getCommand();

  const args: string[] = [
    argv0,
    '-game',
    'portal2',
    '-novid',
    // TODO: vulkan is not always available
    //"-vulkan",
    '-windowed',
    '-w',
    width.toString(),
    '-h',
    height.toString(),
  ];

  logger.info(JSON.stringify({ command, args }));

  return [autoexecFile, new Deno.Command(command, { args })];
};

/** Convert build 852_0's native TGA/WAV capture into mp4 */
export const encodeSourceCapture = async (config: Config, game: GameConfig, video: VideoPayload) => {
  const renderDir = realGameModFolder(game, config.autorender['folder-name']);
  const framePattern = join(renderDir, `${video.video_id}%04d.tga`);
  const audioFile = join(renderDir, `${video.video_id}.wav`);
  const videoFile = join(renderDir, `${video.video_id}.mp4`);

  const args = [
    '-y',
    '-framerate',
    '60',
    '-i',
    framePattern,
    '-i',
    audioFile,
    '-c:v',
    'h264_qsv',
    '-global_quality',
    '18',
    '-pix_fmt',
    'nv12',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    videoFile,
  ];

  logger.info('Encoding native Source capture', { framePattern, audioFile, videoFile });

  const output = await new Deno.Command('ffmpeg', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();

  if (!output.success) {
    throw new Error(`FFmpeg failed: ${new TextDecoder().decode(output.stderr)}`);
  }

  for await (const entry of Deno.readDir(renderDir)) {
    if (
      entry.isFile &&
      ((entry.name.startsWith(video.video_id) && entry.name.endsWith('.tga')) ||
        entry.name === `${video.video_id}.wav`)
    ) {
      await Deno.remove(join(renderDir, entry.name));
    }
  }

  logger.info('Encoded native Source capture', videoFile);
};

export class GameProcess {
  process: Deno.ChildProcess | null = null;
  processName = '';
  timeout: ReturnType<typeof setTimeout> | null = null;
  autoexecFile = '';
  killed = false;

  constructor() {
    Deno.addSignalListener('SIGINT', () => {
      if (this.process) {
        try {
          logger.info('Handling termination...');
          this.killGameProcess();
          logger.info('Termination handled');
        } catch (err) {
          logger.error(err);
        } finally {
          this.process = null;
        }
      }

      Deno.exit();
    });
  }

  /**
   * Spawns a new game process.
   */
  async launch(
    options: {
      config: Config;
      game: GameConfig;
      videos?: VideoPayload[];
      timeoutInSeconds?: number;
      noTimeout?: boolean;
      noAutoexec?: boolean;
    },
  ) {
    const { config, game, videos } = options;

    const [autoexecFilePath, command] = await prepareGameLaunch({
      config,
      game,
      videos,
      noAutoexec: options.noAutoexec,
    });

    this.autoexecFile = autoexecFilePath;

    logger.info('Spawning process...');

    this.killed = false;
    this.process = command.spawn();
    this.processName = game.proc;

    // The 852_0 engine throttles heavily while unfocused. The render client is
    // started by a hidden scheduled task, so explicitly focus the real hl2
    // window once the wrapper has spawned it.
    new Deno.Command('powershell.exe', {
      args: [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(import.meta.dirname!, 'focus-game.ps1'),
      ],
      stdout: 'null',
      stderr: 'null',
    }).spawn();

    logger.info(`Spawned process ${this.process.pid}`);

    if (!options.noTimeout) {
      const processTimeout = options.timeoutInSeconds ?? videos?.reduce(
        (total, video) => {
          return total + (video.demo_playback_time * config.autorender['scale-timeout']) +
            config.autorender['load-timeout'];
        },
        config.autorender['base-timeout'],
      ) ?? config.autorender['base-timeout'];

      logger.info(`Process timeout in ${processTimeout.toFixed(2)} seconds`);

      this.timeout = setTimeout(() => {
        if (this.process) {
          try {
            logger.warn('Timeout of process');
            this.killGameProcess();
            logger.warn('Killed process');
          } catch (err) {
            logger.error(err);
          } finally {
            this.process = null;
          }
        }
      }, processTimeout * 1_000);
    }

    const { code } = await this.process.output();

    this.clearTimeout();
    this.process = null;

    logger.info('Game exited', { code });

    return {
      killed: this.killed,
      code,
    };
  }

  /**
   * Removes the temporary autoexec file.
   */
  async removeAutoexec() {
    if (this.autoexecFile) {
      try {
        await Deno.remove(this.autoexecFile);
      } catch (err) {
        logger.error(`Failed to remove temporary autoexec ${this.autoexecFile}`, err);
      }
    }
  }

  /**
   * Kills the game process.
   */
  killGameProcess() {
    if (!this.process) {
      return;
    }

    // Negative PID in Unix means killing the entire process group.
    const pid = Deno.build.os === 'windows' ? this.process.pid : -this.process.pid;

    logger.info(`Killing process ${pid}`);

    //Deno.kill(pid, "SIGKILL");

    // Deno.kill does not work for some reason :>
    if (Deno.build.os !== 'windows') {
      const kill = new Deno.Command('pkill', { args: [this.processName] });
      const { code } = kill.outputSync();
      logger.info(`pkill ${this.processName}`, { code });
    } else {
      Deno.kill(pid, 'SIGKILL');
    }

    this.killed = true;
    logger.info('killed');
  }

  /**
   * Safely tries to kill game process
   */
  tryKillGameProcess() {
    try {
      this.killGameProcess();
    } catch (err) {
      logger.error(err);
    } finally {
      this.process = null;
    }
  }

  /**
   * Clears process timeout.
   */
  clearTimeout() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
