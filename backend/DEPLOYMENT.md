# PinTool Backend 部署指南

## 📋 環境變數說明

本應用需要以下環境變數才能正常運行。**這些環境變數不會編譯進 Docker image**，需要在雲平台部署時單獨配置。

### 必要環境變數

| 變數名稱 | 說明 | 範例 |
|---------|------|------|
| `NODE_ENV` | 執行環境 | `production` |
| `PORT` | 服務端口 | `3000` |
| `SUPABASE_URL` | Supabase 專案 URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase 公開金鑰 | - |
| `SUPABASE_SERVICE_KEY` | Supabase 服務金鑰 (私密) | - |
| `JWT_SECRET` | JWT 簽署密鑰 | 使用 `openssl rand -base64 32` 生成 |
| `JWT_EXPIRES_IN` | Token 過期時間 | `7d` |
| `ENCRYPTION_SECRET` | 加密私鑰的密鑰（≥32字元）| 使用 `openssl rand -base64 48` 生成 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | 從 @BotFather 取得 |
| `TELEGRAM_NOTIFY_ENABLED` | 啟用 Telegram 通知 | `true` / `false` |
| `SOLANA_RPC_URL` | Solana RPC 端點 | `https://api.mainnet-beta.solana.com` |
| `SOLANA_WS_URL` | Solana WebSocket 端點 | `wss://api.mainnet-beta.solana.com` |
| `PYTH_HERMES_ENDPOINT` | Pyth Network 端點 | `https://hermes.pyth.network` |

### 可選環境變數

| 變數名稱 | 說明 | 範例 |
|---------|------|------|
| `TELEGRAM_WEBHOOK_URL` | Telegram Webhook URL（生產環境） | `https://your-domain.com/api/telegram/webhook` |
| `CORS_ORIGIN` | CORS 允許來源 | `https://your-frontend.com` |

完整說明請參考 [.env.example](./.env.example)

## 🚀 雲平台部署（推薦）

本應用設計為雲原生部署，支援所有主流雲平台。

### 步驟 1: 構建 Docker Image

```bash
# 構建映像並加上版本標籤
docker build -t pintool-backend:v1.0.0 .
docker build -t pintool-backend:latest .
```

### 步驟 2: 推送到容器倉庫

#### 選項 A: Docker Hub
```bash
# 登入 Docker Hub
docker login

# 標記映像
docker tag pintool-backend:latest yourusername/pintool-backend:latest
docker tag pintool-backend:v1.0.0 yourusername/pintool-backend:v1.0.0

# 推送映像
docker push yourusername/pintool-backend:latest
docker push yourusername/pintool-backend:v1.0.0
```

#### 選項 B: Google Container Registry (GCR)
```bash
# 配置 gcloud
gcloud auth configure-docker

# 標記映像
docker tag pintool-backend:latest gcr.io/your-project-id/pintool-backend:latest
docker tag pintool-backend:v1.0.0 gcr.io/your-project-id/pintool-backend:v1.0.0

# 推送映像
docker push gcr.io/your-project-id/pintool-backend:latest
docker push gcr.io/your-project-id/pintool-backend:v1.0.0
```

#### 選項 C: AWS Elastic Container Registry (ECR)
```bash
# 登入 ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# 標記映像
docker tag pintool-backend:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/pintool-backend:latest
docker tag pintool-backend:v1.0.0 123456789012.dkr.ecr.us-east-1.amazonaws.com/pintool-backend:v1.0.0

# 推送映像
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/pintool-backend:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/pintool-backend:v1.0.0
```

#### 選項 D: Azure Container Registry (ACR)
```bash
# 登入 ACR
az acr login --name yourregistry

# 標記映像
docker tag pintool-backend:latest yourregistry.azurecr.io/pintool-backend:latest
docker tag pintool-backend:v1.0.0 yourregistry.azurecr.io/pintool-backend:v1.0.0

# 推送映像
docker push yourregistry.azurecr.io/pintool-backend:latest
docker push yourregistry.azurecr.io/pintool-backend:v1.0.0
```

### 步驟 3: 在雲平台配置環境變數

在您選擇的雲平台中，設定上述所有必要的環境變數。

#### Google Cloud Run 範例
```bash
gcloud run deploy pintool-backend \
  --image gcr.io/your-project-id/pintool-backend:latest \
  --platform managed \
  --region us-central1 \
  --port 3000 \
  --set-env-vars "NODE_ENV=production,PORT=3000" \
  --set-env-vars "SUPABASE_URL=https://xxx.supabase.co" \
  --set-env-vars "JWT_SECRET=your-secret" \
  --allow-unauthenticated
```

#### AWS ECS 範例
在 Task Definition 中配置環境變數：
```json
{
  "containerDefinitions": [{
    "name": "pintool-backend",
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/pintool-backend:latest",
    "portMappings": [{
      "containerPort": 3000
    }],
    "environment": [
      {"name": "NODE_ENV", "value": "production"},
      {"name": "PORT", "value": "3000"}
    ],
    "secrets": [
      {"name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "SUPABASE_SERVICE_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
    ]
  }]
}
```

#### Azure Container Instances 範例
```bash
az container create \
  --resource-group myResourceGroup \
  --name pintool-backend \
  --image yourregistry.azurecr.io/pintool-backend:latest \
  --dns-name-label pintool-backend \
  --ports 3000 \
  --environment-variables \
    NODE_ENV=production \
    PORT=3000 \
  --secure-environment-variables \
    JWT_SECRET=your-secret \
    SUPABASE_SERVICE_KEY=your-key
```

## 🖥️ 本地測試部署

### 使用 Docker 運行（手動設定環境變數）

```bash
# 構建映像
docker build -t pintool-backend:latest .

# 運行容器（手動傳遞環境變數）
docker run -d \
  --name pintool-backend \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_ANON_KEY=your-key \
  -e JWT_SECRET=your-secret \
  pintool-backend:latest

# 查看日誌
docker logs -f pintool-backend
```

### 使用本地 .env 文件測試（僅限本地開發）

```bash
# 使用 docker-compose（會自動讀取 .env）
docker-compose up -d --build

# 查看日誌
docker-compose logs -f
```

## 🔍 驗證部署

### 健康檢查
```bash
# 訪問健康檢查端點
curl http://your-domain.com/health

# 本地測試
curl http://localhost:3000/health
```

### API 文檔
訪問 Swagger API 文檔（請替換為實際域名）：
```
http://your-domain.com/api/docs
```

## 🔧 故障排除

### 查看容器日誌
```bash
# 本地 Docker
docker logs -f pintool-backend

# 雲平台請使用各平台的日誌查看工具
# Google Cloud Run: gcloud run services logs read pintool-backend
# AWS ECS: aws logs tail /ecs/pintool-backend
# Azure: az container logs --name pintool-backend --resource-group myResourceGroup
```

### 本地調試
```bash
# 進入容器檢查
docker exec -it pintool-backend sh

# 重新構建（無快取）
docker build --no-cache -t pintool-backend:latest .
```

## 📊 Docker Image 優化說明

本 Dockerfile 採用以下最佳實踐：

1. **多階段構建** - 分離構建和運行環境，最終映像大小 < 200MB
2. **Alpine Linux** - 使用輕量級 Alpine 基礎映像
3. **非 root 用戶** - 以非特權用戶執行應用，增強安全性
4. **健康檢查** - 自動監控容器健康狀態
5. **dumb-init** - 正確處理信號和殭屍進程
6. **分層快取** - 優化 Docker 層快取，加快構建速度
7. **環境變數外部化** - 敏感資料不打包進映像，符合雲原生最佳實踐

## 🔐 安全性建議

### 1. 環境變數管理
- ✅ **絕對不要**將 `.env` 文件或敏感資料編譯進 Docker image
- ✅ 使用雲平台的 Secret Manager（AWS Secrets Manager、GCP Secret Manager 等）
- ✅ 定期輪換敏感金鑰（JWT_SECRET、ENCRYPTION_SECRET 等）

### 2. Image 安全掃描
```bash
# 使用 Docker Scout 掃描漏洞
docker scout cves pintool-backend:latest

# 使用 Trivy 掃描
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image pintool-backend:latest
```

### 3. 網路安全
- 使用 HTTPS（雲平台通常會自動配置）
- 啟用 CORS 白名單
- 設定適當的防火牆規則

## 📝 其他資源

- [API 文檔](./API_DOCUMENTATION.md)
- [專案結構](./PROJECT_STRUCTURE.md)
- [環境變數說明](./.env.example)
