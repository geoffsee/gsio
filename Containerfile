FROM oven/bun:alpine as builder

WORKDIR /app

COPY . .

RUN bun i && bun run build && chmod +x dist/cli.js

FROM oven/bun:alpine

WORKDIR /app

COPY --from=builder /app/dist .

ENTRYPOINT ["./cli.js"]
