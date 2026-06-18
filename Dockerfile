FROM node:22-bookworm-slim

# ca-certificates: needed for curl to verify HTTPS (not included in the slim base).
# curl/unzip: used by scripts/setup-potree.js to fetch + extract Potree.
# python3/make/g++: Potree's own postinstall build step (gulp) needs a native toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Downloads + builds Potree (develop branch, COPC support) into public/potree/.
# Runs at build time so the image starts instantly — only the build is slow (~2-3 min).
RUN npm run setup

EXPOSE 3000
CMD ["npm", "start"]
