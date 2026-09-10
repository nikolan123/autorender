/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

import { join } from '@std/path';
import { GameConfig } from './config.ts';
import { UserAgent } from './constants.ts';

/**
 * Join paths with the game folder.
 */
export const gameFolder = (game: GameConfig, ...paths: string[]) => {
  return join(game.dir, ...paths);
};

/** Join paths inside 852_0's portal2 directory. */
export const realGameModFolder = (game: GameConfig, ...paths: string[]) => {
  return join(game.dir, 'portal2', ...paths);
};

/** Alias retained for call sites that mean the 852_0 portal2 directory. */
export const gameModFolder = (game: GameConfig, ...paths: string[]) => {
  return realGameModFolder(game, ...paths);
};

/**
 * Downloads a binary file.
 */
export const getBinary = async (
  url: string,
  options: {
    onStart?: () => void;
    onProgress?: (event: { loaded: number; total: number }) => void;
    onEnd?: () => void;
  },
) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UserAgent,
    },
  });

  let loaded = 0;
  const total = Number(res.headers.get('Content-Length') ?? res.headers.get('X-File-Size') ?? 0);

  const { onStart, onProgress, onEnd } = options;

  return await new Response(
    new ReadableStream({
      async start(controller) {
        onStart && onStart();

        const reader = res.body!.getReader();

        onProgress && onProgress({ loaded, total });

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            onEnd && onEnd();
            return;
          }

          if (onProgress) {
            loaded += value.byteLength;
            onProgress({ loaded, total });
          }

          controller.enqueue(value);
        }
      },
    }),
    {
      headers: res.headers,
      status: res.status,
      statusText: res.statusText,
    },
  ).blob();
};
