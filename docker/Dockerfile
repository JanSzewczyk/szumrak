FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -sS https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# WORKSPACE_PATH is bind-mounted from the host (or a GitHub Actions runner),
# whose file owner UID rarely matches the UID running inside this container.
# Git's ownership check refuses to operate on such a directory ("dubious
# ownership") unless it's explicitly trusted; every target repo mounted here
# is trusted by design (that's the whole point of the mount).
#
# The container also has no git identity by default, so `git commit` in
# git.ts fails with "Author identity unknown". Every commit the agent makes
# is machine-authored, so a fixed bot identity is set once here rather than
# per-run. Identity matches the "szumrak-bot" GitHub App's auto-created bot
# user (login "szumrak-bot[bot]", id 304933492) — the noreply email format
# (<id>+<login>@users.noreply.github.com) is what makes GitHub link these
# commits to the bot's profile/avatar instead of showing plain text.
RUN git config --system --add safe.directory '*' \
    && git config --system user.name "szumrak-bot[bot]" \
    && git config --system user.email "304933492+szumrak-bot[bot]@users.noreply.github.com"

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
