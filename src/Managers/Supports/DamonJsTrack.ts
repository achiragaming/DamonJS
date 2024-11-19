import { DamonJs } from '../../DamonJs';
import {
  RawTrack,
  SupportedSources,
  SourceIDs,
  DamonJsError,
  escapeRegExp,
  ResolveOptions,
  Events,
} from '../../Modules/Interfaces';
import { Track } from 'shoukaku';
import { DamonJsPlayer } from '../DamonJsPlayer';
import { DamonJsUtils } from '../../Modules/Utils';
import { Utils } from 'discord.js';
export class DamonJsTrack {
  /**
   * DamonJs Instance
   */
  public damonjs: DamonJs | undefined;
  /**
   * Track Requester
   */
  public requester: unknown;

  /** Track's Base64 */
  public encoded: string;
  /** Track's source */
  public sourceName: string;
  /** Track's title */
  public title: string;
  /** Track's URI */
  public uri: string | undefined;
  /** Track's identifier */
  public identifier: string;
  /** Whether the track is seekable */
  public isSeekable: boolean;
  /** Whether the track is a stream */
  public isStream: boolean;
  /** Track's author */
  public author: string;
  /** Track's length */
  public length: number;
  /** Track's position (I don't know this) */
  public position: number;
  /** Track's thumbnail, if available */
  public artworkUrl: string | undefined;
  /** The YouTube/soundcloud URI for spotify and other unsupported source */
  public realUri: string | null;
  /** Plugin Information (I don't know this) */
  public pluginInfo: unknown;
  /** International Standard Recording Code */
  public isrc: string | undefined;
  public resolvedBySource: boolean = false;
  public readonly data: Map<string, any>;
  constructor(raw: RawTrack, requester: unknown) {
    this.damonjs = undefined;
    this.data = new Map();
    this.encoded = raw.encoded;
    this.sourceName = raw.info.sourceName;
    this.title = raw.info.title;
    this.uri = raw.info.uri;
    this.identifier = raw.info.identifier;
    this.isSeekable = raw.info.isSeekable;
    this.isStream = raw.info.isStream;
    this.author = raw.info.author;
    this.length = raw.info.length;
    this.position = raw.info.position;
    this.artworkUrl = raw.info.artworkUrl;
    this.isrc = raw.info.isrc;
    this.realUri = SupportedSources.includes(this.sourceName) && this.uri ? this.uri : null;
    this.pluginInfo = raw.pluginInfo;
    this.requester = requester;
  }

  /**
   * Get json of this track
   * @returns {RawTrack}
   */
  public getRaw(): RawTrack {
    return {
      encoded: this.encoded,
      info: {
        identifier: this.identifier,
        isSeekable: this.isSeekable,
        author: this.author,
        length: this.length,
        isStream: this.isStream,
        position: this.position,
        title: this.title,
        uri: this.uri,
        isrc: this.isrc,
        artworkUrl: this.artworkUrl,
        sourceName: this.sourceName,
      },
      pluginInfo: this.pluginInfo,
    };
  }

  /**
   * Set damonjs instance
   * @param damonjs DamonJs instance
   * @returns DamonJsTrack
   */
  setDamonJs(damonjs: DamonJs): DamonJsTrack {
    this.damonjs = damonjs;
    if (this.sourceName === 'youtube' && this.identifier)
      this.artworkUrl = `https://img.youtube.com/vi/${this.identifier}/${
        damonjs.DamonJsOptions.defaultYoutubeThumbnail ?? 'hqdefault'
      }.jpg`;

    return this;
  }

  /**
   * Whether the track is ready to play or need to be solved
   */
  get readyToPlay(): boolean {
    return (
      this.damonjs !== undefined &&
      !!this.encoded &&
      !!this.sourceName &&
      !!this.identifier &&
      !!this.author &&
      !!this.length &&
      !!this.title &&
      !!this.uri &&
      !!this.realUri
    );
  }

  /**
   * Resolve the track
   * @param options Resolve options
   * @returns Promise<DamonJsTrack>
   */
  public async resolve(options: ResolveOptions): Promise<DamonJsTrack> {
    if (!this.damonjs) throw new DamonJsError(1, 'DamonJs is not set');
    if (
      this.damonjs.DamonJsOptions.trackResolver &&
      typeof this.damonjs.DamonJsOptions.trackResolver === 'function' &&
      (await this.damonjs.DamonJsOptions.trackResolver.bind(this)(options))
    )
      return this;
    const resolveSource = this.damonjs.DamonJsOptions?.sourceForceResolve?.includes(this.sourceName);
    const { forceResolve, overwrite } = options ? options : { forceResolve: false, overwrite: false };

    if (!forceResolve && this.readyToPlay) return this;
    if (resolveSource && this.resolvedBySource) return this;
    if (resolveSource) {
      this.resolvedBySource = true;
      return this;
    }

    this.damonjs.emit(
      Events.Debug,
      options.player,
      `Resolving ${this.sourceName} track ${this.title}; Source: ${this.sourceName}`,
    );

    const result =
      (await this.getTrack(
        options.player,
        (SourceIDs as any)[this.damonjs.DamonJsOptions.defaultSearchEngine || 'youtube'] || 'yt',
      ).catch(() => null)) || (await this.getTrack(options.player, 'youtube').catch(() => null));
    if (!result) throw new DamonJsError(2, 'No results found');

    this.encoded = result.encoded;
    this.realUri = result.info.uri || null;
    this.length = result.info.length;

    if (overwrite || resolveSource) {
      this.title = result.info.title;
      this.identifier = result.info.identifier;
      this.isSeekable = result.info.isSeekable;
      this.author = result.info.author;
      this.length = result.info.length;
      this.isStream = result.info.isStream;
      this.uri = result.info.uri;
    }
    return this;
  }
  private async getTrack(player: DamonJsPlayer, source: any): Promise<Track> {
    if (!this.damonjs) throw new DamonJsError(1, 'DamonJs is not set');
    const query = [this.author, this.title].filter((x) => !!x).join(' - ');
    const result = await player.search(`${query}`, { requester: this.requester, engine: source });
    if (!result || !result.tracks.length) throw new DamonJsError(2, 'No results found');
    const shoukakUTracks = result.tracks.map((track) => DamonJsUtils.convertDamonJsTrackToTrack(track));
    return shoukakUTracks[0];
  }
}
