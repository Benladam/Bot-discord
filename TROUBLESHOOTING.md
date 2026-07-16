# 🔧 Troubleshooting & FAQ

## ❓ Questions Fréquentes

### Q: Où obtenir mon token Discord?
**A:** 
1. Allez sur https://discord.com/developers/applications
2. Cliquez "New Application"
3. Onglet "Bot" → "Add Bot"
4. Cliquez sur "Copy" sous TOKEN

⚠️ **NE JAMAIS PARTAGER VOTRE TOKEN!**

---

### Q: Mon bot ne répond pas aux commandes
**A:** Vérifiez:
1. Message Content Intent est activé sur Discord Developer Portal
2. Le préfixe est correct (par défaut: `!`)
3. Le bot a les permissions d'envoyer des messages
4. Aucune erreur dans la console

---

### Q: Comment changer le préfixe des commandes?
**A:** Modifiez dans `.env`:
```
COMMAND_PREFIX=!
```

Remplacez `!` par votre préfixe préféré (ex: `.`, `$`, `>`)

---

### Q: Puis-je utiliser le bot sur plusieurs serveurs?
**A:** Oui! Une fois invité sur un serveur, le bot fonctionne automatiquement.

---

### Q: Comment ajouter plus de commandes?
**A:** Créez un fichier dans `commands/` avec la structure:
```javascript
module.exports = {
  data: { name: 'ma-commande', description: 'Description' },
  execute(message, args, client, getPlayer) {
    message.reply('Réponse');
  }
};
```

Le bot chargera automatiquement la commande au démarrage.

---

### Q: Le bot peut-il jouer des playlists YouTube?
**A:** play-dl charge une vidéo à la fois. Pour les playlists:
1. Ajoutez plusieurs liens
2. Ou implémentez un système de playlists sauvegardées

---

## 🐛 Erreurs Courantes & Solutions

### ❌ "DISCORD_TOKEN not found in .env"

**Problème:** Le token n'est pas défini

**Solution:**
1. Créez/Ouvrez le fichier `.env`
2. Ajoutez: `DISCORD_TOKEN=votre_token_ici`
3. Sauvegardez
4. Redémarrez le bot

```bash
# Vérifier que .env existe
ls -la .env
```

---

### ❌ "Cannot find module 'discord.js'"

**Problème:** Les dépendances ne sont pas installées

**Solution:**
```bash
npm install
```

Ou réinstallez complètement:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### ❌ "FFmpeg not found"

**Problème:** FFmpeg n'est pas installé

**Solution:**

**Windows:**
```bash
# Avec Chocolatey
choco install ffmpeg

# Ou téléchargez depuis https://ffmpeg.org/download.html
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Vérifier l'installation:**
```bash
ffmpeg -version
```

---

### ❌ "Invalid token"

**Problème:** Le token est incorrect ou expiré

**Solution:**
1. Vérifiez que le token dans `.env` est exact (pas d'espaces)
2. Vérifiez que ce n'est pas votre ID client
3. Régénérez le token:
   - Discord Developer Portal → Bot → "Regenerate"
   - Copiez le nouveau token

---

### ❌ "The client is not connected to a voice channel"

**Problème:** Le bot n'a pas pu se connecter au canal vocal

**Solution:**
1. Vérifiez que le bot a la permission "Connect"
2. Vérifiez que le bot a la permission "Speak"
3. Vérifiez que vous êtes dans un canal vocal
4. Vérifiez que vous n'êtes pas en sourdine ou exclusion

```javascript
// Dans la commande play, vérifier:
if (!message.member.voice.channel) {
  return message.reply('Vous devez être dans un canal vocal!');
}
```

---

### ❌ "The bot is not in the voice channel"

**Problème:** Le bot a perdu la connexion audio

**Solution:**
1. Utilisez `!leave` puis `!play` de nouveau
2. Redémarrez le bot
3. Vérifiez les permissions du canal

---

### ❌ "Cannot stream audio"

**Problème:** Erreur lors de la lecture audio

**Solution:**
1. Vérifiez que FFmpeg est bien installé
2. Essayez une autre chanson
3. Vérifiez la connexion internet
4. Vérifiez que play-dl est à jour:
   ```bash
   npm update play-dl
   ```

---

### ❌ "TypeError: Cannot read property 'voice' of null"

**Problème:** L'utilisateur n'est pas dans un canal vocal

**Solution:**
Assurez-vous de vérifier que l'utilisateur est dans un canal avant d'utiliser `voice`:
```javascript
if (!message.member?.voice?.channel) {
  return message.reply('Vous devez être dans un canal vocal!');
}
```

---

### ❌ "ReferenceError: getPlayer is not defined"

**Problème:** La fonction `getPlayer` n'est pas accessible

**Solution:**
Vérifiez l'import dans votre commande:
```javascript
// Correct (getPlayer est passé en paramètre)
execute(message, args, client, getPlayer) {
  const player = getPlayer(message.guildId);
}
```

---

### ❌ "UnhandledPromiseRejectionWarning"

**Problème:** Une promise n'a pas été gérée correctement

**Solution:**
Ajoutez des `.catch()` à chaque promise:
```javascript
// ❌ Mauvais
message.reply('texte');

// ✅ Bon
message.reply('texte').catch(console.error);
```

Ou utilisez async/await:
```javascript
try {
  await message.reply('texte');
} catch (error) {
  console.error('Erreur:', error);
}
```

---

### ❌ "Commande non trouvée mais pas d'erreur"

**Problème:** Vous tapez une commande inexistante et rien ne se passe

**Solution:**
C'est normal! Le bot est configuré pour ignorer les commandes inconnues.

Pour afficher un message, modifiez dans `bot.js`:
```javascript
if (!command) {
  return message.reply('❌ Commande introuvable!');
}
```

---

## 🎯 Checklist Dépannage

Avant de demander de l'aide, vérifiez:

- [ ] Node.js 18+ installé (`node --version`)
- [ ] FFmpeg installé (`ffmpeg -version`)
- [ ] Token valide dans `.env`
- [ ] Dossier `commands/` existe
- [ ] `npm install` a été exécuté
- [ ] Message Content Intent activé (Discord Developer Portal)
- [ ] Bot invité sur le serveur
- [ ] Bot a les permissions: Send Messages, Connect, Speak
- [ ] Vous êtes dans un canal vocal
- [ ] Pas d'erreur dans la console

---

## 🔍 Debug Mode

### Voir les logs détaillés

Modifiez `bot.js`:
```javascript
// Ajouter au démarrage
client.on('debug', console.log);
client.on('warn', console.warn);
client.on('error', console.error);
```

Puis relancez et cherchez les erreurs.

### Tester une commande manuellement

```bash
# Démarrer en mode interactive
node -e "
const { getPlayer } = require('./bot.js');
const player = getPlayer('test-guild-id');
console.log('Player créé:', player);
"
```

### Vérifier les permissions

```javascript
// Dans une commande
const botMember = message.guild.members.me;
const botPerms = message.channel.permissionsFor(botMember);

console.log('Permissions:', {
  sendMessages: botPerms.has('SendMessages'),
  embedLinks: botPerms.has('EmbedLinks'),
  connect: botPerms.has('Connect'),
  speak: botPerms.has('Speak'),
});
```

---

## 📋 Log des Erreurs Communes

### Erreur: "Cannot find module 'play-dl'"
```bash
npm install play-dl
```

### Erreur: "Cannot find module '@discordjs/voice'"
```bash
npm install @discordjs/voice
```

### Erreur: "FATAL: command not found"
Vérifiez que vous êtes dans le bon dossier:
```bash
pwd
ls -la
ls commands/
```

### Erreur: "Cannot connect to FFmpeg"
FFmpeg n'est pas dans le PATH:
```bash
# Trouver FFmpeg
which ffmpeg
whereis ffmpeg

# Ajouter au PATH si nécessaire
export PATH="/usr/local/bin:$PATH"
```

---

## 🆘 Pas de Solution?

Si le problème persiste:

1. **Vérifiez la console** - Cherchez les erreurs rouges
2. **Consultez les docs:**
   - [Discord.js Guide](https://discordjs.guide/)
   - [Discord API Docs](https://discord.com/developers/docs)
   - [play-dl GitHub](https://github.com/play-dl/play-dl)
3. **Posez une question sur:**
   - [Discord.js Server](https://discord.gg/discord-api)
   - [Stack Overflow](https://stackoverflow.com/questions/tagged/discord.js)
   - [GitHub Issues](https://github.com/play-dl/play-dl/issues)

---

## 💡 Tips & Tricks

### Redémarrer automatiquement avec Nodemon
```bash
npm install -D nodemon
npm run dev
```

### Voir les versions installées
```bash
npm list discord.js
npm list play-dl
npm list @discordjs/voice
```

### Mettre à jour les packages
```bash
npm update
```

### Vérifier les vulnérabilités
```bash
npm audit
npm audit fix
```

### Nettoyer les caches
```bash
npm cache clean --force
```

---

## 🎓 Guide Pas-à-Pas Résolution de Problème

### Étape 1: Identifier l'erreur
Lire le message d'erreur dans la console

### Étape 2: Chercher le contexte
Où l'erreur se produit-elle? (startup, commande, événement)

### Étape 3: Vérifier les prérequis
- Node.js version
- Dépendances installées
- Fichiers config

### Étape 4: Tester isolé
Tester le problème avec du code simplifié

### Étape 5: Rechercher online
Copier l'erreur dans Google

### Étape 6: Demander de l'aide
Avec logs complètes et code pertinent

---

## 📞 Où Obtenir de l'Aide

| Ressource | Où | Meilleur pour |
|-----------|-----|--------------|
| Discord.js Guide | https://discordjs.guide/ | Learning |
| Discord API Docs | https://discord.com/developers/docs | Reference |
| Stack Overflow | stackoverflow.com | Questions |
| GitHub Issues | github.com/play-dl/play-dl | Bugs |
| Discord Server | discord.gg/discord-api | Community |

---

Bonne chance! 🍀
