import { EventEmitter } from 'events';
import {
  CreatePlayerOptions,
  KazagumoEvents,
  Events,
  KazagumoError,
  KazagumoOptions as KazagumoOptionsOwO,
  KazagumoSearchOptions,
  KazagumoSearchResult,
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

import { KazagumoPlayer } from './Managers/KazagumoPlayer';
import { KazagumoTrack } from './Managers/Supports/KazagumoTrack';
import { Snowflake } from 'discord.js';

// Add other methods related to your base class

export class Kazagumo extends EventEmitter {
  /** Shoukaku instance */
  public shoukaku: Shoukaku;
  /** Kazagumo players */
  public readonly players: Map<string, KazagumoPlayer>;

  /**
   * Initialize a Kazagumo instance.
   * @param KazagumoOptions KazagumoOptions
   * @param connector Connector
   * @param nodes NodeOption[]
   * @param options ShoukakuOptions
   */
  constructor(
    public KazagumoOptions: KazagumoOptionsOwO,
    connector: Connector,
    nodes: NodeOption[],
    options: ShoukakuOptions = {},
  ) {
    super();

    this.shoukaku = new Shoukaku(connector, nodes, options);

    if (this.KazagumoOptions.plugins) {
      for (const [, plugin] of this.KazagumoOptions.plugins.entries()) {
        if (plugin.constructor.name !== 'KazagumoPlugin')
          throw new KazagumoError(1, 'Plugin must be an instance of KazagumoPlugin');
        plugin.load(this);
      }
    }

    this.players = new Map<string, KazagumoPlayer>();
  }
  public on<K extends keyof KazagumoEvents>(event: K, listener: (...args: KazagumoEvents[K]) => void): this {
    super.on(event as string, (...args: any) => listener(...args));
    return this;
  }
  public once<K extends keyof KazagumoEvents>(event: K, listener: (...args: KazagumoEvents[K]) => void): this {
    super.once(event as string, (...args: any) => listener(...args));
    return this;
  }
  public off<K extends keyof KazagumoEvents>(event: K, listener: (...args: KazagumoEvents[K]) => void): this {
    super.off(event as string, (...args: any) => listener(...args));
    return this;
  }
  public emit<K extends keyof KazagumoEvents>(event: K, ...data: KazagumoEvents[K]): boolean {
    return super.emit(event as string, ...data);
  }
  /**
   * Create a player.
   * @param options CreatePlayerOptions
   * @returns Promise<KazagumoPlayer>
   */
  public async createPlayer<T extends KazagumoPlayer>(options: CreatePlayerOptions): Promise<T | KazagumoPlayer> {
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
    if (!shoukakuConnection) throw new KazagumoError(1, 'Cannot find the shoukaku connection');
    const kazagumoPlayer = new (this.KazagumoOptions.extends?.player ?? KazagumoPlayer)(
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
    await kazagumoPlayer.init();
    this.players.set(options.guildId, kazagumoPlayer);
    this.emit(Events.PlayerCreate, kazagumoPlayer);
    return kazagumoPlayer;
  }

  /**
   * Get a player by guildId.
   * @param guildId Guild ID
   * @returns KazagumoPlayer | undefined
   */
  public getPlayer<T extends KazagumoPlayer>(guildId: Snowflake): (T | KazagumoPlayer) | undefined {
    return this.players.get(guildId);
  }

  /**
   * Destroy a player.
   * @param guildId Guild ID
   * @returns void
   */
  public destroyPlayer<T extends KazagumoPlayer>(guildId: Snowflake): void {
    const player = this.getPlayer<T>(guildId);
    if (!player) return;
    player.destroy();
  }

  /**
   * Search a track by query or uri.
   * @param player Kazagumo Player
   * @param query Query
   * @param options KazagumoOptions
   * @returns Promise<KazagumoSearchResult>
   */
  public async search(
    player: KazagumoPlayer,
    query: string,
    options: KazagumoSearchOptions,
  ): Promise<KazagumoSearchResult> {
    if (player.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');

    const source = (SourceIDs as any)[
      (options?.engine && ['youtube', 'youtube_music', 'soundcloud'].includes(options.engine)
        ? options.engine
        : null) ||
        (!!this.KazagumoOptions.defaultSearchEngine &&
        ['youtube', 'youtube_music', 'soundcloud'].includes(this.KazagumoOptions.defaultSearchEngine!)
          ? this.KazagumoOptions.defaultSearchEngine
          : null) ||
        'youtube'
    ];

    const isUrl = /^https?:\/\/.*/.test(query);

    const result = await player.node.rest.resolve(!isUrl ? `${source}search:${query}` : query).catch((_) => null);

    if (result?.loadType === LoadType.TRACK) {
      return this.buildSearch(undefined, [new KazagumoTrack(result.data, options.requester)], SearchResultTypes.Track);
    } else if (result?.loadType === LoadType.PLAYLIST) {
      return this.buildSearch(
        result.data,
        result.data.tracks.map((track) => new KazagumoTrack(track, options.requester)),
        SearchResultTypes.Playlist,
      );
    } else if (result?.loadType === LoadType.SEARCH) {
      return this.buildSearch(
        undefined,
        result.data.map((track) => new KazagumoTrack(track, options.requester)),
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
    tracks: KazagumoTrack[] = [],
    type?: SearchResultTypes,
  ): KazagumoSearchResult {
    return {
      playlistInfo,
      tracks,
      type: type ?? SearchResultTypes.Search,
    };
  }
}
