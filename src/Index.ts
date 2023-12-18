// import { NodeOption, PlayerUpdate, ShoukakuOptions, TrackExceptionEvent, WebSocketClosedEvent } from "shoukaku";
import {DamonJsTrack } from './Managers/Supports/DamonJsTrack';
import { DamonJsQueue } from './Managers/Supports/DamonJsQueue';
import { DamonJsPlayer } from './Managers/DamonJsPlayer';
import Plugins from './Modules/Plugins';


export * from './DamonJs';
export { DamonJsTrack, DamonJsQueue, DamonJsPlayer, Plugins };
export * from './Modules/Interfaces';

export const version = '1.2.8';
 