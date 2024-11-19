// import { NodeOption, PlayerUpdate, ShoukakuOptions, TrackExceptionEvent, WebSocketClosedEvent } from "shoukaku";
import { DamonJsTrack } from './src/Managers/Supports/DamonJsTrack';
import { DamonJsQueue } from './src/Managers/Supports/DamonJsQueue';
import { DamonJsPlayer } from './src/Managers/DamonJsPlayer';
import Plugins from './src/Modules/Plugins';
import packageJson from './package.json';
export * from './src/DamonJs';
export { DamonJsTrack, DamonJsQueue, DamonJsPlayer, Plugins };
export * from './src/Modules/Interfaces';

export const version = packageJson.version;
