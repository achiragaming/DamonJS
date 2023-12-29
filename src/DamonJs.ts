import { EventEmitter } from 'events';
import {
  CreatePlayerOptions,
  DamonJsEvents,
  Events,
  DamonJsError,
  DamonJsOptions as DamonJsOptionsOwO,
  DamonJsSearchOptions,
  DamonJsSearchResult,
  PlayerMovedChannels,
  PlayerMovedState,
  SearchResultTypes,
  SourceIDs,
  State,
  PlayerState,
} from './Modules/Interfaces';
import {
  Node,
  NodeOption,
  PlayerUpdate,
  Shoukaku,
  ShoukakuOptions,
  TrackExceptionEvent,
  TrackStuckEvent,
  WebSocketClosedEvent,
  Connector,
  LoadType,
} from 'shoukaku';

import { DamonJsPlayer } from './Managers/DamonJsPlayer';
import { DamonJsTrack } from './Managers/Supports/DamonJsTrack';
import { Snowflake } from 'discord.js';
import { exit } from 'process';

// Add other methods related to your base class

export class DamonJs extends EventEmitter {
  /** Shoukaku instance */
  public shoukaku: Shoukaku;
  /** DamonJs players */
  public readonly players: Map<string, DamonJsPlayer>;

  /**
   * Initialize a DamonJs instance.
   * @param DamonJsOptions DamonJsOptions
   * @param connector Connector
   * @param nodes NodeOption[]
   * @param options ShoukakuOptions
   */
  constructor(public DamonJsOptions: DamonJsOptionsOwO, shoukaku: Shoukaku) {
    super();

    this.shoukaku = shoukaku;

    if (this.DamonJsOptions.plugins) {
      for (const [, plugin] of this.DamonJsOptions.plugins.entries()) {
        if (plugin.constructor.name !== 'DamonJsPlugin')
          throw new DamonJsError(1, 'Plugin must be an instance of DamonJsPlugin');
        plugin.load(this);
      }
    }

    this.players = new Map<string, DamonJsPlayer>();
  }
  public on<K extends keyof DamonJsEvents>(event: K, listener: (...args: DamonJsEvents[K]) => void): this {
    super.on(event as string, (...args: any) => listener(...args));
    return this;
  }
  public once<K extends keyof DamonJsEvents>(event: K, listener: (...args: DamonJsEvents[K]) => void): this {
    super.once(event as string, (...args: any) => listener(...args));
    return this;
  }
  public off<K extends keyof DamonJsEvents>(event: K, listener: (...args: DamonJsEvents[K]) => void): this {
    super.off(event as string, (...args: any) => listener(...args));
    return this;
  }
  public emit<K extends keyof DamonJsEvents>(event: K, ...data: DamonJsEvents[K]): boolean {
    return super.emit(event as string, ...data);
  }
  /**
   * Create a player.
   * @param options CreatePlayerOptions
   * @returns Promise<DamonJsPlayer>
   */
  public async createPlayer<T extends DamonJsPlayer>(options: CreatePlayerOptions): Promise<T | DamonJsPlayer> {
    const exist = this.players.get(options.guildId);
    if (exist) return exist;
    if (!options.deaf) options.deaf = false;
    if (!options.mute) options.mute = false;
    const shoukakuPlayer = await this.shoukaku.joinVoiceChannel({
      guildId: options.guildId as string,
      channelId: options.voiceId as string,
      deaf: options.deaf,
      mute: options.mute,
      shardId: options.shardId && !isNaN(options.shardId) ? options.shardId : 0,
    });
    const shoukakuConnection = this.shoukaku.connections.get(options.guildId as string);
    if (!shoukakuConnection) throw new DamonJsError(1, 'Cannot find the shoukaku connection');
    const damonjsPlayer = new (this.DamonJsOptions.extends?.player ?? DamonJsPlayer)(
      this,
      this.shoukaku,
      shoukakuPlayer,
      shoukakuConnection,
      {
        data: options.data,
        textId: options.textId,
        volume: isNaN(Number(options.volume)) ? 100 : (options.volume as number),
      },
    );
    await damonjsPlayer.init();
    this.players.set(options.guildId, damonjsPlayer);
    this.emit(Events.PlayerCreate, damonjsPlayer);
    return damonjsPlayer;
  }

  /**
   * Get a player by guildId.
   * @param guildId Guild ID
   * @returns DamonJsPlayer | undefined
   */
  public getPlayer<T extends DamonJsPlayer>(guildId: Snowflake): (T | DamonJsPlayer) | undefined {
    return this.players.get(guildId);
  }

  /**
   * Destroy a player.
   * @param guildId Guild ID
   * @returns void
   */
  public destroyPlayer<T extends DamonJsPlayer>(guildId: Snowflake): void {
    const player = this.getPlayer<T>(guildId);
    if (!player) return;
    player.destroy();
  }

  /**
   * Search a track by query or uri.
   * @param player DamonJs Player
   * @param query Query
   * @param options DamonJsOptions
   * @returns Promise<DamonJsSearchResult>
   */
  public async search(
    player: DamonJsPlayer,
    query: string,
    options: DamonJsSearchOptions,
  ): Promise<DamonJsSearchResult> {
    if (player.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');

    const source = (SourceIDs as any)[
      (options?.engine && ['youtube', 'youtube_music', 'soundcloud'].includes(options.engine)
        ? options.engine
        : null) ||
        (!!this.DamonJsOptions.defaultSearchEngine &&
        ['youtube', 'youtube_music', 'soundcloud'].includes(this.DamonJsOptions.defaultSearchEngine!)
          ? this.DamonJsOptions.defaultSearchEngine
          : null) ||
        'youtube'
    ];

    const isUrl = /^https?:\/\/.*/.test(query);

    const result = await player.node.rest.resolve(!isUrl ? `${source}search:${query}` : query).catch((_) => null);

    if (result?.loadType === LoadType.TRACK) {
      return this.buildSearch(undefined, [new DamonJsTrack(result.data, options.requester)], SearchResultTypes.Track);
    } else if (result?.loadType === LoadType.PLAYLIST) {
      return this.buildSearch(
        result.data,
        result.data.tracks.map((track) => new DamonJsTrack(track, options.requester)),
        SearchResultTypes.Playlist,
      );
    } else if (result?.loadType === LoadType.SEARCH) {
      return this.buildSearch(
        undefined,
        result.data.map((track) => new DamonJsTrack(track, options.requester)),
        SearchResultTypes.Search,
      );
    } else if (result?.loadType === LoadType.EMPTY) {
      return this.buildSearch(undefined, [], SearchResultTypes.Empty);
    } else {
      return this.buildSearch(undefined, undefined, SearchResultTypes.Error);
    }
  }

  public buildSearch(
    playlistInfo?: {
      encoded: string;
      info: {
        name: string;
        selectedTrack: number;
      };
      pluginInfo: unknown;
    },
    tracks: DamonJsTrack[] = [],
    type?: SearchResultTypes,
  ): DamonJsSearchResult {
    return {
      playlistInfo,
      tracks,
      type: type ?? SearchResultTypes.Search,
    };
  }
}
