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
ENV BOT_DATA_DIR=/data
RUN mkdir -p /data

# Installer les deps Node depuis package.json
COPY package.json ./
RUN npm install

# Copier le reste du code
COPY . .

# Le conteneur est un worker Discord : il n'a pas besoin d'ouvrir un port HTTP.
CMD ["node", "bot.js"]
