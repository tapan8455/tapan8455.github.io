FROM node:20-alpine

WORKDIR /app

# server.js uses pure Node.js built-ins (fetch, http, fs, path, url, stream)
# No external npm packages required for the web server!
COPY server.js ./
COPY src ./src

ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "server.js"]
