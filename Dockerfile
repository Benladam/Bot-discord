FROM node:22-slim

# Deps systeme : ffmpeg (audio) + outils pour yt-dlp
RUN apt-get update -y && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp (recuperation des flux YouTube)
RUN pip3 install --break-system-packages -U 'yt-dlp[default]' || pip3 install -U 'yt-dlp[default]'

WORKDIR /app
ENV BOT_DATA_DIR=/data
RUN mkdir -p /data

# Installer les deps Node depuis package.json
COPY package.json ./
RUN npm install

# Copier le reste du code
COPY . .

# HTTP : health check, pont Minecraft et panneau web authentifié partagent le port PORT.
EXPOSE 8080
CMD ["node", "supervisor.js"]
