FROM node:20-alpine
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache ffmpeg
WORKDIR /app
COPY server.js index.html ./
EXPOSE 3000
CMD ["node", "server.js"]
