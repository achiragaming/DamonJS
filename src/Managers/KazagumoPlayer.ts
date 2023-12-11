import { Kazagumo } from '../Kazagumo';
import { KazagumoQueue } from './Supports/KazagumoQueue';
import {
  Player,
  Node,
  WebSocketClosedEvent,
  TrackExceptionEvent,
  PlayerUpdate,
  Filters,
  TrackStuckEvent,
} from 'shoukaku';
import {
  KazagumoError,
  KazagumoPlayerOptions,
  PlayerState,
  Events,
  PlayOptions,
  KazagumoSearchOptions,
  KazagumoSearchResult,
  KazagumoEvents,
  LoopState,
} from '../Modules/Interfaces';
import { KazagumoTrack } from './Supports/KazagumoTrack';
import { Snowflake } from 'discord.js';

export class KazagumoPlayer {
  /**
   * Kazagumo options
   */
  private options: KazagumoPlayerOptions;
  /**
   * Kazagumo Instance
   */
  private readonly kazagumo: Kazagumo;
  /**
   * Shoukaku's Player instance
   */
  public shoukaku: Player;
  /**
   * The guild ID of the player
   */
  public readonly guildId: Snowflake;
  /**
   * The voice channel ID of the player
   */
  public voiceId: Snowflake | null;
  /**
   * The text channel ID of the player
   */
  public textId: Snowflake;
  /**
   * Player's queue
   */
  public readonly queue: KazagumoQueue;
  /**
   * Get the current state of the player
   */
  public state: PlayerState = PlayerState.CONNECTING;
  /**
   * Paused state of the player
   */
  public paused: boolean = false;
  /**
   * Whether the player is playing or not
   */
  public playing: boolean = false;
  /**
   * Loop status
   */
  public loop: LoopState = LoopState.None;
  /**
   * Search track/s
   */
  public search: (query: string, options?: KazagumoSearchOptions) => Promise<KazagumoSearchResult>;
  /**
   * Player's custom data
   */
  public readonly data: Map<string, any> = new Map();

  /**
   * Initialize the player
   * @param kazagumo Kazagumo instance
   * @param player Shoukaku's Player instance
   * @param options Kazagumo options
   * @param customData private readonly customData
   */
  constructor(
    kazagumo: Kazagumo,
    player: Player,
    options: KazagumoPlayerOptions,
    private readonly customData: unknown,
  ) {
    this.options = options;
    this.kazagumo = kazagumo;
    this.shoukaku = player;
    this.guildId = options.guildId;
    this.voiceId = options.voiceId;
    this.textId = options.textId;
    this.queue = new KazagumoQueue();
    if (options.volume !== 100) this.setVolume(options.volume);

    this.search = (typeof this.options.searchWithSameNode === 'boolean' ? this.options.searchWithSameNode : true)
      ? (query: string, opt?: KazagumoSearchOptions) =>
          kazagumo.search.bind(kazagumo)(query, opt ? { ...opt, nodeName: this.shoukaku.node.name } : undefined)
      : kazagumo.search.bind(kazagumo);

    this.shoukaku.on('start', () => {
      if (!this.queue.current) return;
      this.playing = true;
      this.emit(Events.PlayerStart, this, this.queue.current);
    });

    this.shoukaku.on('end', (data) => {
      // This event emits STOPPED reason when destroying, so return to prevent double emit
      if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
        return this.emit(Events.Debug, `Player ${this.guildId} destroyed from end event`);

      if (data.reason === 'REPLACED') return this.emit(Events.PlayerEnd, this);

      if (this.loop === LoopState.Track) {
        this.queue.currentId = this.queue.currentId;
      } else if (this.loop === LoopState.Queue && this.queue.isEnd) {
        this.queue.currentId = 0;
      } else if (this.loop === LoopState.None) {
        this.queue.currentId++;
      }

      if (!this.queue.current) this.queue.currentId = 0;

      if (!this.queue.current) {
        this.playing = false;
        this.queue.clear();
        return this.emit(Events.PlayerEmpty, this);
      } else {
        this.emit(Events.PlayerEnd, this, this.queue.current);
      }

      return this.play();
    });

    this.shoukaku.on('closed', (data: WebSocketClosedEvent) => {
      this.playing = false;
      this.emit(Events.PlayerClosed, this, data);
    });

    this.shoukaku.on('exception', (data: TrackExceptionEvent) => {
      this.playing = false;
      this.emit(Events.PlayerException, this, data);
    });

    this.shoukaku.on('update', (data: PlayerUpdate) => this.emit(Events.PlayerUpdate, this, data));
    this.shoukaku.on('stuck', (data: TrackStuckEvent) => this.emit(Events.PlayerStuck, this, data));
    this.shoukaku.on('resumed', () => this.emit(Events.PlayerResumed, this));
  }

  /**
   * Get volume
   */
  public get volume(): number {
    return this.shoukaku.filters.volume;
  }

  /**
   * Get player position
   */
  public get position(): number {
    return this.shoukaku.position;
  }

  /**
   * Get filters
   */
  public get filters(): Filters {
    return this.shoukaku.filters;
  }

  private get node(): Node {
    return this.shoukaku.node;
  }

  private send(...args: any): void {
    this.node.queue.add(...args);
  }

  /**
   * Pause the player
   * @param pause Whether to pause or not
   * @returns KazagumoPlayer
   */
  public pause(pause: boolean): KazagumoPlayer {
    if (typeof pause !== 'boolean') throw new KazagumoError(1, 'pause must be a boolean');

    if (this.paused === pause || !this.queue.totalSize) return this;
    this.paused = pause;
    this.playing = !pause;
    this.shoukaku.setPaused(pause);

    return this;
  }

  /**
   * Set text channel
   * @param textId Text channel ID
   * @returns KazagumoPlayer
   */
  public setTextChannel(textId: Snowflake): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');

    this.textId = textId;

    return this;
  }

  /**
   * Set voice channel and move the player to the voice channel
   * @param voiceId Voice channel ID
   * @returns KazagumoPlayer
   */
  public setVoiceChannel(voiceId: Snowflake): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');
    this.state = PlayerState.CONNECTING;

    this.voiceId = voiceId;
    this.kazagumo.KazagumoOptions.send(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: this.voiceId,
        self_mute: false,
        self_deaf: this.options.deaf,
      },
    });

    this.emit(Events.Debug, `Player ${this.guildId} moved to voice channel ${voiceId}`);

    return this;
  }

  /**
   * Set loop mode
   * @param [loop] Loop mode
   * @returns KazagumoPlayer
   */
  public setLoop(loop?: LoopState): KazagumoPlayer {
    if (loop === undefined) {
      if (this.loop === LoopState.None) this.loop = LoopState.Queue;
      else if (this.loop === LoopState.Queue) this.loop = LoopState.Track;
      else if (this.loop === LoopState.Track) this.loop = LoopState.None;
      return this;
    }

    if (loop === LoopState.None || loop === LoopState.Queue || loop === LoopState.Track) {
      this.loop = loop;
      return this;
    }

    throw new KazagumoError(1, `loop must be one of 'none', 'queue', 'track'`);
  }

  /**
   * Play a track
   * @param track Track to play
   * @param options Play options
   * @returns KazagumoPlayer
   */
  public async play(track?: KazagumoTrack, options?: PlayOptions): Promise<KazagumoPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');

    if (track && !(track instanceof KazagumoTrack)) throw new KazagumoError(1, 'track must be a KazagumoTrack');

    if (!track && !this.queue.totalSize) throw new KazagumoError(1, 'No track is available to play');

    if (!options || typeof options.replaceCurrent !== 'boolean') options = { ...options, replaceCurrent: false };

    if (track) {
      this.queue.splice(this.queue.currentId, options.replaceCurrent && this.queue.current ? 1 : 0, track);
    }
    if (!this.queue.current) throw new KazagumoError(1, 'No track is available to play');

    const current = this.queue.current;
    current.setKazagumo(this.kazagumo);

    let errorMessage: string | undefined;

    const resolveResult = await current.resolve({ player: this as KazagumoPlayer }).catch((e) => {
      errorMessage = e.message;
      return null;
    });

    if (!resolveResult) {
      this.emit(Events.PlayerResolveError, this, current, errorMessage);
      this.emit(Events.Debug, `Player ${this.guildId} resolve error: ${errorMessage} skipping`);
      return this.skip();
    }

    const playOptions = { track: current.track, options: {} };
    if (options) playOptions.options = { ...options, noReplace: false };
    else playOptions.options = { noReplace: false };

    this.shoukaku.playTrack(playOptions);

    return this;
  }

  /**
   * Skip the current track
   * @returns KazagumoPlayer
   */
  public skip(): KazagumoPlayer {
    let trackId = this.queue.currentId + 1;
    if (!this.queue.at(trackId)) trackId = 0;
    if (!this.queue.at(trackId)) throw new Error(`No songs available for skip.`);
    return this.skipto(trackId);
  }
  /**
   * Skip to previous track
   * @returns KazagumoPlayer
   */
  public previous(): KazagumoPlayer {
    let trackId = this.queue.currentId - 1;
    if (!this.queue.at(trackId)) trackId = this.queue.length - 1;
    if (!this.queue.at(trackId)) throw new Error(`No songs available for previous.`);
    return this.skipto(trackId);
  }
  /**
   * Skip to a specifc track
   * @returns KazagumoPlayer
   */
  public skipto(trackId: number): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');
    if (trackId < 0 || trackId > this.queue.size) throw new Error(`${trackId} is an invalid track ID.`);
    let realTrackId = trackId - 1;
    if (this.loop === LoopState.Track) realTrackId = this.queue.currentId - 1;
    this.queue.currentId = realTrackId;
    this.shoukaku.stopTrack();
    return this;
  }
  /**
   *
   */
  public seek(position: number): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');
    if (!this.queue.current) throw new KazagumoError(1, "Player has no current track in it's queue");
    if (!this.queue.current.isSeekable) throw new KazagumoError(1, "The current track isn't seekable");

    position = Number(position);

    if (isNaN(position)) throw new KazagumoError(1, 'position must be a number');
    if (position < 0 || position > (this.queue.current.length ?? 0))
      position = Math.max(Math.min(position, this.queue.current.length ?? 0), 0);

    this.queue.current.position = position;
    this.send({
      op: 'seek',
      guildId: this.guildId,
      position,
    });
    return this;
  }

  /**
   * Set the volume
   * @param volume Volume
   * @returns KazagumoPlayer
   */
  public setVolume(volume: number): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');
    if (isNaN(volume)) throw new KazagumoError(1, 'volume must be a number');

    this.shoukaku.filters.volume = volume / 100;

    this.send({
      op: 'volume',
      guildId: this.guildId,
      volume: this.shoukaku.filters.volume * 100,
    });

    return this;
  }

  /**
   * Connect to the voice channel
   * @returns KazagumoPlayer
   */
  public connect(): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYED) throw new KazagumoError(1, 'Player is already destroyed');
    if (this.state === PlayerState.CONNECTED || !!this.voiceId)
      throw new KazagumoError(1, 'Player is already connected');
    this.state = PlayerState.CONNECTING;

    this.kazagumo.KazagumoOptions.send(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: this.voiceId,
        self_mute: false,
        self_deaf: this.options.deaf,
      },
    });

    this.state = PlayerState.CONNECTED;

    this.emit(Events.Debug, `Player ${this.guildId} connected`);

    return this;
  }

  /**
   * Disconnect from the voice channel
   * @returns KazagumoPlayer
   */
  public disconnect(): KazagumoPlayer {
    if (this.state === PlayerState.DISCONNECTED || !this.voiceId)
      throw new KazagumoError(1, 'Player is already disconnected');
    this.state = PlayerState.DISCONNECTING;

    this.pause(true);
    this.kazagumo.KazagumoOptions.send(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: null,
        self_mute: false,
        self_deaf: false,
      },
    });

    this.voiceId = null;
    this.state = PlayerState.DISCONNECTED;

    this.emit(Events.Debug, `Player disconnected; Guild id: ${this.guildId}`);

    return this;
  }

  /**
   * Destroy the player
   * @returns KazagumoPlayer
   */
  destroy(): KazagumoPlayer {
    if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
      throw new KazagumoError(1, 'Player is already destroyed');

    this.disconnect();
    this.state = PlayerState.DESTROYING;
    this.shoukaku.connection.disconnect();
    this.shoukaku.removeAllListeners();
    this.kazagumo.players.delete(this.guildId);
    this.state = PlayerState.DESTROYED;

    this.emit(Events.PlayerDestroy, this);
    this.emit(Events.Debug, `Player destroyed; Guild id: ${this.guildId}`);

    return this;
  }

  private emit<K extends keyof KazagumoEvents>(event: K, ...args: KazagumoEvents[K]): void {
    this.kazagumo.emit(event, ...args);
  }
}
