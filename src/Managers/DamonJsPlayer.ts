import { DamonJs } from '../DamonJs';
import { DamonJsQueue } from './Supports/DamonJsQueue';
import {
  Player,
  Node,
  WebSocketClosedEvent,
  TrackExceptionEvent,
  FilterOptions,
  PlayerUpdate,
  TrackEndReason,
  TrackStuckEvent,
  LoadType,
  Connection,
  Shoukaku,
} from 'shoukaku';
import {
  DamonJsError,
  DamonJsPlayerOptions,
  PlayerState,
  Events,
  PlayOptions,
  DamonJsSearchOptions,
  DamonJsSearchResult,
  DamonJsEvents,
  LoopState,
  SourceIDs,
  SearchResultTypes,
} from '../Modules/Interfaces';
import { DamonJsTrack } from './Supports/DamonJsTrack';
import { Snowflake } from 'discord.js';

export class DamonJsPlayer {
  /**
   * DamonJs options
   */
  private options: DamonJsPlayerOptions;
  /**
   * The text channel ID of the player
   */
  public textId: Snowflake;
  /**
   * DamonJs Instance
   */
  private readonly damonjs: DamonJs;
  /**
   * Shoukaku's Player instance
   */
  public player: Player;
  /**
   * Shoukaku's Player instance
   */
  private isTrackPlaying: boolean;
  /**
   * Shoukaku's Main Instance
   */
  public shoukaku: Shoukaku;
  /**
   * Shoukaku's Connection instance
   */
  public connection: Connection;
  /**
   * Player's queue
   */
  public readonly queue: DamonJsQueue;
  /**
   * Get the current state of the player
   */
  public state: PlayerState = PlayerState.CONNECTING;
  /**
   * Loop status
   */
  public loop: LoopState = LoopState.None;
  /**
   * Player's custom data
   */
  public readonly data: Map<string, any>;
  /**
   * Search a track by query or uri
   * @param query Query
   * @param options DamonJsOptions
   * @returns Promise<DamonJsSearchResult>
   */
  search: (query: string, options: DamonJsSearchOptions) => Promise<DamonJsSearchResult>;

  /**
   * @param damonjs DamonJs instance
   * @param connection Shoukaku's Connection instance
   * @param player Shoukaku's Player instance
   * @param options DamonJs options
   */
  constructor(
    damonjs: DamonJs,
    shoukaku: Shoukaku,
    player: Player,
    connection: Connection,
    options: DamonJsPlayerOptions,
  ) {
    this.options = options;
    this.damonjs = damonjs;
    this.player = player;
    this.connection = connection;
    this.shoukaku = shoukaku;
    this.queue = new DamonJsQueue();
    this.data = new Map(options.data);
    this.textId = this.options.textId;
    this.search = this.damonjs.search.bind(this.damonjs, this);
    this.isTrackPlaying = false;
  }

  /**
   * Initialize the player
   */
  public async init() {
    if (this.state === PlayerState.CONNECTED) throw new DamonJsError(1, 'Player is already initialized or initiazing');
    await this.setGlobalVolume(this.options.volume);
    this.player.on('start', () => {
      if (!this.queue.current) return;
      this.isTrackPlaying = true;
      this.emit(Events.PlayerStart, this, this.queue.current);
    });

    this.player.on('end', (data) => {
      // This event emits STOPPED reason when destroying, so return to prevent double emit
      if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
        return this.emit(Events.Debug, `Player ${this.guildId} destroyed from end event`);

      this.isTrackPlaying = false;

      if (data.reason === 'replaced') return this.emit(Events.PlayerEmpty, this);

      if (this.loop === LoopState.Track) {
        this.queue.currentId = this.queue.currentId;
      } else if (this.loop === LoopState.Queue && this.queue.isEnd) {
        this.queue.currentId = 0;
      } else if (this.loop === LoopState.None) {
        this.queue.currentId++;
      }

      if (!this.queue.current) {
        return this.emit(Events.PlayerEmpty, this);
      } else {
        this.emit(Events.PlayerEnd, this, this.queue.current);
      }

      return this.play();
    });

    this.player.on('closed', (data: WebSocketClosedEvent) => {
      this.isTrackPlaying = false;
      this.emit(Events.PlayerClosed, this, data);
    });

    this.player.on('exception', (data: TrackExceptionEvent) => {
      this.isTrackPlaying = false;
      this.emit(Events.PlayerException, this, data);
    });

    this.player.on('update', (data: PlayerUpdate) => {
      if (!this.queue.current) return;
      this.queue.current.position = data.state.position || 0;
      this.emit(Events.PlayerUpdate, this, data);
    });
    this.player.on('stuck', (data: TrackStuckEvent) => {
      this.isTrackPlaying = false;
      this.emit(Events.PlayerStuck, this, data);
    });
    this.player.on('resumed', () => this.emit(Events.PlayerResumed, this));

    this.state = PlayerState.CONNECTED;
  }

  /**
   * Get GuildId
   */
  public get guildId(): string {
    return this.connection.guildId;
  }
  /**
   * Get VoiceId
   */
  public get voiceId(): string | null {
    return this.connection.channelId;
  }
  /**
   * Get Deaf Status
   */
  public get deaf(): boolean {
    return this.connection.deafened;
  }
  /**
   * Get Playing Status
   */
  public get playing(): boolean {
    return this.isTrackPlaying && !this.player.paused ? true : false;
  }
  /**
   * Get if track is ready to play or not
   */
  public get playable(): boolean {
    return this.isTrackPlaying;
  }
  /**
   * Get Paused Status
   */
  public get paused(): boolean {
    return this.player.paused;
  }
  /**
   * Get Mute Status
   */
  public get mute(): boolean {
    return this.connection.muted;
  }
  /**
   * Get volume
   */
  public get volume(): number {
    return this.player.volume;
  }
  /**
   * Get Filter volume
   */
  public get filterVolume(): number | undefined {
    return this.player.filters.volume;
  }
  /**
   * Get player position
   */
  public get position(): number {
    return this.player.position;
  }

  /**
   * Get filters
   */
  public get filters(): FilterOptions {
    return this.player.filters;
  }

  public get node(): Node {
    return this.player.node;
  }

  /**
   * Pause the player
   * @param pause Whether to pause or not
   * @returns Promise<DamonJsPlayer>
   */
  public async pause(pause: boolean): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (this.paused === pause || !this.queue.totalSize) return this;
    await this.player.setPaused(pause);

    return this;
  }

  /**
   * Set loop mode
   * @param [loop] Loop mode
   * @returns DamonJsPlayer
   */
  public setLoop(loop?: LoopState): DamonJsPlayer {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (loop === undefined) {
      if (this.loop === LoopState.None) this.loop = LoopState.Queue;
      else if (this.loop === LoopState.Queue) this.loop = LoopState.Track;
      else if (this.loop === LoopState.Track) this.loop = LoopState.None;
      return this;
    }

    this.loop = loop;
    return this;
  }

  /**
   * Play a track
   * @param track Track to play
   * @param options Play options
   * @returns Promise<DamonJsPlayer>
   */
  public async play(track?: DamonJsTrack, options?: PlayOptions): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');

    if (!track && !this.queue.totalSize) throw new DamonJsError(1, 'No track is available to play');

    if (!options) options = { replaceCurrent: false };

    if (track) {
      this.queue.splice(this.queue.currentId, options.replaceCurrent && this.queue.current ? 1 : 0, track);
    }

    if (this.playable) {
      this.queue.currentId--;
      await this.player.stopTrack();
    } else {
      if (!this.queue.current) throw new DamonJsError(1, 'No track is available to play');
      const current = this.queue.current;
      current.setDamonJs(this.damonjs);

      const resolveResult = await current.resolve({ player: this }).catch((e: Error) => e);

      if (resolveResult instanceof Error) {
        this.emit(Events.PlayerResolveError, this, current, resolveResult.message);
        this.emit(Events.Debug, `Player ${this.guildId} resolve error: ${resolveResult.message} skipping`);
        return this.skip();
      }
      const playOptions = { track: current.encoded, options: {} };
      if (options) playOptions.options = { ...options, noReplace: false };
      else playOptions.options = { noReplace: false };
      await this.player.playTrack(playOptions);
    }

    return this;
  }

  /**
   * Skip the current track
   * @returns Promise<DamonJsPlayer>
   */
  public skip(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    let trackId = this.queue.currentId + 1;
    if (!this.queue[trackId]) trackId = 0;
    if (!this.queue[trackId]) throw new DamonJsError(2, `No songs available for skip.`);
    return this.skipto(trackId);
  }

  /**
   * Skip to the previous track
   * @returns Promise<DamonJsPlayer>
   */
  public async previous(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    let trackId = this.queue.currentId - 1;
    if (!this.queue[trackId]) trackId = this.queue.length - 1;
    if (!this.queue[trackId]) throw new DamonJsError(2, `No songs available for previous.`);
    return this.skipto(trackId);
  }

  /**
   * Skip to a specifc track
   * @param trackId Id of the Track
   * @returns Promise<DamonJsPlayer>
   */
  public async skipto(trackId: number): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (!this.queue[trackId]) throw new DamonJsError(2, `${trackId} is an invalid track ID.`);
    let realTrackId = trackId - 1;
    if (this.loop === LoopState.Track) realTrackId = this.queue.currentId - 1;
    if (!this.playable) {
      this.queue.currentId = realTrackId + 1;
      await this.play();
    } else {
      this.queue.currentId = realTrackId;
      await this.player.stopTrack();
    }
    return this;
  }

  /**
   * seek to a specifc position
   * @param position Position
   * @returns Promise<DamonJsPlayer>
   */
  public async seek(position: number): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (!this.queue.current) throw new DamonJsError(1, "Player has no current track in it's queue");
    if (!this.queue.current.isSeekable) throw new DamonJsError(1, "The current track isn't seekable");

    position = Number(position);

    if (isNaN(position)) throw new DamonJsError(1, 'position must be a number');
    if (position < 0 || position > (this.queue.current.length ?? 0))
      position = Math.max(Math.min(position, this.queue.current.length ?? 0), 0);

    await this.player.seekTo(position);
    return this;
  }

  /**
   * Set the Global volume
   * @param volume Volume
   * @returns Promise<DamonJsPlayer>
   */
  public async setGlobalVolume(volume: number): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (isNaN(volume)) throw new DamonJsError(1, 'volume must be a number');
    await this.player.setGlobalVolume(volume);
    return this;
  }

  /**
   * Set the Filter volume
   * @param volume Volume
   * @returns Promise<DamonJsPlayer>
   */
  public async setFilterVolume(volume: number): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (isNaN(volume)) throw new DamonJsError(1, 'volume must be a number');
    await this.player.setFilterVolume(volume / 100);
    return this;
  }

  /**
   * Set voice channel and move the player to the voice channel
   * @param voiceId Voice channel ID
   * @returns DamonJsPlayer
   */
  public setVoiceChannel(voiceId: Snowflake): DamonJsPlayer {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    this.state = PlayerState.CONNECTING;

    this.connection.channelId = voiceId;

    this.connection.manager.connector.sendPacket(
      this.connection.shardId,
      {
        op: 4,
        d: { guild_id: this.guildId, channel_id: this.voiceId, self_deaf: this.deaf, self_mute: this.mute },
      },
      false,
    );

    this.state = PlayerState.CONNECTED;
    this.emit(Events.Debug, `Player ${this.guildId} moved to voice channel ${voiceId}`);

    return this;
  }

  /**
   * Set text channel
   * @param textId Text channel ID
   * @returns DamonJsPlayer
   */
  public setTextChannel(textId: Snowflake): DamonJsPlayer {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');

    this.textId = textId;

    return this;
  }

  /**
   * Set the Mute State
   * @param mute Mute State
   * @returns DamonJsPlayer
   */
  public setMute(mute?: boolean): DamonJsPlayer {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    this.connection.setMute(mute);
    return this;
  }
  /**
   * Set the Deaf State
   * @param deaf Deaf State
   * @returns DamonJsPlayer
   */
  public setDeaf(deaf?: boolean): DamonJsPlayer {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    this.connection.setDeaf(deaf);
    return this;
  }

  /**
   * Destroy the player
   * @returns Promise<DamonJsPlayer>
   */
  async destroy(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
      throw new DamonJsError(1, 'Player is already destroyed');

    this.state = PlayerState.DESTROYING;
    await this.shoukaku.leaveVoiceChannel(this.guildId);
    this.damonjs.players.delete(this.guildId);
    this.state = PlayerState.DESTROYED;
    this.emit(Events.PlayerDestroy, this);
    this.emit(Events.Debug, `Player destroyed; Guild id: ${this.guildId}`);

    return this;
  }

  private emit<K extends keyof DamonJsEvents>(event: K, ...args: DamonJsEvents[K]): void {
    this.damonjs.emit(event, ...args);
  }
}
