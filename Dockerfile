FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 OBSERVED_DATA=/data
COPY package.json ./
COPY server ./server
COPY public ./public
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
