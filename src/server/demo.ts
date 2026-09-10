/*
 * Copyright (c) 2023-2025, NeKz
 *
 * SPDX-License-Identifier: MIT
 */

import {
  DemoMessages,
  Messages,
  NetMessages,
  ScoreboardTempUpdate,
  SourceDemo,
  SourceDemoBuffer,
  SourceDemoParser,
  StringTables,
} from '@nekz/sdp';
import { logger } from './logger.ts';
import { getPlayerSteamData, isSarMessage, readSarMessages, SarDataType, SteamIdResult } from '@nekz/sdp/utils';

const AUTORENDER_MIN_PLAYBACK_TIME = 1;
const AUTORENDER_MAX_PLAYBACK_TIME = 6 * 60;

export enum GameMod {
  Portal2 = 'portal2',
}

export interface SupportedGame {
  name: string;
  tickrate: number;
}

// NOTE: Make sure that these are inserted into the "games" table.
export const supportedGameMods: { [gameDir: string]: SupportedGame } = {
  [GameMod.Portal2]: {
    name: 'Portal 2 Beta (852_0)',
    tickrate: 60,
  },
};

export const supportedGameDirs = Object.keys(supportedGameMods);

const parser = SourceDemoParser.default();

// 852_0 uses demo protocol 4, but packet messages contain four CmdInfo blocks.
// Retail Portal 2 contains two, which is what sdp expects. Skip the two additional
// beta-only blocks before letting sdp read the usual pair and the rest of the packet.
const readPortal2Beta8520Messages = (demo: SourceDemo, buf: SourceDemoBuffer) => {
  if (!demo.messages) {
    demo.messages = [];
  }

  while (buf.bitsLeft > 8) {
    const type = buf.readInt8();
    const Message = DemoMessages.NewEngine[type];

    if (!Message) {
      throw new Error(`Unknown Portal 2 beta demo message type: ${type}`);
    }

    const message = Message.default(type)
      .setTick(buf.readInt32())
      .setSlot(buf.readInt8());

    demo.messages.push(message);

    if (message instanceof DemoMessages.Packet) {
      buf.readBitStream(2 * 76 * 8);
    }

    message.read(buf, demo);

    if (message instanceof DemoMessages.Stop) {
      break;
    }
  }

  return demo;
};

interface WorkshopInfo {
  fileUrl: string | null;
  title: string | null;
  publishedFileId: string | null;
  creator: string | null;
  isSinglePlayer: boolean | null;
}

interface DemoInfo {
  size: number;
  mapName: string | undefined;
  fullMapName: string | undefined;
  mapCrc: number;
  isWorkshopMap: boolean;
  workshopInfo: WorkshopInfo | null;
  gameDir: GameMod;
  playbackTime: number | undefined;
  useFixedDemo: boolean;
  disableRenderSkipCoopVideos: boolean;
  tickrate: number;
  metadata: DemoMetadata;
  portalScore: null;
  timeScore: null;
  playerName: null;
  steamId: null;
  partnerPlayerName: null;
  partnerSteamId: null;
  isHost: number;
}

export const getDemoInfo = async (
  filePath: string,
  _options?: { isBoardDemo?: boolean },
): Promise<DemoInfo | string | null> => {
  const buffer = await Deno.readFile(filePath);

  try {
    const buf = parser.prepare(buffer.buffer);
    const demo = SourceDemo.default();

    try {
      demo.readHeader(buf);
    } catch (err) {
      logger.error('readHeader', filePath, err);
      return 'Corrupted demo.';
    }

    if (demo.gameDirectory !== GameMod.Portal2 || demo.demoProtocol !== 4 || demo.networkProtocol !== 37) {
      return 'Only Portal 2 beta build 852_0 demos are supported.';
    }

    try {
      readPortal2Beta8520Messages(demo, buf);
    } catch (err) {
      logger.error('readMessages', filePath, err);
    }

    // 852_0 predates retail Portal 2's inner network-message table. Everything
    // required for rendering is in the demo header and outer message stream.
    try {
      demo.adjustTicks().adjustRange(0, 0, 60);
    } catch (err) {
      logger.error('adjustTicks + adjustRange', filePath, err);
    }

    const playbackTime = demo.playbackTime ?? 0;

    if (playbackTime < AUTORENDER_MIN_PLAYBACK_TIME) {
      return 'Demo is too short.';
    }

    if (playbackTime > AUTORENDER_MAX_PLAYBACK_TIME) {
      return 'Demo is too long.';
    }

    return {
      size: buffer.byteLength,
      mapName: demo.mapName,
      fullMapName: demo.mapName,
      mapCrc: 0,
      isWorkshopMap: false,
      workshopInfo: null,
      gameDir: GameMod.Portal2,
      playbackTime: demo.playbackTime,
      useFixedDemo: false,
      disableRenderSkipCoopVideos: false,
      tickrate: demo.getTickrate(),
      metadata: getSarData(demo),
      portalScore: null,
      timeScore: null,
      playerName: null,
      steamId: null,
      partnerPlayerName: null,
      partnerSteamId: null,
      isHost: demo.serverName?.startsWith('localhost') ? 1 : 0,
    };
  } catch (err) {
    logger.error(filePath, err);
    return null;
  }
};

export interface SarDataSplit {
  name: string;
  ticks: number;
}

export interface SarDataSegment {
  name: string;
  ticks: number;
  splits: SarDataSplit[];
}

export interface SarDataTimestamp {
  year: number;
  mon: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
}

export interface DemoMetadata {
  segments: SarDataSegment[] | null;
  timestamp: SarDataTimestamp | null;
}

// Get speedrun + timestamp data from SAR.
const getSarData = (demo: SourceDemo): DemoMetadata => {
  try {
    const messages = readSarMessages(demo);
    const speedrun = messages.find(isSarMessage(SarDataType.SpeedrunTime));

    const segments: SarDataSegment[] = [];

    for (const split of speedrun?.splits ?? []) {
      const splits: SarDataSplit[] = [];
      let ticks = 0;

      for (const seg of split.segs ?? []) {
        splits.push({ name: seg.name, ticks: seg.ticks });
        ticks += seg.ticks;
      }

      segments.push({
        name: split.name,
        ticks,
        splits,
      });
    }

    const timestamp = messages.find(isSarMessage(SarDataType.Timestamp));

    return {
      segments,
      timestamp: timestamp
        ? {
          year: timestamp.year,
          mon: timestamp.mon,
          day: timestamp.day,
          hour: timestamp.hour,
          min: timestamp.min,
          sec: timestamp.sec,
        }
        : null,
    };
  } catch (err) {
    logger.error(err);
  }

  return {
    segments: null,
    timestamp: null,
  };
};

export interface ChallengeModeData {
  portalScore: number | null;
  timeScore: number | null;
}

// Get portal + time scores.
const getChallengeModeData = (demo: SourceDemo): ChallengeModeData => {
  try {
    const scoreboard = demo.findPacket<NetMessages.SvcUserMessage>((message) => {
      return message instanceof NetMessages.SvcUserMessage &&
        message.userMessage instanceof ScoreboardTempUpdate;
    });

    if (scoreboard) {
      const { portalScore, timeScore } = scoreboard.userMessage?.as<ScoreboardTempUpdate>() ?? {};

      return {
        portalScore: portalScore ?? null,
        timeScore: timeScore ?? null,
      };
    }
  } catch (err) {
    logger.error(err);
  }

  return {
    portalScore: null,
    timeScore: null,
  };
};

export interface PlayerInfoData {
  playerName: string | null;
  steamId: string | null;
  partnerPlayerName: string | null;
  partnerSteamId: string | null;
  isHost: number | null;
}

// Extract Steam name and ID64 from string table entry.
const extractSteamData = (
  playerInfo?: StringTables.StringTableEntry,
): [playerName: string | null, steamId: string | null] => {
  if (!playerInfo) {
    return [null, null];
  }

  const guid = playerInfo.data?.guid;
  if (guid === undefined || guid === 'STEAM_1:0:1' || guid === 'STEAM_1:1:1') {
    logger.error(`Found invalid player info guid "${guid}"`);
    return [null, null];
  }

  const [result, status] = getPlayerSteamData(playerInfo);

  switch (status) {
    case SteamIdResult.Ok: {
      return [result.playerName, result.steamId];
    }
    case SteamIdResult.NoPlayerInfoGuid: {
      logger.error(`No player player info guid found`);
      return [null, null];
    }
    case SteamIdResult.InvalidSteamId: {
      logger.error(`Found invalid SteamID: ${result}`);
      return [playerInfo.data?.name ?? null, null];
    }
    default: {
      return [null, null];
    }
  }
};

// Get player names and IDs.
export const getPlayerInfo = (demo: SourceDemo): PlayerInfoData => {
  try {
    const message = demo.findMessage(Messages.StringTable);
    const isHost = demo.serverName!.startsWith('localhost');

    for (const stringTable of message?.stringTables ?? []) {
      const entries = stringTable.entries ?? [];
      const playerInfos = entries.filter((entry) => entry.data instanceof StringTables.PlayerInfo);

      if (!playerInfos.length) {
        continue;
      }

      const host = playerInfos.at(isHost ? 0 : 1);
      const partner = playerInfos.at(isHost ? 1 : 0);

      const [playerName, steamId] = extractSteamData(host);
      const [partnerPlayerName, partnerSteamId] = extractSteamData(partner);

      return {
        playerName,
        steamId,
        partnerPlayerName,
        partnerSteamId,
        isHost: isHost ? 1 : 0,
      };
    }
  } catch (err) {
    logger.error(err);
  }

  return {
    playerName: null,
    steamId: null,
    partnerPlayerName: null,
    partnerSteamId: null,
    isHost: null,
  };
};

export const getInputDataFromFile = async (filePath: string): Promise<Uint32Array | null> => {
  try {
    const buffer = await Deno.readFile(filePath);
    const buf = parser.prepare(buffer.buffer);
    const demo = SourceDemo.default();

    demo.readHeader(buf);

    if (demo.gameDirectory !== GameMod.Portal2 || demo.demoProtocol !== 4 || demo.networkProtocol !== 37) {
      return null;
    }

    readPortal2Beta8520Messages(demo, buf);
    demo.adjustTicks().adjustRange(0, 0, 60);

    return getInputData(demo);
  } catch (err) {
    logger.error('Failed to parse demo inputs', filePath, err);
    return null;
  }
};

export const getInputData = (demo: SourceDemo): Uint32Array | null => {
  try {
    // The 852_0 outer message stream was parsed with its custom four-CmdInfo
    // packet layout. Only decode the usercmd payloads here; retail game
    // detection would interpret the beta packet layout incorrectly.
    demo.readUserCmds();

    const msgs = demo.findMessages<Messages.UserCmd>((msg) => {
      return msg instanceof DemoMessages.UserCmd &&
        msg.slot === 0 &&
        !!msg.userCmd?.buttons &&
        !!msg.tick;
    });

    // Tick  = bit  0..19 = 20 bits (more than enough for demo length)
    // Input = bit 20..31 = 12 bits (9 input types at the moment)
    const tickMask = 0b0000_0000_0000_1111_1111_1111_1111_1111;
    const buttonsOffset = 20;

    const inputs = new Uint32Array(msgs.length + 2);

    inputs[0] = 1; // Version

    let idx = 1;

    for (const { tick, userCmd } of msgs) {
      const buttons = userCmd!.buttons!;
      inputs[idx++] = (tick! & tickMask) |
        ((buttons & 0b0000_0000_0001) << buttonsOffset) | // attack
        ((buttons & 0b0000_0000_0010) << buttonsOffset) | // jump
        ((buttons & 0b0000_0000_0100) << buttonsOffset) | // duck
        ((buttons & 0b0000_0000_1000) << buttonsOffset) | // forward
        ((buttons & 0b0000_0001_0000) << buttonsOffset) | // back
        ((buttons & 0b0000_0010_0000) << buttonsOffset) | // use
        ((buttons & 0b0010_0000_0000) << buttonsOffset) | // moveleft
        ((buttons & 0b0100_0000_0000) << buttonsOffset) | // moveright
        ((buttons & 0b1000_0000_0000) << buttonsOffset); // attack2
    }

    // Write last tick for syncing
    inputs[idx] = demo.playbackTicks! & tickMask;

    return inputs;
  } catch (err) {
    logger.error(err);
  }

  return null;
};

// Imported from: https://github.com/NeKzor/sdp/blob/main/examples/tools/repair.ts
export const repairDemo = (buffer: ArrayBuffer): Uint8Array => {
  const parser = SourceDemoParser.default()
    .setOptions({ packets: true, dataTables: true });

  const demo = SourceDemo.default();

  try {
    const buf = parser.prepare(buffer);
    demo.readHeader(buf)
      .readMessages(buf);
  } catch (err) {
    console.error(err);
  }
  try {
    demo.readDataTables();
  } catch (err) {
    console.error(err);
  }
  try {
    demo.readPackets();
  } catch (err) {
    console.error(err);
  }

  const tryFixup = () => {
    const dt = demo.findMessage(Messages.DataTable)?.dataTable;
    if (!dt) {
      return;
    }

    const mapsWhichUsePointSurvey = [
      'sp_a2_bts2',
      'sp_a2_bts3',
      'sp_a3_portal_intro',
      'sp_a2_core',
      'sp_a2_bts4',
    ];

    const pointCameraClasses = dt.serverClasses.filter((table) => table.className === 'CPointCamera');
    if (pointCameraClasses.length === 2) {
      return;
    }

    const pointSurvey = dt.tables.findIndex((table) => table.netTableName === 'DT_PointSurvey');
    if (pointSurvey === -1) {
      return;
    }

    if (mapsWhichUsePointSurvey.includes(demo.mapName!)) {
      return;
    }

    dt.tables.splice(pointSurvey, 1);

    const svc = dt.serverClasses.find((table) => table.dataTableName === 'DT_PointSurvey');
    if (!svc) {
      return;
    }

    svc.className = 'CPointCamera';
    svc.dataTableName = 'DT_PointCamera';
  };

  tryFixup();

  let paused = false;
  let coop = false;
  let coopCmEndTick = -1;
  let didPopulateCustomCallbackMap = false;

  const didCoopChallengeModeFinish = (message: Messages.Message) => {
    // Start dropping messages on the next tick
    const drop = coopCmEndTick !== -1 && message.tick! > coopCmEndTick;
    return drop;
  };

  demo.messages = demo.messages!.filter((message) => {
    if (message instanceof Messages.Packet) {
      if (didCoopChallengeModeFinish(message)) {
        return false;
      }

      let pausePacketCount = 0;

      for (const packet of message.packets!) {
        if (packet instanceof NetMessages.SvcServerInfo) {
          coop = (packet.maxClients ?? 0) !== 0;
        } else if (packet instanceof NetMessages.SvcSetPause) {
          paused = packet.paused!;
          pausePacketCount += 1;
        } else if (
          coop &&
          packet instanceof NetMessages.SvcUserMessage &&
          packet.userMessage instanceof ScoreboardTempUpdate
        ) {
          coopCmEndTick = message.tick! + 60; // Add 1s delay
        }
      }

      // Drop the whole message during a pause but only if there aren't any other packets.
      const dropMessage = paused && (!pausePacketCount || message.packets!.length <= pausePacketCount);
      return !dropMessage;
    }

    if (
      message instanceof Messages.UserCmd ||
      message instanceof Messages.CustomData
    ) {
      if (!didPopulateCustomCallbackMap && message instanceof Messages.CustomData) {
        didPopulateCustomCallbackMap = message.unk === -1;

        if (!didPopulateCustomCallbackMap) {
          return false;
        }
      }

      if (didCoopChallengeModeFinish(message)) {
        return false;
      }

      return !paused;
    }

    if (message instanceof Messages.ConsoleCmd) {
      if (didCoopChallengeModeFinish(message)) {
        return false;
      }
    }

    return true;
  });

  const lastMessage = demo.messages!.at(-1);
  if (lastMessage && !(lastMessage instanceof Messages.Stop)) {
    demo.detectGame()
      .adjustTicks()
      .adjustRange();

    const stopMessage = new Messages.Stop(0x07)
      .setTick(lastMessage.tick!)
      .setSlot(lastMessage.slot!);

    stopMessage.restData = new SourceDemoBuffer(new ArrayBuffer(0));

    demo.messages![demo.messages!.length - 1] = stopMessage;
  }

  return parser
    .setOptions({ packets: false })
    .save(demo, buffer.byteLength);
};
