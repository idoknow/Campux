FROM debian:12-slim

WORKDIR /app

COPY bin/campux /app/campux
COPY frontend/dist /app/frontend/dist

EXPOSE 8081

ENV GIN_MODE=release

CMD ["./campux"]