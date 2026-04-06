FROM node:22-bookworm-slim

ENV ELAN_HOME=/root/.elan \
    PATH=/root/.elan/bin:$PATH \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git xz-utils zstd \
    && rm -rf /var/lib/apt/lists/*

RUN curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf \
    | sh -s -- -y --default-toolchain leanprover/lean4:v4.28.0 \
    && elan toolchain install leanprover/lean4:v4.28.0 \
    && elan default leanprover/lean4:v4.28.0 \
    && lean --version \
    && lake --version

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN mkdir -p /workspace/lean-workspace
EXPOSE 8080

CMD ["sh", "/app/start.sh"]
