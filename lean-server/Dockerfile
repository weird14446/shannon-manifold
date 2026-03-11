FROM node:22-bookworm-slim

ENV ELAN_HOME=/root/.elan \
    PATH=/root/.elan/bin:$PATH \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf \
    | sh -s -- -y --default-toolchain leanprover/lean4:stable

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN mkdir -p /workspace/lean-workspace

EXPOSE 8080

CMD ["sh", "-c", "cd \"${LEAN_PROJECT_PATH:-/workspace/lean-workspace}\" && lake build && cd /app && npm start"]
