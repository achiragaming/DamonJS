import { Track } from 'shoukaku';
import { KazagumoTrack } from '../Managers/Supports/KazagumoTrack';

export class KazagumoUtils {
  static convertKazagumoTrackToTrack(track: KazagumoTrack): Track {
    const { encoded, info, pluginInfo } = track.getRaw();
    return {
      encoded,
      info: {
        author: info.author,
        identifier: info.identifier,
        isSeekable: info.isSeekable,
        isStream: info.isStream,
        length: info.length,
        position: info.position,
        sourceName: info.sourceName,
        title: info.title,
        artworkUrl: info.artworkUrl,
        isrc: info.isrc,
        uri: info.uri,
      },
      pluginInfo,
    };
  }
}
