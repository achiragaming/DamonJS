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
  VoiceChannelOptions,
  Connection,
  Player,
  Constants,
} from 'shoukaku';

import { DamonJsPlayer } from './Managers/DamonJsPlayer';
import { DamonJsTrack } from './Managers/Supports/DamonJsTrack';
import { Snowflake } from 'discord.js';

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
    if (this.DamonJsOptions.skipOnException === undefined) this.DamonJsOptions.skipOnException = true;
    if (this.DamonJsOptions.skipOnStuck === undefined) this.DamonJsOptions.skipOnStuck = true;
    if (this.DamonJsOptions.plugins) {
      for (const [, plugin] of this.DamonJsOptions.plugins.entries()) {
        if (plugin.constructor.name !== 'DamonJsPlugin')
          throw new DamonJsError(1, 'Plugin must be an instance of DamonJsPlugin');
        plugin.load(this);
      }
    }
    this.shoukaku.joinVoiceChannel = this.joinVoiceChannel.bind(this);
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
    query: string,
    options: DamonJsSearchOptions,
    player?: DamonJsPlayer,
  ): Promise<DamonJsSearchResult> {
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
    const node = player ? player.node : await this.getLeastUsedNode().catch((_) => null);
    if (!node) throw new DamonJsError(2, 'No nodes are online');
    const result = player
      ? await node.rest.resolve(!isUrl ? `${source}search:${query}` : query).catch((_) => null)
      : await node.rest.resolve(!isUrl ? `${source}search:${query}` : query).catch((_) => null);

    if (result?.loadType === LoadType.TRACK && result.data) {
      return this.buildSearch(undefined, [new DamonJsTrack(result.data, options.requester)], SearchResultTypes.Track);
    } else if (result?.loadType === LoadType.PLAYLIST && result.data.tracks.length) {
      return this.buildSearch(
        result.data,
        result.data.tracks.map((track) => new DamonJsTrack(track, options.requester)),
        SearchResultTypes.Playlist,
      );
    } else if (result?.loadType === LoadType.SEARCH && result.data.length) {
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

  /**
   * Retrieves the least used node from the list of nodes.
   * inspired from kazagumo
   * @return {Promise<Node>} The least used node
   */
  public async getLeastUsedNode(): Promise<Node> {
    const nodes: Node[] = [...this.shoukaku.nodes.values()];

    const onlineNodes = nodes.filter((node) => node.state === Constants.State.CONNECTED);
    if (!onlineNodes.length) throw new DamonJsError(2, 'No nodes are online');

    const temp = await Promise.all(
      onlineNodes.map(async (node) => ({
        node,
        players: (
          await node.rest.getPlayers()
        )
          .filter((x) => this.players.get(x.guildId))
          .map((x) => this.players.get(x.guildId)!)
          .filter((x) => x.node.name === node.name).length,
      })),
    );

    return temp.reduce((a, b) => (a.players + a.node.penalties < b.players + b.node.penalties ? a : b)).node;
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

  private async joinVoiceChannel(options: VoiceChannelOptions): Promise<Player> {
    if (this.shoukaku.connections.has(options.guildId))
      throw new Error('This guild already have an existing connection');
    const connection = new Connection(this.shoukaku, options);
    this.shoukaku.connections.set(connection.guildId, connection);
    try {
      await connection.connect();
    } catch (error) {
      this.shoukaku.connections.delete(options.guildId);
      throw error;
    }
    try {
      const node = await this.getLeastUsedNode().catch((_) => null);
      if (!node) throw new Error("Can't find any nodes to connect on");
      const player = this.shoukaku.options.structures.player
        ? new this.shoukaku.options.structures.player(connection.guildId, node)
        : new Player(connection.guildId, node);
      const onUpdate = (state: Constants.VoiceState) => {
        if (state !== Constants.VoiceState.SESSION_READY) return;
        player.sendServerUpdate(connection);
      };
      await player.sendServerUpdate(connection);
      connection.on('connectionUpdate', onUpdate);
      this.shoukaku.players.set(player.guildId, player);
      return player;
    } catch (error) {
      connection.disconnect();
      this.shoukaku.connections.delete(options.guildId);
      throw error;
    }
  }
}
