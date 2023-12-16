import { DamonJs, Events } from '../Index';
import { PlayerMovedState, DamonJsPlugin as Plugin } from '../Modules/Interfaces';

export class DamonJsPlugin extends Plugin {
  /**
   * DamonJs instance.
   */
  public kazagumo: DamonJs | null = null;

  /**
   * Initialize the plugin.
   * @param client Discord.Client
   */
  constructor(public client: any) {
    super();
  }

  /**
   * Load the plugin.
   * @param kazagumo DamonJs
   */
  public load(kazagumo: DamonJs): void {
    this.kazagumo = kazagumo;
    this.client.on('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
  }

  /**
   * Unload the plugin.
   */
  public unload(): void {
    this.client.removeListener('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
    this.kazagumo = null;
  }

  private onVoiceStateUpdate(oldState: any, newState: any): void {
    if (!this.kazagumo || oldState.id !== this.client.user.id) return;

    const newChannelId = newState.channelID || newState.channelId;
    const oldChannelId = oldState.channelID || oldState.channelId;
    const guildId = newState.guild.id;

    const player = this.kazagumo.players.get(guildId);
    if (!player) return;

    let state: PlayerMovedState = PlayerMovedState.Unknown;
    if (!oldChannelId && newChannelId) state = PlayerMovedState.Joined;
    else if (oldChannelId && !newChannelId) state = PlayerMovedState.Left;
    else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) state = PlayerMovedState.Moved;

    if (state === PlayerMovedState.Unknown) return;

    this.kazagumo.emit(Events.PlayerMoved, player, state, { oldChannelId, newChannelId });
  }
}
