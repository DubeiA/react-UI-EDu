#!/bin/bash

# Development script для одночасного запуску frontend і backend

echo "🚀 Starting Tinder AI Development Environment..."
echo ""

# Кольори для виводу
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Перевірка чи встановлено залежності
if [ ! -d "node_modules" ]; then
    echo "${BLUE}📦 Installing dependencies...${NC}"
    npm install
fi

# Інструкції для backend
echo "${GREEN}📋 Instructions:${NC}"
echo ""
echo "1️⃣  Open a new terminal and run your Express backend:"
echo "   ${BLUE}cd ../your-express-backend-folder${NC}"
echo "   ${BLUE}node server.js${NC}"
echo ""
echo "2️⃣  Backend should run on ${BLUE}http://localhost:3001${NC}"
echo ""
echo "3️⃣  This React app will start on ${BLUE}http://localhost:3000${NC}"
echo ""

read -p "Press Enter when backend is ready..."

# Запуск React
echo ""
echo "${GREEN}🎉 Starting React frontend...${NC}"
npm start
