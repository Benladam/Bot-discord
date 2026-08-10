FROM node:22-slim

# Deps systeme : ffmpeg (audio) + outils pour yt-dlp
RUN apt-get update -y && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp (recuperation des flux YouTube)
RUN pip3 install --break-system-packages -U yt-dlp || pip3 install -U yt-dlp

WORKDIR /app

# Installer les deps Node depuis package.json
COPY package.json ./
RUN npm install

# Encodeur Opus natif (requis pour le son vocal)
RUN npm install @discordjs/opus

# Copier le reste du code
COPY . .

# Le serveur GUI ecoute sur 3000 (Fly l'expose) et lance le bot en enfant (GUI_AUTOSTART=1)
ENV GUI_PORT=3000
ENV GUI_AUTOSTART=1
ENV HOST=0.0.0.0

EXPOSE 3000

# IMPORTANT : on lance le serveur GUI (pas bot.js direct), car c'est lui qui
# ecoute sur le port web ET demarre le bot Discord en processus enfant.
CMD ["node", "gui/server.js"]
