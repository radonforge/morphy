# syntax=docker/dockerfile:1
FROM node:24-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production

RUN corepack enable

WORKDIR /app

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @morphy/server...

EXPOSE 2567

CMD ["pnpm", "--filter", "@morphy/server", "start"]
