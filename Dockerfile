FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm clean-install --ignore-scripts
COPY . .
RUN npm run build
ENTRYPOINT ["node", ".", "/config.json"]
