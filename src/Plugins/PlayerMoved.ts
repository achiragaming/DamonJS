import { DamonJs, Events } from '../../Index';
import { PlayerMovedState, DamonJsPlugin as Plugin } from '../Modules/Interfaces';

export class DamonJsPlugin extends Plugin {
  /**
   * DamonJs instance.
   */
  public damonjs: DamonJs | null = null;

  /**
   * Initialize the plugin.
   * @param client Discord.Client
   */
  constructor(public client: any) {
    super();
  }

  /**
   * Load the plugin.
   * @param damonjs DamonJs
   */
  public load(damonjs: DamonJs): void {
    this.damonjs = damonjs;
    this.client.on('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
  }

  /**
   * Unload the plugin.
   */
  public unload(): void {
    this.client.removeListener('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
    this.damonjs = null;
  }

  private onVoiceStateUpdate(oldState: any, newState: any): void {
    if (!this.damonjs || oldState.id !== this.client.user.id) return;

    const newChannelId = newState.channelID || newState.channelId;
    const oldChannelId = oldState.channelID || oldState.channelId;
    const guildId = newState.guild.id;

    const player = this.damonjs.players.get(guildId);
    if (!player) return;

    let state: PlayerMovedState = PlayerMovedState.Unknown;
    if (!oldChannelId && newChannelId) state = PlayerMovedState.Joined;
    else if (oldChannelId && !newChannelId) state = PlayerMovedState.Left;
    else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) state = PlayerMovedState.Moved;

    if (state === PlayerMovedState.Unknown) return;

    this.damonjs.emit(Events.PlayerMoved, player, state, { oldChannelId, newChannelId });
  }
}
