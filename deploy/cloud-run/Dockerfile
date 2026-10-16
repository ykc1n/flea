FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build && npm prune --omit=dev

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip libstdc++6 libgomp1 libunwind8 libtbb12 \
    libsdl2-2.0-0 libopenal1 libvorbisfile3 libfreetype6 libfontconfig1 \
    libcurl4t64 libglew2.2 libglu1-mesa libxcursor1 libxrandr2 libxi6 libxinerama1 \
    libpng16-16t64 libminizip1t64 libjsoncpp25 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 flea && mkdir /scratch && chown flea:flea /scratch
COPY --from=build /usr/local/bin/node /usr/local/bin/node
ARG SMOKE_ENGINE_VERSION=2026.07.04
# Fail the cloud build if this reference engine cannot load the runtime libraries.
RUN mkdir /tmp/flea-engine \
    && curl --fail --location --max-time 180 "https://zero-k.info/engine/linux64/${SMOKE_ENGINE_VERSION}.zip" -o /tmp/flea-engine.zip \
    && unzip -q /tmp/flea-engine.zip -d /tmp/flea-engine \
    && chmod +x /tmp/flea-engine/spring-headless /tmp/flea-engine/pr-downloader \
    && cd /tmp/flea-engine && ./spring-headless --sync-version \
    && rm -rf /tmp/flea-engine /tmp/flea-engine.zip
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY worker ./worker
ENV FLEA_SCRATCH=/scratch FLEA_STORAGE_BYTES=8000000000 FLEA_RESERVE_BYTES=1000000000 FLEA_PROCESS_TIMEOUT=2400
USER flea
ENTRYPOINT ["node", "dist/scripts/cloud-job.js"]
