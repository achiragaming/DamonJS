import { Events, DamonJs, Plugins, SearchResultTypes } from '../src/Index';
import { Shoukaku, Connectors } from 'shoukaku';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';

const { Guilds, GuildVoiceStates, GuildMessages, MessageContent } = GatewayIntentBits;

const Nodes = [
  {
    name: 'owo',
    url: 'localhost:2333',
    auth: 'youshallnotpass',
    secure: false,
  },
];

const client = new Client({ intents: [Guilds, GuildVoiceStates, GuildMessages, MessageContent] });

const kazagumo = new DamonJs(
  {
    defaultSearchEngine: 'youtube',
    plugins: [new Plugins.PlayerMoved(client)],
  },
  new Connectors.DiscordJS(client),
  Nodes,
  {
    moveOnDisconnect: false,
    resume: false,
    resumeTimeout: 30,
    reconnectTries: 2,
    restTimeout: 10000,
  },
);

client.on('ready', () => console.log(client?.user?.tag + ' Ready!'));

kazagumo.shoukaku.on('ready', (name) => console.log(`Lavalink ${name}: Ready!`));
kazagumo.shoukaku.on('error', (name, error) => console.error(`Lavalink ${name}: Error Caught,`, error));
kazagumo.shoukaku.on('close', (name, code, reason) =>
  console.warn(`Lavalink ${name}: Closed, Code ${code}, Reason ${reason || 'No reason'}`),
);
kazagumo.shoukaku.on('debug', (name, info) => console.debug(`Lavalink ${name}: Debug,`, info));

kazagumo.on(Events.PlayerCreate, async (player) => {
  const channel =
    client.channels.cache.get(player.textId) || (await client.channels.fetch(player.textId).catch(() => null));
  if (channel && channel.isTextBased()) {
    const message = await channel.send({ content: 'Created a player' });
    player.data.set('message', message);
  }
});
kazagumo.on(Events.PlayerStart, async (player, track) => {
  const message = player.data.get('message');
  message && (await message.edit({ content: `Started playing ${track.title}` }));
});
kazagumo.on(Events.PlayerEnd, async (player) => {
  const message = player.data.get('message');
  message && (await message.edit({ content: `Finished playing` }));
});

kazagumo.on(Events.PlayerEmpty, async (player) => {
  const message = player.data.get('message');
  message && (await message.edit({ content: `Destroyed player due to inactivity.` }));
});

client.on('messageCreate', async (message) => {
  const guild = message?.guild;
  const channel = message?.channel;
  if (client?.user?.id && guild && guild.members?.me && channel?.type === ChannelType.GuildText) {
    if (message.content.startsWith('!play')) {
      const args = message.content.split(' ');
      const query = args.slice(1).join(' ');

      const channel = message.member?.voice.channel;
      if (!channel) {
        await message.reply({ content: 'You need to be in a voice channel to use this command!' });
        return;
      }
      const player = await kazagumo.createPlayer({
        guildId: message.guild.id,
        textId: message.channel.id,
        voiceId: channel.id,
        volume: 40,
        shardId: message.guild.shardId,
      });

      const result = await player.search(query, { requester: message.author });
      if (!result.tracks.length) {
        await message.reply({ content: 'No results found!' });
        return;
      }

      if (result.type === SearchResultTypes.Playlist) player.queue.add(result.tracks);
      else player.queue.add(result.tracks[0]);

      if (!player.playable) await player.play(); // only use player.playable to play because if you use player.playing you can get unexpected bugs
      if (player.paused) await player.pause(!player.paused); // if player is paused its gonna play
      await message.reply({
        content:
          result.type === SearchResultTypes.Playlist
            ? `Queued ${result.tracks.length} from ${result.playlistInfo?.info.name}`
            : `Queued ${result.tracks[0].title}`,
      });
      return;
    }
    if (message.content.startsWith('!skip')) {
      const player = kazagumo.players.get(message.guild.id);
      if (!player) {
        await message.reply({ content: 'No player found!' });
        return;
      }
      await player.skip();

      await message.reply({
        content: `skipped the current track`,
      });
      return;
    }
    if (message.content.startsWith('!previous')) {
      const player = kazagumo.players.get(message.guild.id);
      if (!player) {
        await message.reply({ content: 'No player found!' });
        return;
      }
      await player.previous();

      await message.reply({
        content: `skipped to the previous track`,
      });
      return;
    }
  }
});

client.login('');
