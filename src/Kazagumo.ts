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
}
