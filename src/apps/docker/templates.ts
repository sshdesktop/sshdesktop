export const DOCKERFILE_TEMPLATES: Record<string, string> = {
  nodejs: `# Multi-stage Node.js & React Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`,

  python: `# Lightweight Python FastAPI / Flask Application
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000
CMD ["python", "main.py"]`,

  golang: `# Go Alpine Microservice Builder
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]`,

  nginx: `# Nginx Web Server Static Site
FROM nginx:alpine
COPY ./html /usr/share/nginx/html
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]`,

  rust: `# Rust Musl Scratch Statically-Linked Binary
FROM rust:1.78-alpine AS builder
WORKDIR /usr/src/app
COPY . .
RUN cargo build --release

FROM alpine:latest
WORKDIR /app
COPY --from=builder /usr/src/app/target/release/app /app/
CMD ["./app"]`,

  blank: `# Custom Dockerfile
FROM ubuntu:22.04
WORKDIR /app
RUN apt-get update && apt-get install -y curl
CMD ["echo", "Hello from Docker!"]`
};

export const COMPOSE_TEMPLATES: Record<string, string> = {
  web_db_redis: `version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://postgres:secret@db:5432/app
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  pgdata:`,

  lamp: `version: '3.8'

services:
  web:
    image: php:8.2-apache
    ports:
      - "8080:80"
    volumes:
      - ./src:/var/www/html
    depends_on:
      - db
    restart: always

  db:
    image: mariadb:11
    environment:
      MYSQL_ROOT_PASSWORD: root_secret
      MYSQL_DATABASE: app_db
      MYSQL_USER: app_user
      MYSQL_PASSWORD: app_secret
    volumes:
      - db_data:/var/lib/mysql
    restart: always

  phpmyadmin:
    image: phpmyadmin/phpmyadmin
    ports:
      - "8081:80"
    environment:
      PMA_HOST: db
    depends_on:
      - db

volumes:
  db_data:`,

  monitoring: `version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - prometheus
    restart: unless-stopped`,

  blank: `version: '3.8'

services:
  app:
    image: alpine:latest
    command: ["sh", "-c", "echo 'Container is running...' && tail -f /dev/null"]`
};

export const POPULAR_IMAGES = [
  { name: 'nginx:alpine', desc: 'Lightweight high-performance HTTP web server' },
  { name: 'redis:alpine', desc: 'In-memory fast key-value database & cache' },
  { name: 'postgres:16-alpine', desc: 'Advanced relational SQL database' },
  { name: 'node:20-alpine', desc: 'JavaScript runtime with lightweight Alpine base' },
  { name: 'python:3.11-slim', desc: 'Python 3.11 environment with pip' },
  { name: 'rabbitmq:3-management', desc: 'Messaging broker with web management UI' },
];
