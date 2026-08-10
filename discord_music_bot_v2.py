import discord
from discord.ext import commands
import yt_dlp
import asyncio
from collections import deque
import os
from dotenv import load_dotenv
import logging

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Charger les variables d'environnement
load_dotenv()

TOKEN = os.getenv('DISCORD_TOKEN')
PREFIX = os.getenv('COMMAND_PREFIX', '!')
FFMPEG_PATH = os.getenv('FFMPEG_PATH', '/usr/bin/ffmpeg')

# Vérifier le token
if not TOKEN:
    logger.error("❌ DISCORD_TOKEN non trouvé dans les variables d'environnement!")
    logger.error("Créez un fichier .env avec DISCORD_TOKEN=votre_token")
    exit(1)

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
bot = commands.Bot(command_prefix=PREFIX, intents=intents, help_command=None)

# Classe pour gérer la queue et la lecture
class MusicPlayer:
    def __init__(self):
        self.queue = deque()
        self.current = None
        self.is_playing = False
        self.is_paused = False
        self.volume = 0.5
        self.loop_mode = False  # 0: pas de boucle, 1: boucle une chanson, 2: boucle tout

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
        embed = discord.Embed(
            title="🎵 Fin de la playlist",
            description="La file d'attente est vide",
            color=discord.Color.greyple()
        )
        try:
            await ctx.send(embed=embed)
        except:
            pass
        return

    song_info = player.get_next()
    
    try:
        # Télécharger les infos de la chanson
        with yt_dlp.YoutubeDL(YT_DLP_OPTIONS) as ydl:
            info = ydl.extract_info(song_info['url'], download=False)
            url = info['url']
            title = info.get('title', 'Musique inconnue')
            duration = info.get('duration', 0)
        
        # Créer une source audio
        source = discord.FFmpegPCMAudio(url, **FFMPEG_OPTIONS)
        source = discord.PCMVolumeTransformer(source, volume=player.volume)
        
        # Callback quand la musique se termine
        def after_playing(error):
            if error:
                logger.error(f"Erreur de lecture: {error}")
            try:
                asyncio.run_coroutine_threadsafe(play_next(ctx), bot.loop)
            except:
                pass
        
        # Jouer la musique
        if ctx.voice_client:
            ctx.voice_client.play(source, after=after_playing)
            player.is_playing = True
            player.current = title
            
            # Format duration
            mins, secs = divmod(duration, 60)
            duration_str = f"{int(mins)}:{int(secs):02d}"
            
            embed = discord.Embed(
                title="🎵 En cours de lecture",
                description=f"**{title}**",
                color=discord.Color.blue()
            )
            embed.add_field(name="Durée", value=duration_str, inline=True)
            embed.add_field(name="Queue restante", value=str(len(player.queue)), inline=True)
            await ctx.send(embed=embed)
        
    except Exception as e:
        logger.error(f"Erreur lors de la lecture: {e}")
        embed = discord.Embed(
            title="❌ Erreur",
            description=f"Impossible de lire la musique: {str(e)[:100]}",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
        await play_next(ctx)

@bot.event
async def on_ready():
    logger.info(f"✅ Bot connecté en tant que {bot.user}")
    activity = discord.Activity(type=discord.ActivityType.listening, name=f"{PREFIX}help")
    await bot.change_presence(activity=activity)

@bot.event
async def on_command_error(ctx, error):
    """Gestion globale des erreurs"""
    if isinstance(error, commands.MissingRequiredArgument):
        embed = discord.Embed(
            title="❌ Argument manquant",
            description=f"Utilisation: `{PREFIX}{ctx.invoked_subcommand or ctx.command} {error.param}`",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
    elif isinstance(error, commands.CommandNotFound):
        embed = discord.Embed(
            title="❌ Commande introuvable",
            description=f"Tapez `{PREFIX}help` pour voir les commandes disponibles",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
    else:
        logger.error(f"Erreur: {error}")

@bot.command(name='play', help='Joue une musique: !play [lien ou recherche]')
async def play(ctx, *, query):
    """Ajoute une musique à la queue et la joue"""
    
    if not ctx.author.voice:
        embed = discord.Embed(
            title="❌ Erreur",
            description="Vous devez être dans un canal vocal !",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
        return
    
    # Rejoindre le canal vocal
    if ctx.voice_client is None:
        try:
            await ctx.author.voice.channel.connect()
        except Exception as e:
            embed = discord.Embed(
                title="❌ Erreur",
                description=f"Impossible de rejoindre le canal: {str(e)}",
                color=discord.Color.red()
            )
            await ctx.send(embed=embed)
            return
    
    player = get_player(ctx.guild.id)
    
    # Chercher la musique
    embed = discord.Embed(
        title="🔍 Recherche",
        description=f"Recherche de: `{query}`",
        color=discord.Color.orange()
    )
    msg = await ctx.send(embed=embed)
    
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
            await msg.edit(embed=embed)
    
    except Exception as e:
        logger.error(f"Erreur de recherche: {e}")
        embed = discord.Embed(
            title="❌ Erreur",
            description=f"Impossible de trouver la musique: {str(e)[:100]}",
            color=discord.Color.red()
        )
        await msg.edit(embed=embed)

@bot.command(name='pause', help='Met en pause la musique')
async def pause(ctx):
    """Met en pause la musique"""
    if ctx.voice_client and ctx.voice_client.is_playing():
        ctx.voice_client.pause()
        get_player(ctx.guild.id).is_paused = True
        embed = discord.Embed(title="⏸️ Musique mise en pause", color=discord.Color.yellow())
        await ctx.send(embed=embed)
    else:
        embed = discord.Embed(title="❌ Aucune musique en cours de lecture", color=discord.Color.red())
        await ctx.send(embed=embed)

@bot.command(name='resume', help='Reprend la musique')
async def resume(ctx):
    """Reprend la musique"""
    if ctx.voice_client and ctx.voice_client.is_paused():
        ctx.voice_client.resume()
        get_player(ctx.guild.id).is_paused = False
        embed = discord.Embed(title="▶️ Musique reprise", color=discord.Color.green())
        await ctx.send(embed=embed)
    else:
        embed = discord.Embed(title="❌ Aucune musique en pause", color=discord.Color.red())
        await ctx.send(embed=embed)

@bot.command(name='stop', help='Arrête la musique et vide la queue')
async def stop(ctx):
    """Arrête la musique et vide la queue"""
    if ctx.voice_client:
        player = get_player(ctx.guild.id)
        player.clear_queue()
        ctx.voice_client.stop()
        embed = discord.Embed(title="⏹️ Musique arrêtée", description="Queue vidée", color=discord.Color.red())
        await ctx.send(embed=embed)
    else:
        embed = discord.Embed(title="❌ Le bot n'est pas connecté", color=discord.Color.red())
        await ctx.send(embed=embed)

@bot.command(name='skip', help='Passe à la prochaine musique')
async def skip(ctx):
    """Passe à la prochaine musique"""
    if ctx.voice_client and ctx.voice_client.is_playing():
        ctx.voice_client.stop()
        embed = discord.Embed(title="⏭️ Passage à la prochaine musique...", color=discord.Color.blue())
        await ctx.send(embed=embed)
    else:
        embed = discord.Embed(title="❌ Aucune musique en cours de lecture", color=discord.Color.red())
        await ctx.send(embed=embed)

@bot.command(name='queue', help='Affiche la file d\'attente')
async def queue(ctx):
    """Affiche la queue"""
    player = get_player(ctx.guild.id)
    
    if not player.queue and not player.is_playing:
        embed = discord.Embed(title="🎵 La queue est vide", color=discord.Color.greyple())
        await ctx.send(embed=embed)
        return
    
    embed = discord.Embed(
        title="📋 File d'attente",
        color=discord.Color.purple()
    )
    
    if player.current:
        embed.add_field(
            name="▶️ En cours",
            value=f"**{player.current}**",
            inline=False
        )
    
    if player.queue:
        queue_list = list(player.queue)[:10]
        queue_text = "\n".join(
            [f"{i+1}. {song['title'][:60]}" for i, song in enumerate(queue_list)]
        )
        
        if len(player.queue) > 10:
            queue_text += f"\n... et {len(player.queue) - 10} autres"
        
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
        embed = discord.Embed(
            title="❌ Erreur",
            description="Le volume doit être entre 0 et 100",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
        return
    
    player = get_player(ctx.guild.id)
    player.volume = vol / 100
    
    if ctx.voice_client and ctx.voice_client.source:
        ctx.voice_client.source.volume = player.volume
    
    embed = discord.Embed(
        title="🔊 Volume",
        description=f"Volume réglé à {vol}%",
        color=discord.Color.blue()
    )
    await ctx.send(embed=embed)

@bot.command(name='leave', help='Le bot quitte le canal vocal')
async def leave(ctx):
    """Quitte le canal vocal"""
    if ctx.voice_client:
        player = get_player(ctx.guild.id)
        player.clear_queue()
        await ctx.voice_client.disconnect()
        embed = discord.Embed(title="👋 Déconnecté du canal vocal", color=discord.Color.greyple())
        await ctx.send(embed=embed)
    else:
        embed = discord.Embed(title="❌ Le bot n'est pas connecté", color=discord.Color.red())
        await ctx.send(embed=embed)

@bot.command(name='help', help='Affiche l\'aide')
async def help_command(ctx):
    """Affiche l'aide"""
    embed = discord.Embed(
        title="🎵 Aide du Bot Musique",
        description=f"Préfixe des commandes: `{PREFIX}`",
        color=discord.Color.blue()
    )
    
    commands_info = [
        (f"{PREFIX}play [lien/recherche]", "Joue une musique (YouTube, URL, texte)"),
        (f"{PREFIX}pause", "Met en pause"),
        (f"{PREFIX}resume", "Reprend la lecture"),
        (f"{PREFIX}skip", "Passe à la suivante"),
        (f"{PREFIX}stop", "Arrête et vide la queue"),
        (f"{PREFIX}queue", "Affiche la file d'attente"),
        (f"{PREFIX}volume [0-100]", "Ajuste le volume"),
        (f"{PREFIX}leave", "Le bot quitte le canal"),
        (f"{PREFIX}help", "Affiche cette aide"),
    ]
    
    for cmd, desc in commands_info:
        embed.add_field(name=cmd, value=desc, inline=False)
    
    embed.set_footer(text="Bon amusement! 🎶")
    await ctx.send(embed=embed)

# Lancer le bot
if __name__ == "__main__":
    try:
        bot.run(TOKEN)
    except Exception as e:
        logger.error(f"Erreur au démarrage du bot: {e}")
        exit(1)
