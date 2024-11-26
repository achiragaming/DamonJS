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
  Connection,
  Shoukaku,
  Band,
  KaraokeSettings,
  TimescaleSettings,
  FreqSettings,
  RotationSettings,
  DistortionSettings,
  ChannelMixSettings,
  LowPassSettings,
  TrackEndEvent,
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
import EventEmitter from 'events';

export class DamonJsPlayer {
  private options: DamonJsPlayerOptions;
  public textId: Snowflake;
  private lockMap: Map<string, Promise<any>> = new Map();
  private readonly damonjs: DamonJs;
  public player: Player;
  public shoukaku: Shoukaku;
  public connection: Connection;
  public readonly queue: DamonJsQueue;
  public state: PlayerState = PlayerState.CONNECTING;
  public loop: LoopState = LoopState.None;
  public readonly data: Map<string, any>;
  public search: (query: string, options: DamonJsSearchOptions) => Promise<DamonJsSearchResult>;
  public readonly stats: {
    skipAttemptData: { skipAttempts: number[]; destroyTriggers: number[]; lastSkipTime: number };
  };
  events: EventEmitter;

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
    this.events = new EventEmitter();
    this.connection = connection;
    this.shoukaku = shoukaku;
    this.queue = new DamonJsQueue(this);
    this.data = new Map(options.data);
    this.textId = this.options.textId;
    this.stats = {
      skipAttemptData: { skipAttempts: [], destroyTriggers: [], lastSkipTime: 0 },
    };
    this.search = (query, searchOptions) => this.damonjs.search(query, searchOptions, this);
  }
  private async executePlaybackOperation<T>(
    name: string,
    operation: () => Promise<T>,
    priority: number = 1,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.playbackQueue.operations.push({
        priority,
        name,
        operation,
        resolve,
        reject,
      });

      this.playbackQueue.operations.sort((a, b) => b.priority - a.priority);

      if (!this.playbackQueue.isProcessing) {
        this.processPlaybackQueue();
      }
    });
  }

  private async processPlaybackQueue() {
    if (this.playbackQueue.isProcessing || this.playbackQueue.operations.length === 0) return;

    this.playbackQueue.isProcessing = true;

    while (this.playbackQueue.operations.length > 0) {
      const current = this.playbackQueue.operations.shift();
      if (!current) continue;

      try {
        const result = await current.operation();
        this.emit(Events.Debug, this, `Executed ${current.name} operation successfully`);
        current.resolve(result);
      } catch (error) {
        this.emit(
          Events.Debug,
          this,
          `Failed to execute ${current.name} operation: ${error instanceof Error ? error.message : String(error)}`,
        );
        current.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.playbackQueue.isProcessing = false;
    if (this.playbackQueue.operations.length > 0) {
      this.processPlaybackQueue();
    }
  }

  public async init() {
    if (this.state === PlayerState.CONNECTED)
      throw new DamonJsError(1, 'Player is already initialized or initializing');
    await this.setGlobalVolume(this.options.volume);
    this.initEventListeners();
    this.state = PlayerState.CONNECTED;
  }
  private playbackQueue = {
    operations: [] as {
      priority: number;
      name: string;
      operation: () => Promise<any>;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }[],
    isProcessing: false,
  };

  private initEventListeners() {
    const eventHandlers = {
      start: async () => {
        await this.handleTrackStart();
      },
      end: async (data: TrackEndEvent) => {
        await this.handleTrackEnd(data);
      },
      closed: async (data: WebSocketClosedEvent) => {
        await this.handleTrackClosed(data);
      },
      exception: async (data: TrackExceptionEvent) => {
        await this.handleTrackException(data);
      },
      update: async (data: PlayerUpdate) => {
        await this.handleTrackUpdate(data);
      },
      stuck: async (data: TrackStuckEvent) => {
        await this.handleTrackStuck(data);
      },
      resumed: async () => {
        await this.handleTrackResumed();
      },
      empty: async () => {
        await this.handlePlayerEmpty();
      },
      resolveError: async (resolveResult: Error) => {
        await this.handleResolveError(resolveResult);
      },
      trackPlay: async (tracks?: DamonJsTrack[], options?: PlayOptions) => {
        await this.handleTrackPlay(tracks, options);
      },
      trackSkip: async (trackId: number) => {
        await this.handleTrackSkip(trackId);
      },
      playerDestroy: async () => {
        await this.handlePlayerDestroy();
      },
    };
    const shoukakuEvents = ['start', 'end', 'closed', 'exception', 'update', 'stuck', 'resumed'] as const;
    shoukakuEvents.forEach((event) => {
      this.player.on(event, (data) => this.events.emit(event, data));
    });
    const damonjsEvents = [
      'start',
      'end',
      'closed',
      'exception',
      'update',
      'stuck',
      'resumed',
      'empty',
      'resolveError',
      'trackPlay',
      'trackSkip',
      'playerDestroy',
    ] as const;
    damonjsEvents.forEach((event) => {
      this.events.on(event, (data) => eventHandlers[event](data));
    });
  }
  // playback functions (HAPPENS SEQUANTIALLY)
  private async handleTrackEnd(data: TrackEndEvent) {
    return this.executePlaybackOperation(
      'trackEnd',
      async () => {
        const currentTrack = this.queue.current;
        if (currentTrack) {
          this.queue.current = undefined;
          this.emit(Events.PlayerEnd, this, currentTrack, data);
        }

        if (this.damonjs.trackEnd.skip) {
          const trackId = this.queue.currentId + 1;
          this.events.emit('trackSkip', trackId);
        }
      },
      2,
    );
  }

  private async handleTrackException(data: TrackExceptionEvent) {
    return this.executePlaybackOperation(
      'trackStart',
      async () => {
        const currentTrack = this.queue.current;
        if (currentTrack) {
          this.queue.current = undefined;
          this.emit(Events.PlayerException, this, currentTrack, data);
        }

        if (this.damonjs.trackException.skip) {
          const trackId = this.queue.currentId + 1;
          this.events.emit('trackSkip', trackId);
        }
      },
      2,
    );
  }

  private async handleTrackStuck(data: TrackStuckEvent) {
    return this.executePlaybackOperation(
      'trackStuck',
      async () => {
        const currentTrack = this.queue.current;

        if (currentTrack) {
          this.queue.current = undefined;
          this.emit(Events.PlayerStuck, this, currentTrack, data);
        }

        if (this.damonjs.trackStuck.skip) {
          const trackId = this.queue.currentId + 1;
          this.events.emit('trackSkip', trackId);
        }
      },
      2,
    );
  }

  private async handleResolveError(resolveResult: Error) {
    return this.executePlaybackOperation(
      'resolveError',
      async () => {
        const currentTrack = this.queue.current;

        if (currentTrack) {
          this.queue.current = undefined;
          this.emit(Events.PlayerResolveError, this, currentTrack, resolveResult.message);
        }
        if (this.damonjs.trackResolveError.skip) {
          const trackId = this.queue.currentId + 1;
          this.events.emit('trackSkip', trackId);
        }
      },
      2,
    );
  }

  private async handleTrackStart() {
    return this.executePlaybackOperation(
      'trackStart',
      async () => {
        const currentTrack = this.queue.current;
        if (!currentTrack) {
          return this.emit(Events.Debug, this, `No track to start ${this.guildId}`);
        }
        this.player.paused = false;
        this.emit(Events.PlayerStart, this, currentTrack);
      },
      2,
    );
  }

  private async handlePlayerEmpty() {
    return this.executePlaybackOperation(
      'playerEmpty',
      async () => {
        this.emit(Events.PlayerEmpty, this, this.queue.lastTrack);
        return this;
      },
      1,
    );
  }

  private async handleTrackSkip(trackId: number) {
    return this.executePlaybackOperation(
      'trackSkip',
      async () => {
        if (this.state === PlayerState.DESTROYED) {
          throw new DamonJsError(1, 'Player is already destroyed');
        }
        const now = Date.now();
        const playAttempts = this.stats.skipAttemptData.skipAttempts.filter(
          (time) => now - time < this.damonjs.skipSpam.rule.timeFrame,
        );
        const destroyTriggers = this.stats.skipAttemptData.destroyTriggers.filter(
          (time) => now - time < this.damonjs.skipSpam.destroy.timeFrame,
        );

        playAttempts.push(now);
        this.stats.skipAttemptData.skipAttempts = playAttempts;
        this.stats.skipAttemptData.lastSkipTime = now;

        if (playAttempts.length >= this.damonjs.skipSpam.rule.maxhits) {
          destroyTriggers.push(now);
          this.stats.skipAttemptData.destroyTriggers = destroyTriggers;
          if (destroyTriggers.length >= this.damonjs.skipSpam.destroy.maxhits) {
            this.emit(Events.Debug, this, `Player ${this.guildId} skipped too many times, destroying`);
            this.events.emit('playerDestroy');
            return this;
          }
          this.emit(
            Events.Debug,
            this,
            `Player ${this.guildId} skipped too many times, in cooldown for ${this.damonjs.skipSpam.rule.cooldown}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, this.damonjs.skipSpam.rule.cooldown));
        }

        if (this.loop === LoopState.Track) {
          this.queue.currentId = this.queue.currentId;
        } else if (this.loop === LoopState.Queue && this.queue.isEnd) {
          this.queue.currentId = 0;
        } else if (this.queue[trackId]) {
          this.queue.currentId = trackId;
        } else if (this.queue.length <= trackId) {
          this.queue.currentId = this.queue.length;
        } else {
          this.queue.currentId = this.queue.length - 1;
        }

        this.events.emit('trackPlay');

        return this;
      },
      2,
    );
  }

  private async handleTrackPlay(tracks?: DamonJsTrack[], options?: PlayOptions) {
    return this.executePlaybackOperation(
      'play',
      async () => {
        if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
        if (!tracks && !this.queue.totalSize) throw new DamonJsError(1, 'No track is available to play');

        if (tracks) {
          if (options?.replaceCurrent && this.queue.current) {
            // Remove current track and add new tracks at current position
            this.queue.splice(this.queue.currentId, 1, ...tracks);
          } else {
            // Add after current track
            this.queue.splice(this.queue.currentId, 0, ...tracks);
          }
        }

        if (this.queue.current) {
          this.queue.currentId--;
          await this.stopTrack();
          return this;
        }

        const currentTrack = this.queue.at(this.queue.currentId);
        if (!currentTrack) {
          this.events.emit('empty');
          throw new DamonJsError(1, 'No track is available to play');
        }
        this.queue.current = currentTrack;

        currentTrack.setDamonJs(this.damonjs);
        const resolveResult = await currentTrack.resolve({ player: this }).catch((e: Error) => e);
        if (resolveResult instanceof Error) {
          this.events.emit('resolveError', resolveResult);
          throw new DamonJsError(
            1,
            `Player ${this.guildId} resolve error: ${resolveResult.message}-${currentTrack.identifier}`,
          );
        }

        let playOptions = { track: { encoded: currentTrack.encoded, userData: currentTrack.requester ?? {} } };
        if (options) playOptions = { ...playOptions, ...options };

        const playerResult = await this.player.playTrack(playOptions).catch((e: Error) => e);
        if (playerResult instanceof Error) {
          this.events.emit('resolveError', playerResult);
          throw new DamonJsError(
            1,
            `Player ${this.guildId} resolve error: ${playerResult.message}-${currentTrack.identifier}`,
          );
        }
        return this;
      },
      2,
    );
  }
  private async handlePlayerDestroy() {
    return this.executePlaybackOperation(
      'destroy',
      async () => {
        if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED) {
          throw new DamonJsError(1, 'Player is already destroyed');
        }
        this.state = PlayerState.DESTROYING;
        this.events.removeAllListeners();
        this.lockMap.clear();
        this.queue.clear();
        this.data.clear();
        await this.shoukaku.leaveVoiceChannel(this.guildId);
        this.damonjs.players.delete(this.guildId);
        this.state = PlayerState.DESTROYED;
        this.emit(Events.PlayerDestroy, this, this.queue.current);
        this.emit(Events.Debug, this, `Player destroyed; Guild id: ${this.guildId}`);
        return this;
      },
      2,
    );
  }

  // NON playback operations (does not go sequentially)
  private async handleTrackResumed() {
    this.emit(Events.PlayerResumed, this);
  }

  private async handleTrackClosed(data: WebSocketClosedEvent) {
    this.emit(Events.PlayerClosed, this, data);
  }

  private async handleTrackUpdate(data: PlayerUpdate) {
    if (!this.queue.current) {
      return this.emit(Events.Debug, this, `No Track to Update ${this.guildId}`);
    }
    this.queue.current.position = data.state.position || 0;
    this.emit(Events.PlayerUpdate, this, this.queue.current, data);
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
    return this.queue.current && !this.player.paused ? true : false;
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
    this.emit(Events.InitQueue, this);
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
    } else this.loop = loop;
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Play a track
   * @param {DamonJsTrack} tracks Track to play
   * @param {PlayOptions} options Play options
   * @returns {Promise<DamonJsPlayer>}
   */
  public async play(tracks?: DamonJsTrack[], options?: PlayOptions): Promise<DamonJsPlayer> {
    return this.handleTrackPlay(tracks, options);
  }
  /**
   * Skips to the next track in the queue.
   * @returns {Promise<DamonJsPlayer>}
   */
  public async skip(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) {
      throw new DamonJsError(1, 'Player is already destroyed');
    }
    const trackId = this.queue.currentId + 1;
    await this.skipto(trackId);
    return this;
  }

  /**
   * Stops the currently playing track.
   * @returns {Promise<DamonJsPlayer>}
   */
  public async stopTrack(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) {
      throw new DamonJsError(1, 'Player is already destroyed');
    }
    await this.player.stopTrack();
    return this;
  }
  /**
   * Skips to the previous track in the queue.
   * @returns {Promise<DamonJsPlayer>}
   */
  public async previous(): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) {
      throw new DamonJsError(1, 'Player is already destroyed');
    }
    const trackId = this.queue.currentId - 1;
    await this.skipto(trackId);
    return this;
  }

  /**
   * Skips to the specified track in the queue.
   * If the player is in a destroyed state, it will throw an error.
   * If the player is currently looping the track or queue, it will continue to do so.
   * If the provided track ID exists in the queue, it will skip to that track.
   * If the provided track ID is greater than the queue length, it will skip to the last track.
   * If the provided track ID is out of bounds, it will skip to the previous track.
   *
   * @param trackId - The ID of the track to skip to.
   * @returns A Promise that resolves to the DamonJsPlayer instance.
   * @throws {DamonJsError} If the player is already destroyed.
   */
  public async skipto(trackId: number): Promise<DamonJsPlayer> {
    return this.handleTrackSkip(trackId);
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
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.Debug, this, `Player ${this.guildId} moved to voice channel ${voiceId}`);
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.InitQueue, this);
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
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the equalizer settings applied to the currently playing track
   * @param equalizer An array of objects that conforms to the Bands type that define volumes at different frequencies
   * @returns Promise<DamonJsPlayer>
   */
  public async setEqualizer(equalizer: Band[]): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setEqualizer(equalizer);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the karaoke settings applied to the currently playing track
   * @param karaoke An object that conforms to the KaraokeSettings type that defines a range of frequencies to mute
   * @returns Promise<DamonJsPlayer>
   */
  public async setKaraoke(karaoke?: KaraokeSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setKaraoke(karaoke);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the timescale settings applied to the currently playing track
   * @param timescale An object that conforms to the TimescaleSettings type that defines the time signature to play the audio at
   * @returns Promise<DamonJsPlayer>
   */
  public async setTimescale(timescale?: TimescaleSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setTimescale(timescale);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the tremolo settings applied to the currently playing track
   * @param tremolo An object that conforms to the FreqSettings type that defines an oscillation in volume
   * @returns Promise<DamonJsPlayer>
   */
  public async setTremolo(tremolo?: FreqSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setTremolo(tremolo);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the vibrato settings applied to the currently playing track
   * @param vibrato An object that conforms to the FreqSettings type that defines an oscillation in pitch
   * @returns Promise<DamonJsPlayer>
   */
  public async setVibrato(vibrato?: FreqSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setVibrato(vibrato);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the rotation settings applied to the currently playing track
   * @param rotation An object that conforms to the RotationSettings type that defines the frequency of audio rotating round the listener
   * @returns Promise<DamonJsPlayer>
   */
  public async setRotation(rotation?: RotationSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setRotation(rotation);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the distortion settings applied to the currently playing track
   * @param distortion An object that conforms to DistortionSettings that defines distortions in the audio
   * @returns Promise<DamonJsPlayer>
   */
  public async setDistortion(distortion: DistortionSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setDistortion(distortion);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the channel mix settings applied to the currently playing track
   * @param channelMix An object that conforms to ChannelMixSettings that defines how much the left and right channels affect each other (setting all factors to 0.5 causes both channels to get the same audio)
   * @returns Promise<DamonJsPlayer>
   */
  public async setChannelMix(channelMix: ChannelMixSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setChannelMix(channelMix);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the low pass settings applied to the currently playing track
   * @param lowPass An object that conforms to LowPassSettings that defines the amount of suppression on higher frequencies
   * @returns Promise<DamonJsPlayer>
   */
  public async setLowPass(lowPass: LowPassSettings): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.setLowPass(lowPass);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Change the all filter settings applied to the currently playing track
   * @param filters An object that conforms to FilterOptions that defines all filters to apply/modify
   * @returns Promise<DamonJsPlayer>
   */
  public async setFilters(filters: FilterOptions): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.setFilters(filters);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Move player to another node
   * @param name? Name of node to move to, or the default ideal node
   * @returns true if the player was moved, false if not
   */
  public async move(name?: string): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    await this.player.move(name);
    this.emit(Events.InitQueue, this);
    return this;
  }

  /**
   * Destroy the player
   * @returns Promise<DamonJsPlayer>
   */
  async destroy(): Promise<DamonJsPlayer> {
    return this.handlePlayerDestroy();
  }
  public emit<K extends keyof DamonJsEvents>(event: K, ...args: DamonJsEvents[K]): void {
    this.damonjs.emit(event, ...args);
  }
}
