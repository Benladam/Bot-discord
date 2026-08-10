require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const { DisTube } = require("distube");
const { YouTubePlugin } = require("@distube/youtube");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnFinish: true,
    plugins: [
        new YouTubePlugin()
    ]
});

client.once(Events.ClientReady, () => {
    console.log(`${client.user.tag} est connecté !`);
});

client.on(Events.MessageCreate, async message => {

    if (message.author.bot) return;
    if (!message.guild) return;

    const args = message.content.split(" ");

    const cmd = args.shift().toLowerCase();

    if (cmd === "!play") {

        const voice = message.member.voice.channel;

        if (!voice)
            return message.reply("Tu dois être dans un salon vocal.");

        const music = args.join(" ");

        if (!music)
            return message.reply("Donne un nom de musique.");

        distube.play(voice, music, {
            member: message.member,
            textChannel: message.channel
        });
    }

    if (cmd === "!skip") {

        const queue = distube.getQueue(message);

        if (!queue)
            return message.reply("Aucune musique.");

        queue.skip();

        message.reply("Musique passée.");
    }

    if (cmd === "!stop") {

        const queue = distube.getQueue(message);

        if (!queue)
            return message.reply("Aucune musique.");

        queue.stop();

        message.reply("Lecture arrêtée.");
    }

    if (cmd === "!pause") {

        const queue = distube.getQueue(message);

        if (!queue)
            return message.reply("Aucune musique.");

        queue.pause();

        message.reply("Lecture en pause.");
    }

    if (cmd === "!resume") {

        const queue = distube.getQueue(message);

        if (!queue)
            return message.reply("Aucune musique.");

        queue.resume();

        message.reply("Lecture reprise.");
    }

    if (cmd === "!queue") {

        const queue = distube.getQueue(message);

        if (!queue)
            return message.reply("Aucune musique.");

        message.reply(
            queue.songs
                .map((song, i) => `${i + 1}. ${song.name}`)
                .join("\n")
        );
    }
});

distube
.on("playSong", (queue, song) => {
    queue.textChannel.send(
        `▶️ Lecture : **${song.name}**`
    );
})

.on("addSong", (queue, song) => {
    queue.textChannel.send(
        `➕ Ajoutée : **${song.name}**`
    );
})

.on("error", (channel, error) => {
    console.error(error);
});

client.login(process.env.TOKEN);