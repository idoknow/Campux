# syntax=docker/dockerfile:1.7
# Static marketing landing page (campux.top).
# Build from the repo root so the path is stable:
#   docker build -f landing/Dockerfile -t rockchin/campux-landing .

FROM nginx:1.27-alpine

# Static landing assets (index.html + logo/og-image/screenshots).
COPY landing/ /usr/share/nginx/html/

# Serve files, fall back to index.html; gzip text/svg assets.
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    gzip on;\n\
    gzip_types text/css application/javascript image/svg+xml application/json;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
