# Build the React Workshop Console and serve it from nginx.
# The fixture generators (lessons + notebooks) must run before vite build,
# or the Coursework/lesson pages will 404 in prod.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY ui/pnpm-workspace.yaml ui/package.json ui/pnpm-lock.yaml* ./ui/
COPY ui/packages/sim-core/package.json ./ui/packages/sim-core/
COPY ui/packages/app/package.json ./ui/packages/app/

WORKDIR /app/ui
RUN pnpm install --frozen-lockfile || pnpm install

WORKDIR /app
COPY ui ./ui
COPY notebooks ./notebooks

WORKDIR /app/ui
RUN pnpm --filter @specter/app generate-fixtures \
 && pnpm --filter @specter/app generate-notebooks \
 && pnpm --filter @specter/app build

FROM nginx:alpine
COPY --from=build /app/ui/packages/app/dist /usr/share/nginx/html
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    gzip on;\n\
    gzip_vary on;\n\
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss image/svg+xml;\n\
    location = /index.html {\n\
        add_header Cache-Control "no-cache, must-revalidate";\n\
    }\n\
    location = /manifest.webmanifest {\n\
        add_header Cache-Control "no-cache, must-revalidate";\n\
        types { } default_type "application/manifest+json";\n\
    }\n\
    location = /robots.txt { add_header Cache-Control "public, max-age=86400"; }\n\
    location = /sitemap.xml { add_header Cache-Control "public, max-age=86400"; }\n\
    location /assets/ {\n\
        add_header Cache-Control "public, max-age=31536000, immutable";\n\
    }\n\
    location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf
