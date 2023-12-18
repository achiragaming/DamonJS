import { DamonJs } from '../DamonJs';
import { DamonJsPlayer } from '../Index';
import { DamonJsTrack } from '../Managers/Supports/DamonJsTrack';
import { PlayerUpdate, TrackExceptionEvent, TrackStuckEvent, Utils, WebSocketClosedEvent } from 'shoukaku';
import { Snowflake } from 'discord.js';
export interface DamonJsOptions {
  /** Default search engine if no engine was provided. Default to youtube */
  defaultSearchEngine: SearchEngines;
  /** DamonJs plugins */
  plugins?: DamonJsPlugin[];
  /** Source that will be forced to resolve when playing it */
  sourceForceResolve?: string[];
  /** The track resolver. Make sure you set <DamonJsTrack>.track for it to work. (I'm not responsible for any error during playback if you don't set it right) */
  trackResolver?: (this: DamonJsTrack, options?: ResolveOptions) => Promise<boolean>;
  /** The default youtube thumbnail's size */
  defaultYoutubeThumbnail?: YoutubeThumbnail;
  /** Extend some of the Structures */
  extends?: {
    player?: Utils.Constructor<DamonJsPlayer>;
  };
}

export type SearchEngines = 'youtube' | 'soundcloud' | 'youtube_music' | string;
export type YoutubeThumbnail = 'default' | 'hqdefault' | 'mqdefault' | 'sddefault' | 'maxresdefault';

export interface Payload {
  /** The OP code */
  op: number;
  d: {
    guild_id: string;
    channel_id: string | null;
    self_mute: boolean;
    self_deaf: boolean;
  };
}

export const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const SourceIDs = {
  youtube: 'yt',
  youtube_music: 'ytm',
  soundcloud: 'sc',
};

export interface DamonJsPlayerOptions {
  /** The player's text ID */
  textId: Snowflake;
  volume: number;
  data?: [string, any][];
}

export interface ResolveOptions {
  overwrite?: boolean;
  forceResolve?: boolean;
  player: DamonJsPlayer;
}

export interface CreatePlayerOptions {
  /** The player's guild ID */
  guildId: Snowflake;
  /** The player's voice ID */
  voiceId: Snowflake;
  /** The player's text ID */
  textId: Snowflake;
  /** Whether the bot should deafen */
  deaf?: boolean;
  /** Whether the bot should mute */
  mute?: boolean;
  /** The player's guild's shardId */
  shardId?: number;
  /** The player's volume */
  volume?: number;
  /** The player's data, usable when you extends it */
  data?: [string, any][];
}

export interface RawTrack {
  encoded: string;
  info: {
    identifier: string;
    isSeekable: boolean;
    author: string;
    length: number;
    isStream: boolean;
    position: number;
    title: string;
    uri?: string;
    artworkUrl?: string;
    thumbnail?: string;
    isrc?: string;
    sourceName: string;
  };
  pluginInfo: unknown;
}

export interface DamonJsEvents {
  playerDestroy: [player: DamonJsPlayer];
  playerCreate: [player: DamonJsPlayer];
  playerStart: [player: DamonJsPlayer, track: DamonJsTrack];
  playerEnd: [player: DamonJsPlayer, track?: DamonJsTrack | null];
  playerEmpty: [player: DamonJsPlayer];
  playerClosed: [player: DamonJsPlayer, data: WebSocketClosedEvent];
  playerUpdate: [player: DamonJsPlayer, data: PlayerUpdate];
  playerException: [player: DamonJsPlayer, data: TrackExceptionEvent];
  playerResumed: [player: DamonJsPlayer];
  playerStuck: [player: DamonJsPlayer, data: TrackStuckEvent];
  playerResolveError: [player: DamonJsPlayer, track: DamonJsTrack, message?: string];
  playerMoved: [player: DamonJsPlayer, state: PlayerMovedState, channels: PlayerMovedChannels];
  debug: [player: DamonJsPlayer, message: string];
}
export enum Events {
  PlayerDestroy = 'playerDestroy',
  PlayerCreate = 'playerCreate',
  PlayerStart = 'playerStart',
  PlayerEnd = 'playerEnd',
  PlayerEmpty = 'playerEmpty',
  PlayerClosed = 'playerClosed',
  PlayerUpdate = 'playerUpdate',
  PlayerException = 'playerException',
  PlayerError = 'playerError',
  PlayerResumed = 'playerResumed',
  PlayerStuck = 'playerStuck',
  PlayerResolveError = 'playerResolveError',
  PlayerMoved = 'playerMoved',
  Debug = 'debug',
}
export interface PlayerMovedChannels {
  oldChannelId?: string | null;
  newChannelId?: string | null;
}

export enum PlayerMovedState {
  Unknown = 'UNKNOWN',
  Joined = 'JOINED',
  Left = 'LEFT',
  Moved = 'MOVED',
}

export enum LoopState {
  Track = 'track',
  Queue = 'queue',
  None = 'none',
}

export interface DamonJsSearchOptions {
  requester: unknown;
  engine?: SearchEngines;
}

export interface DamonJsSearchResult {
  type: SearchResultTypes;
  playlistInfo?: {
    encoded: string;
    info: {
      name: string;
      selectedTrack: number;
    };
    pluginInfo: unknown;
  };
  tracks: DamonJsTrack[];
}

export enum SearchResultTypes {
  Playlist = 'PLAYLIST',
  Track = 'TRACK',
  Search = 'SEARCH',
  Empty = 'EMPTY',
  Error = 'Error',
}

export const SupportedSources = [
  'bandcamp',
  'beam',
  'getyarn',
  'http',
  'local',
  'nico',
  'soundcloud',
  'stream',
  'twitch',
  'vimeo',
  'youtube',
];

export interface PlayOptions {
  noReplace?: boolean;
  pause?: boolean;
  startTime?: number;
  endTime?: number;
  replaceCurrent?: boolean;
}

export enum State {
  CONNECTING,
  CONNECTED,
  DISCONNECTING,
  DISCONNECTED,
}

export enum PlayerState {
  CONNECTING,
  CONNECTED,
  DISCONNECTING,
  DISCONNECTED,
  DESTROYING,
  DESTROYED,
}

export class DamonJsPlugin {
  public load(damonjs: DamonJs): void {
    throw new DamonJsError(1, 'Plugin must implement load()');
  }

  public unload(damonjs: DamonJs): void {
    throw new DamonJsError(1, 'Plugin must implement unload()');
  }
}

/* tslint:disable:max-classes-per-file */
export class DamonJsError extends Error {
  public code: number;
  public message: string;
  public constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.message = message;
  }
}
