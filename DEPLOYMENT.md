# 🚀 Deployment Guide

Гайд по деплою React версії Tinder AI на різні платформи.

## 📦 Production Build

### 1. Створення production build

```bash
npm run build
```

Це створить оптимізовану версію в папці `build/`:
- Мінімізований JS/CSS
- Code splitting
- Оптимізовані assets
- Source maps

### 2. Тестування production build локально

```bash
# Встановити serve
npm install -g serve

# Запустити build
serve -s build -l 3000
```

## 🌐 Deployment Options

### Option 1: Vercel (Рекомендовано для React)

**Переваги:**
- ✅ Автоматичний деплой з Git
- ✅ Безкоштовний SSL
- ✅ Глобальний CDN
- ✅ Preview deployments

**Кроки:**
1. Створи акаунт на [vercel.com](https://vercel.com)
2. Підключи GitHub репозиторій
3. Налаштуй environment variables:
   ```
   REACT_APP_API_URL=https://your-backend.com/api
   ```
4. Deploy автоматично при push

**vercel.json:**
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "http://your-backend:3001/api/:path*" }
  ]
}
```

### Option 2: Netlify

**Кроки:**
1. Створи акаунт на [netlify.com](https://netlify.com)
2. Підключи Git репозиторій
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `build`
4. Environment variables:
   ```
   REACT_APP_API_URL=https://your-backend.com/api
   ```

**netlify.toml:**
```toml
[build]
  command = "npm run build"
  publish = "build"

[[redirects]]
  from = "/api/*"
  to = "http://your-backend:3001/api/:splat"
  status = 200
```

### Option 3: AWS S3 + CloudFront

**Кроки:**
1. Створи S3 bucket
2. Увімкни static website hosting
3. Upload build files
4. Налаштуй CloudFront distribution
5. Додай custom domain (optional)

**Скрипт для деплою:**
```bash
#!/bin/bash
npm run build
aws s3 sync build/ s3://your-bucket-name --delete
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

### Option 4: Docker

**Dockerfile:**
```dockerfile
# Build stage
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf:**
```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  frontend:
    build: .
    ports:
      - "80:80"
    depends_on:
      - backend
    environment:
      - REACT_APP_API_URL=http://backend:3001/api

  backend:
    build: ../backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your_secret_here
```

## 🔧 Backend Configuration

### Налаштування CORS для production

**server.js:**
```javascript
const cors = require('cors');

// Development
if (process.env.NODE_ENV === 'development') {
  app.use(cors());
}

// Production
if (process.env.NODE_ENV === 'production') {
  app.use(cors({
    origin: 'https://your-frontend-domain.com',
    credentials: true,
  }));
}
```

### Environment Variables

**Backend (.env):**
```bash
NODE_ENV=production
PORT=3001
JWT_SECRET=your_super_secret_jwt_key_here
REPLICATE_API_TOKEN=your_replicate_token
DATABASE_PATH=/data/tinder_ai.db
```

**Frontend (.env.production):**
```bash
REACT_APP_API_URL=https://api.your-domain.com/api
```

## 🔒 Security Checklist

- [ ] Змінити JWT_SECRET з дефолтного
- [ ] Увімкнути HTTPS (SSL certificate)
- [ ] Налаштувати CORS правильно
- [ ] Додати rate limiting в backend
- [ ] Валідувати всі inputs
- [ ] Хешувати паролі (bcrypt)
- [ ] Додати CSP headers
- [ ] Видалити console.logs з production
- [ ] Захистити .env файли

## 📊 Performance Optimization

### 1. Code Splitting
```javascript
// App.js
import React, { lazy, Suspense } from 'react';

const AdminPanel = lazy(() => import('./components/AdminPanel/AdminPanel'));

// Use with Suspense
<Suspense fallback={<div>Loading...</div>}>
  <AdminPanel />
</Suspense>
```

### 2. Image Optimization
- Використовувати WebP формат
- Lazy loading для зображень
- CDN для static assets

### 3. Caching
```javascript
// Service Worker для offline support
// public/service-worker.js
```

### 4. Bundle Analysis
```bash
npm install --save-dev webpack-bundle-analyzer
npm run build -- --stats
npx webpack-bundle-analyzer build/bundle-stats.json
```

## 🔍 Monitoring

### Error Tracking
- Sentry
- LogRocket
- Rollbar

### Analytics
- Google Analytics
- Mixpanel
- Amplitude

### Performance
- Lighthouse CI
- WebPageTest
- Chrome DevTools

## 🧪 Pre-deployment Checklist

- [ ] `npm test` проходить успішно
- [ ] `npm run build` без помилок
- [ ] Перевірити в різних браузерах
- [ ] Mobile responsive
- [ ] Backend API працює на production URL
- [ ] Environment variables налаштовані
- [ ] Database backup створено
- [ ] SSL certificate активний
- [ ] Monitoring налаштований

## 📝 Post-deployment

1. Перевірити основні функції:
   - [ ] Login працює
   - [ ] Swipe механіка
   - [ ] Генерація контенту
   - [ ] Admin panel

2. Перевірити performance:
   ```bash
   lighthouse https://your-domain.com --view
   ```

3. Налаштувати auto-deployments з Git

4. Створити backup strategy для БД

## 🆘 Rollback Plan

```bash
# Vercel/Netlify - rollback до попередньої версії
vercel rollback
# або через web interface

# Docker - перейти на попередній image
docker-compose down
docker-compose up -d --scale frontend=1 --image frontend:previous-tag

# Manual - deploy попередній build
aws s3 sync build-backup/ s3://your-bucket-name
```

---

**Готовий до деплою?** Обери платформу і слідуй інструкціям вище! 🚀
