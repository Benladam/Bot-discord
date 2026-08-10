# 🚀 Features Bonus pour le Bot Musique

## 1. 🔄 Commande Loop (Boucle)

```python
@bot.command(name='loop', help='Active/désactive la boucle: !loop [off/song/queue]')
async def loop(ctx, mode: str = "off"):
    """Gère le mode de boucle"""
    modes = {"off": 0, "song": 1, "queue": 2}
    
    if mode.lower() not in modes:
        await ctx.send("❌ Mode invalide. Utilisez: off, song ou queue")
        return
    
    player = get_player(ctx.guild.id)
    player.loop_mode = modes[mode.lower()]
    
    mode_names = {0: "Désactivé", 1: "Une chanson", 2: "File d'attente"}
    embed = discord.Embed(
        title="🔄 Mode Boucle",
        description=f"Mode: {mode_names[player.loop_mode]}",
        color=discord.Color.blue()
    )
    await ctx.send(embed=embed)
```

## 2. 🎶 Commande Now Playing (Maintenant)

```python
@bot.command(name='now', help='Affiche la musique en cours')
async def now_playing(ctx):
    """Affiche la musique actuellement en lecture"""
    player = get_player(ctx.guild.id)
    
    if not player.current:
        await ctx.send("❌ Aucune musique en cours de lecture")
        return
    
    embed = discord.Embed(
        title="🎵 Maintenant en lecture",
        description=player.current,
        color=discord.Color.blue()
    )
    await ctx.send(embed=embed)
```

## 3. 🎤 Commande Clear Queue

```python
@bot.command(name='clear', help='Vide la file d\'attente')
async def clear_queue(ctx):
    """Vide la queue"""
    player = get_player(ctx.guild.id)
    queue_size = len(player.queue)
    player.clear_queue()
    
    embed = discord.Embed(
        title="🗑️ Queue vidée",
        description=f"{queue_size} chanson(s) supprimée(s)",
        color=discord.Color.red()
    )
    await ctx.send(embed=embed)
```

## 4. 📊 Commande Shuffle

```python
import random

@bot.command(name='shuffle', help='Mélange la file d\'attente')
async def shuffle(ctx):
    """Mélange la queue"""
    player = get_player(ctx.guild.id)
    
    if not player.queue:
        await ctx.send("❌ La queue est vide")
        return
    
    queue_list = list(player.queue)
    random.shuffle(queue_list)
    player.queue = deque(queue_list)
    
    embed = discord.Embed(
        title="🔀 Queue mélangée",
        description=f"{len(player.queue)} chanson(s)",
        color=discord.Color.green()
    )
    await ctx.send(embed=embed)
```

## 5. ⏰ Commande Playlist Rapide

```python
PLAYLISTS = {
    "workout": [
        "https://www.youtube.com/watch?v=...",
        "https://www.youtube.com/watch?v=...",
    ],
    "chill": [
        "lofi hip hop beats to study to",
        "lo-fi beats 24/7",
    ]
}

@bot.command(name='playlist', help='Charge une playlist: !playlist [nom]')
async def load_playlist(ctx, playlist_name: str):
    """Charge une playlist prédéfinie"""
    if playlist_name.lower() not in PLAYLISTS:
        playlists = ", ".join(PLAYLISTS.keys())
        await ctx.send(f"❌ Playlist inconnue. Disponibles: {playlists}")
        return
    
    player = get_player(ctx.guild.id)
    playlist = PLAYLISTS[playlist_name.lower()]
    
    for song_url in playlist:
        player.add_to_queue({'url': song_url, 'title': 'Musique'})
    
    embed = discord.Embed(
        title="➕ Playlist chargée",
        description=f"**{playlist_name}** - {len(playlist)} chanson(s)",
        color=discord.Color.green()
    )
    await ctx.send(embed=embed)
    
    if not ctx.voice_client.is_playing():
        await play_next(ctx)
```

## 6. 🎯 Commande Remove (Supprimer une chanson de la queue)

```python
@bot.command(name='remove', help='Supprime une chanson: !remove [numéro]')
async def remove(ctx, position: int):
    """Supprime une chanson de la queue"""
    player = get_player(ctx.guild.id)
    
    if position < 1 or position > len(player.queue):
        await ctx.send(f"❌ Position invalide (1-{len(player.queue)})")
        return
    
    queue_list = list(player.queue)
    removed = queue_list.pop(position - 1)
    player.queue = deque(queue_list)
    
    embed = discord.Embed(
        title="🗑️ Chanson supprimée",
        description=removed['title'],
        color=discord.Color.red()
    )
    await ctx.send(embed=embed)
```

## 7. 📈 Commande Stats

```python
@bot.command(name='stats', help='Affiche les statistiques')
async def stats(ctx):
    """Affiche les stats du bot"""
    player = get_player(ctx.guild.id)
    
    embed = discord.Embed(
        title="📊 Statistiques",
        color=discord.Color.purple()
    )
    embed.add_field(name="Utilisateurs connectés", value=str(len(ctx.voice_client.channel.members)) if ctx.voice_client else "0")
    embed.add_field(name="Serveurs", value=str(len(bot.guilds)))
    embed.add_field(name="Queue actuelle", value=str(len(player.queue)))
    embed.add_field(name="Volume", value=f"{int(player.volume * 100)}%")
    embed.add_field(name="État", value="▶️ En lecture" if ctx.voice_client and ctx.voice_client.is_playing() else "⏸️ En pause" if ctx.voice_client and ctx.voice_client.is_paused() else "⏹️ Arrêté")
    
    await ctx.send(embed=embed)
```

## 8. 🎯 Commande Seek (Aller à un moment)

Malheureusement, `discord.py` ne supporte pas nativement le seek avec FFmpeg audio. 
Il faut utiliser une solution alternative avec `ffmpeg-python` ou `pydub`.

## 9. 🔎 Commande Search (Recherche avancée)

```python
@bot.command(name='search', help='Recherche une musique: !search [terme]')
async def search(ctx, *, query):
    """Recherche et affiche les résultats"""
    embed = discord.Embed(
        title="🔍 Résultats de recherche",
        description=f"Recherche: `{query}`",
        color=discord.Color.orange()
    )
    
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
            results = ydl.extract_info(f"ytsearch5:{query}", download=False)
            
            for i, result in enumerate(results['entries'][:5], 1):
                duration = result.get('duration', 0)
                mins, secs = divmod(duration, 60)
                duration_str = f"{int(mins)}:{int(secs):02d}"
                
                embed.add_field(
                    name=f"{i}. {result['title'][:50]}",
                    value=f"⏱️ {duration_str}",
                    inline=False
                )
        
        embed.set_footer(text="Utilisez !play [lien] pour jouer")
        await ctx.send(embed=embed)
        
    except Exception as e:
        await ctx.send(f"❌ Erreur: {str(e)}")
```

## 10. 🎨 Réactions pour contrôler le bot

```python
@bot.event
async def on_reaction_add(reaction, user):
    """Contrôler le bot avec des réactions"""
    if user == bot.user:
        return
    
    if user.voice is None:
        return
    
    emoji_commands = {
        '▶️': 'resume',
        '⏸️': 'pause',
        '⏭️': 'skip',
        '⏹️': 'stop',
        '🔀': 'shuffle',
    }
    
    if str(reaction.emoji) in emoji_commands:
        ctx = await bot.get_context(reaction.message)
        command = bot.get_command(emoji_commands[str(reaction.emoji)])
        await ctx.invoke(command)
```

## 11. 📝 Base de données pour les playlists

```python
import sqlite3

def init_db():
    conn = sqlite3.connect('music_bot.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS playlists
                 (id INTEGER PRIMARY KEY, name TEXT, user_id INTEGER, songs TEXT)''')
    conn.commit()
    conn.close()

@bot.command(name='saveplaylist', help='Sauve la queue: !saveplaylist [nom]')
async def save_playlist(ctx, name: str):
    """Sauve la queue en tant que playlist"""
    player = get_player(ctx.guild.id)
    
    if not player.queue:
        await ctx.send("❌ Impossible de sauver une queue vide")
        return
    
    conn = sqlite3.connect('music_bot.db')
    c = conn.cursor()
    
    songs = '|'.join([song['url'] for song in player.queue])
    c.execute("INSERT INTO playlists (name, user_id, songs) VALUES (?, ?, ?)",
              (name, ctx.author.id, songs))
    conn.commit()
    conn.close()
    
    embed = discord.Embed(
        title="💾 Playlist sauvegardée",
        description=f"Nom: {name}",
        color=discord.Color.green()
    )
    await ctx.send(embed=embed)
```

## 12. 🌐 Support Spotify

Nécessite: `pip install spotipy`

```python
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

@bot.command(name='spotify', help='Joue une musique Spotify: !spotify [URL]')
async def spotify(ctx, spotify_url: str):
    """Joue une chanson depuis Spotify"""
    # Implémentation complexe, voir documentation Spotipy
    pass
```

## Installation des extras

```bash
pip install python-dotenv pydub spotipy lavalink
```

## Conseil: Utiliser LavaLink pour une meilleure qualité

LavaLink offre:
- Meilleure qualité audio
- Meilleur support des playlists
- Seeking/Forward rapide
- Gestion améliorée des ressources

Voir: [Lavalink Setup](https://github.com/lavalink-devs/Lavalink)

Bon codage! 🚀
