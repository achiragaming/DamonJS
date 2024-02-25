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

export class DamonJsPlayer {
  private options: DamonJsPlayerOptions;
  public textId: Snowflake;
  private readonly damonjs: DamonJs;
  public player: Player;
  private isTrackPlaying: boolean;
  public shoukaku: Shoukaku;
  public connection: Connection;
  public readonly queue: DamonJsQueue;
  public state: PlayerState = PlayerState.CONNECTING;
  public loop: LoopState = LoopState.None;
  public readonly data: Map<string, any>;
  public search: (query: string, options: DamonJsSearchOptions) => Promise<DamonJsSearchResult>;
  public readonly errors: { exceptions: number[]; stuck: number[] };

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
    this.queue = new DamonJsQueue(this);
    this.data = new Map(options.data);
    this.textId = this.options.textId;
    this.errors = { exceptions: [], stuck: [] };
    this.search = (query, searchOptions) => this.damonjs.search(query, searchOptions, this);
    this.isTrackPlaying = false;
  }

  public async init() {
    if (this.state === PlayerState.CONNECTED)
      throw new DamonJsError(1, 'Player is already initialized or initializing');
    await this.setGlobalVolume(this.options.volume);
    this.initEventListeners();
    this.state = PlayerState.CONNECTED;
  }

  private initEventListeners() {
    const eventHandlers = {
      start: async () => {
        if (!this.queue.current) return this.emit(Events.Debug, this, `No track to start ${this.guildId}`);
        this.isTrackPlaying = true;
        this.player.paused = false;
        this.emit(Events.PlayerStart, this, this.queue.current);
      },
      end: async (data: TrackEndEvent) => {
        if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED) {
          return this.emit(Events.Debug, this, `Player ${this.guildId} destroyed from end event`);
        }
        this.isTrackPlaying = false;
        this.emit(Events.PlayerEnd, this);
        if (data.reason === 'replaced') {
          return this.emit(Events.PlayerEmpty, this);
        }
        await this.handleTrackEnd(data);
      },
      closed: async (data: WebSocketClosedEvent) => {
        this.emit(Events.PlayerClosed, this, data);
      },
      exception: async (data: TrackExceptionEvent) => {
        await this.handleTrackException(data);
      },
      update: async (data: PlayerUpdate) => {
        if (!this.queue.current) return this.emit(Events.Debug, this, `No Track to Update ${this.guildId}`);
        this.queue.current.position = data.state.position || 0;
        this.emit(Events.PlayerUpdate, this, this.queue.current, data);
      },
      stuck: async (data: TrackStuckEvent) => {
        await this.handleTrackStuck(data);
      },
      resumed: async () => {
        this.emit(Events.PlayerResumed, this);
      },
    };

    this.player.on('start', eventHandlers.start);
    this.player.on('end', eventHandlers.end);
    this.player.on('closed', eventHandlers.closed);
    this.player.on('exception', eventHandlers.exception);
    this.player.on('update', eventHandlers.update);
    this.player.on('stuck', eventHandlers.stuck);
    this.player.on('resumed', eventHandlers.resumed);
  }

  private async handleTrackEnd(data: TrackEndEvent) {
    if (this.loop === LoopState.Track) {
      this.queue.currentId = this.queue.currentId;
    } else if (this.loop === LoopState.Queue && this.queue.isEnd) {
      this.queue.currentId = 0;
    } else {
      this.queue.currentId++;
    }

    if (!this.queue.current) {
      this.emit(Events.PlayerEmpty, this);
      return;
    }

    await this.play().catch(this.handlePlayError);
    return this;
  }

  private async handleTrackException(data: TrackExceptionEvent) {
    const nowTime = Date.now();
    const exceptionArr = this.errors.exceptions;
    const maxTime = this.damonjs.DamonJsOptions.exceptions.time;
    const exceptions = exceptionArr.filter((time: number) => nowTime - time < maxTime);
    if (exceptions.length > this.damonjs.DamonJsOptions.exceptions.max) return;
    else {
      exceptions.push(nowTime);
      this.errors.exceptions = exceptions;
    }
    if (this.damonjs.DamonJsOptions.skipOnException) {
      try {
        await this.skip();
      } catch (error) {
        return this.emit(Events.PlayerEmpty, this);
      }
    }
    this.emit(Events.PlayerException, this, data);
    return this;
  }

  private async handleTrackStuck(data: TrackStuckEvent) {
    const nowTime = Date.now();
    const stuckErr = this.errors.stuck;
    const maxTime = this.damonjs.DamonJsOptions.stuck.time;
    const stucks = stuckErr.filter((time: number) => nowTime - time < maxTime);
    if (stucks.length > this.damonjs.DamonJsOptions.stuck.max) return;
    else {
      stucks.push(nowTime);
      this.errors.stuck = stucks;
    }
    if (this.damonjs.DamonJsOptions.skipOnStuck) {
      try {
        await this.skip();
      } catch (error) {
        return this.emit(Events.PlayerEmpty, this);
      }
    }
    this.emit(Events.PlayerStuck, this, data);
    return this;
  }

  private async handlePlayError(error: Error) {
    this.emit(Events.Debug, this, error.message);

    if (this.damonjs.DamonJsOptions.skipOnPlayError) {
      try {
        await this.skip();
      } catch (error) {
        return this.emit(Events.PlayerEmpty, this);
      }
    }
    return this;
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
   * @param {DamonJsTrack} track Track to play
   * @param {PlayOptions} options Play options
   * @returns {Promise<DamonJsPlayer>}
   */
  public async play(tracks?: DamonJsTrack[], options?: PlayOptions): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');

    if (!tracks && !this.queue.totalSize) throw new DamonJsError(1, 'No track is available to play');

    if (!options) options = { replaceCurrent: false };

    if (tracks) {
      this.queue.splice(this.queue.currentId + 1, options.replaceCurrent && this.queue.current ? 1 : 0, ...tracks);
      return this.stopTrack();
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
        throw new DamonJsError(1, `Player ${this.guildId} resolve error: ${resolveResult.message}`);
      }
      const playOptions = { track: current.encoded, options: {} };
      if (options) playOptions.options = { ...options, noReplace: false };
      else playOptions.options = { noReplace: false };
      await this.player.playTrack(playOptions);
    }
    return this;
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
    if (!this.queue[trackId]) {
      throw new DamonJsError(2, 'No songs available for to skip.');
    }
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
    if (!this.queue[trackId]) {
      throw new DamonJsError(2, 'No songs available for previous.');
    }
    await this.skipto(trackId);
    return this;
  }

  /**
   * Skip to a specifc track
   * @param trackId Id of the Track
   * @returns Promise<DamonJsPlayer>
   */
  public async skipto(trackId: number): Promise<DamonJsPlayer> {
    if (this.state === PlayerState.DESTROYED) throw new DamonJsError(1, 'Player is already destroyed');
    if (!this.queue[trackId]) throw new DamonJsError(2, `${trackId} is an invalid track ID.`);
    if (!this.playable) {
      if (this.loop !== LoopState.Track) this.queue.currentId = trackId;
      await this.play();
    } else {
      if (this.loop !== LoopState.Track) this.queue.currentId = trackId - 1;
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
    if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
      throw new DamonJsError(1, 'Player is already destroyed');
    this.state = PlayerState.DESTROYING;
    await this.shoukaku.leaveVoiceChannel(this.guildId);
    this.damonjs.players.delete(this.guildId);
    this.state = PlayerState.DESTROYED;
    this.emit(Events.PlayerDestroy, this);
    this.emit(Events.Debug, this, `Player destroyed; Guild id: ${this.guildId}`);
    return this;
  }
  public emit<K extends keyof DamonJsEvents>(event: K, ...args: DamonJsEvents[K]): void {
    this.damonjs.emit(event, ...args);
  }
}
