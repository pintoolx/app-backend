# ====================================
# 多階段構建 Dockerfile for PinTool Backend
# ====================================

# ====================================
# Stage 1: 構建階段
# ====================================
FROM node:24-alpine AS builder

# 設定工作目錄
WORKDIR /app

# 複製 package 文件
COPY package*.json ./

# 安裝所有依賴（包含 devDependencies）
RUN npm install

# 複製源代碼
COPY . .

# 構建應用
RUN npm run build

# 移除 devDependencies，只保留生產依賴
RUN npm install --only=production && npm cache clean --force


# ====================================
# Stage 2: 生產階段
# ====================================
FROM node:24-alpine

# 安裝 dumb-init 用於正確處理信號
RUN apk add --no-cache dumb-init

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 設定工作目錄
WORKDIR /app

# 從 builder 階段複製必要文件
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# 切換到非 root 用戶
USER nodejs

# 暴露端口（從 .env 讀取，默認 3000）
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# 使用 dumb-init 來啟動應用
ENTRYPOINT ["dumb-init", "--"]

# 啟動生產環境應用
CMD ["node", "dist/main"]
