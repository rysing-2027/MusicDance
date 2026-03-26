FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY server.js index.html ./
EXPOSE 3000
CMD ["node", "server.js"]
