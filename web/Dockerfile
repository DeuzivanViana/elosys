FROM docker.io/library/node:22-trixie-slim

WORKDIR /app

ENV NODE_ENV=development \
    ELOSYS_DB_PATH=./db/elosys.db

COPY package.json package-lock.json ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY . .

VOLUME ["/app/node_modules", "/app/.next"]

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]