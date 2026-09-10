/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

export const AutorenderVersion = '1.0.5';

export const ReleaseTag = `client-${AutorenderVersion}`;

export const AutorenderConnectUri = {
  dev: 'ws://127.0.0.1:8080/connect/client',
  prod: 'wss://autorender.portal2.sr/connect/client',
};

export const AutorenderBaseApi = {
  dev: 'http://127.0.0.1:8080',
  prod: 'https://autorender.portal2.sr',
};

export const UserAgent = `autorender-client/${AutorenderVersion}`;
