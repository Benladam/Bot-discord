import discord
from discord.ext import commands
import yt_dlp
import asyncio
from collections import deque

# Configuration
TOKEN = "VOTRE_TOKEN_BOT_ICI"  # À remplacer par votre token
FFMPEG_PATH = "/usr/bin/ffmpeg"

# Options yt-dlp
YT_DLP_OPTIONS = {
    'format': 'bestaudio/best',
    'noplaylist': True,
    'default_search': 'ytsearch',
    'quiet': False,
    'no_warnings': False,
}

FFMPEG_OPTIONS = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn',
}

# Intents
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True

# Bot
bot = commands.Bot(command_prefix='!', intents=intents)

# Classe pour gérer la queue et la lecture
class MusicPlayer:
    def __init__(self):
        self.queue = deque()
        self.current = None
        self.is_playing = False
        self.is_paused = False
        self.volume = 0.5

    def add_to_queue(self, song_info):
        self.queue.append(song_info)

    def get_next(self):
        if self.queue:
            return self.queue.popleft()
        return None

    def clear_queue(self):
        self.queue.clear()

# Dictionnaire pour stocker les players par serveur
players = {}

def get_player(guild_id):
    if guild_id not in players:
        players[guild_id] = MusicPlayer()
    return players[guild_id]

async def play_next(ctx):
    """Joue la prochaine chanson de la queue"""
    player = get_player(ctx.guild.id)
    
    if not player.queue:
        player.is_playing = False
        await ctx.send("🎵 Fin de la playlist !")
        return

    song_info = player.get_next()
    
    try:
        # Télécharger les infos de la chanson
        with yt_dlp.YoutubeDL(YT_DLP_OPTIONS) as ydl:
            info = ydl.extract_info(song_info['url'], download=False)
            url = info['url']
            title = info.get('title', 'Musique inconnue')
        
        # Créer une source audio
        source = discord.FFmpegPCMAudio(url, **FFMPEG_OPTIONS)
        source = discord.PCMVolumeTransformer(source, volume=player.volume)
        
        # Callback quand la musique se termine
        def after_playing(error):
            if error:
                print(f"Erreur: {error}")
            asyncio.run_coroutine_threadsafe(play_next(ctx), bot.loop)
        
        # Jouer la musique
        ctx.voice_client.play(source, after=after_playing)
        player.is_playing = True
        player.current = title
        
        embed = discord.Embed(
            title="🎵 En cours de lecture",
            description=f"**{title}**",
            color=discord.Color.blue()
        )
        embed.add_field(name="Queue restante", value=str(len(player.queue)), inline=False)
        await ctx.send(embed=embed)
        
    except Exception as e:
        await ctx.send(f"❌ Erreur: {str(e)}")
        await play_next(ctx)

@bot.event
async def on_ready():
    print(f"✅ Bot connecté en tant que {bot.user}")

@bot.command(name='play', help='Joue une musique: !play [lien ou recherche]')
async def play(ctx, *, query):
    """Ajoute une musique à la queue et la joue"""
    
    if not ctx.author.voice:
        await ctx.send("❌ Vous devez être dans un canal vocal !")
        return
    
    # Rejoindre le canal vocal
    if ctx.voice_client is None:
        try:
            await ctx.author.voice.channel.connect()
        except Exception as e:
            await ctx.send(f"❌ Impossible de rejoindre le canal: {str(e)}")
            return
    
    player = get_player(ctx.guild.id)
    
    # Chercher la musique
    await ctx.send(f"🔍 Recherche de: `{query}`...")
    
    try:
        with yt_dlp.YoutubeDL(YT_DLP_OPTIONS) as ydl:
            info = ydl.extract_info(query, download=False)
        
        song_info = {
            'url': info['webpage_url'],
            'title': info.get('title', 'Inconnu')
        }
        
        player.add_to_queue(song_info)
        
        if not ctx.voice_client.is_playing():
            await play_next(ctx)
        else:
            embed = discord.Embed(
                title="➕ Ajouté à la queue",
                description=f"**{song_info['title']}**",
                color=discord.Color.green()
            )
            embed.add_field(name="Position", value=str(len(player.queue)), inline=False)
            await ctx.send(embed=embed)
    
    except Exception as e:
        await ctx.send(f"❌ Impossible de trouver la musique: {str(e)}")

@bot.command(name='pause', help='Met en pause la musique')
async def pause(ctx):
    """Met en pause la musique"""
    if ctx.voice_client and ctx.voice_client.is_playing():
        ctx.voice_client.pause()
        get_player(ctx.guild.id).is_paused = True
        await ctx.send("⏸️ Musique mise en pause")
    else:
        await ctx.send("❌ Aucune musique en cours de lecture")

@bot.command(name='resume', help='Reprend la musique')
async def resume(ctx):
    """Reprend la musique"""
    if ctx.voice_client and ctx.voice_client.is_paused():
        ctx.voice_client.resume()
        get_player(ctx.guild.id).is_paused = False
        await ctx.send("▶️ Musique reprise")
    else:
        await ctx.send("❌ Aucune musique en pause")

@bot.command(name='stop', help='Arrête la musique et vide la queue')
async def stop(ctx):
    """Arrête la musique et vide la queue"""
    if ctx.voice_client:
        player = get_player(ctx.guild.id)
        player.clear_queue()
        ctx.voice_client.stop()
        await ctx.send("⏹️ Musique arrêtée et queue vidée")
    else:
        await ctx.send("❌ Le bot n'est pas connecté")

@bot.command(name='skip', help='Passe à la prochaine musique')
async def skip(ctx):
    """Passe à la prochaine musique"""
    if ctx.voice_client and ctx.voice_client.is_playing():
        ctx.voice_client.stop()
        await ctx.send("⏭️ Passage à la prochaine musique...")
    else:
        await ctx.send("❌ Aucune musique en cours de lecture")

@bot.command(name='queue', help='Affiche la file d\'attente')
async def queue(ctx):
    """Affiche la queue"""
    player = get_player(ctx.guild.id)
    
    if not player.queue and not player.is_playing:
        await ctx.send("🎵 La queue est vide")
        return
    
    embed = discord.Embed(
        title="📋 File d'attente",
        color=discord.Color.purple()
    )
    
    if player.current:
        embed.add_field(
            name="En cours",
            value=f"**{player.current}**",
            inline=False
        )
    
    if player.queue:
        queue_text = "\n".join(
            [f"{i+1}. {song['title'][:50]}" for i, song in enumerate(list(player.queue)[:10])]
        )
        embed.add_field(
            name=f"Prochaines ({len(player.queue)})",
            value=queue_text,
            inline=False
        )
    
    await ctx.send(embed=embed)

@bot.command(name='volume', help='Ajuste le volume: !volume [0-100]')
async def volume(ctx, vol: int):
    """Ajuste le volume"""
    if not 0 <= vol <= 100:
        await ctx.send("❌ Le volume doit être entre 0 et 100")
        return
    
    player = get_player(ctx.guild.id)
    player.volume = vol / 100
    
    if ctx.voice_client and ctx.voice_client.source:
        ctx.voice_client.source.volume = player.volume
    
    await ctx.send(f"🔊 Volume réglé à {vol}%")

@bot.command(name='leave', help='Le bot quitte le canal vocal')
async def leave(ctx):
    """Quitte le canal vocal"""
    if ctx.voice_client:
        player = get_player(ctx.guild.id)
        player.clear_queue()
        await ctx.voice_client.disconnect()
        await ctx.send("👋 Déconnecté du canal vocal")
    else:
        await ctx.send("❌ Le bot n'est pas connecté")

@bot.command(name='help', help='Affiche l\'aide')
async def help_command(ctx):
    """Affiche l'aide"""
    embed = discord.Embed(
        title="🎵 Aide du Bot Musique",
        color=discord.Color.blue()
    )
    
    commands_list = {
        "!play [lien/recherche]": "Joue une musique",
        "!pause": "Met en pause",
        "!resume": "Reprend la lecture",
        "!skip": "Passe à la suivante",
        "!stop": "Arrête et vide la queue",
        "!queue": "Affiche la file d'attente",
        "!volume [0-100]": "Ajuste le volume",
        "!leave": "Le bot quitte le canal",
    }
    
    for cmd, desc in commands_list.items():
        embed.add_field(name=cmd, value=desc, inline=False)
    
    await ctx.send(embed=embed)

# Lancer le bot
bot.run(TOKEN)
