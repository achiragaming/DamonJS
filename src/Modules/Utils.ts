import { Track } from 'shoukaku';
import { DamonJsTrack } from '../Managers/Supports/DamonJsTrack';

export class DamonJsUtils {
  static convertDamonJsTrackToTrack(track: DamonJsTrack): Track {
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
