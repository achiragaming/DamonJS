// import { NodeOption, PlayerUpdate, ShoukakuOptions, TrackExceptionEvent, WebSocketClosedEvent } from "shoukaku";
import { DamonJsTrack } from './Managers/Supports/DamonJsTrack';
import { DamonJsQueue } from './Managers/Supports/DamonJsQueue';
import { DamonJsPlayer } from './Managers/DamonJsPlayer';
import Plugins from './Modules/Plugins';
import d from '../package.json';
export * from './DamonJs';
export { DamonJsTrack, DamonJsQueue, DamonJsPlayer, Plugins };
export * from './Modules/Interfaces';

export const version = d.version;
