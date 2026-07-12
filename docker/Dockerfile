FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -sS https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /agent
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src

# Run the TypeScript source directly with tsx (no build step); imports are
# extensionless and resolved by tsx, matching the Bundler moduleResolution.
# The agent's working directory (target repo) comes from WORKSPACE_PATH, not
# from the process cwd, so keeping WORKDIR at /agent is fine.
ENTRYPOINT ["node_modules/.bin/tsx", "src/index.ts"]
