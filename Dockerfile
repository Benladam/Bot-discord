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

# Le bot ecoute sur le port 3000 pour le GUI web (Fly l'expose)
ENV GUI_PORT=3000
ENV GUI_AUTOSTART=1
ENV BOT_ONLY=0

# Sante : Fly verifie ce port
EXPOSE 3000

CMD ["node", "bot.js"]
