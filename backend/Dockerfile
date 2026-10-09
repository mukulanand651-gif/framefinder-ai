
FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV SELFHOSTED_HEADLESS=true

EXPOSE 3000

CMD ["npm", "start"]
