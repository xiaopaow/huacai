# 花彩生产部署手册

当前架构适合单台 Linux 服务器上的内部团队使用：一个 Node.js 容器、一个本地 JSON 数据库以及本地图片目录。不要同时启动多个花彩容器共享同一份 `data`。

## 1. 服务器要求

- Linux x86_64/arm64
- Docker Engine 与 Docker Compose 插件
- 建议至少 2 核 CPU、4 GB 内存、50 GB 可用磁盘
- 若通过公网访问，准备域名并仅开放 80/443；8787 只监听本机

## 2. 准备配置

```bash
git clone https://github.com/xiaopaow/huacai.git
cd huacai
cp .env.example .env.local
cp deploy/compose.env.example deploy/compose.env
chmod 600 .env.local
mkdir -p data/uploads data/backups
sudo chown -R 1000:1000 data
```

必须在 `.env.local` 修改：

```env
INITIAL_ADMIN_PASSWORD=至少12位且包含字母和数字
INITIAL_EMPLOYEE_PASSWORD=另一组至少12位且包含字母和数字
OPENAI_API_KEY=你的中转Key
```

同域部署时 `CORS_ORIGINS` 留空。使用一层 Caddy/Nginx 反向代理时设置：

```env
TRUST_PROXY=1
OPENROUTER_SITE_URL=https://你的域名
```

正式连接 Amazon 前继续保持 `AMAZON_MODE=sandbox`。SP-API 授权完成并经过测试后，再按 `.env.example` 的说明切换 production。

## 3. 上线前检查

```bash
npm ci
npm run deploy:check
```

检查器不会输出任何密钥，只验证是否配置、密码强度、URL、数据目录写入能力、Docker 服务和 Compose 配置。

## 4. 启动

```bash
docker compose --env-file deploy/compose.env up -d --build
docker compose --env-file deploy/compose.env ps
curl -fsS http://127.0.0.1:8787/api/health
```

默认只监听 `127.0.0.1:8787`。若只在可信局域网直连，可将 `deploy/compose.env` 中的 `HUACAI_BIND_ADDRESS` 改为 `0.0.0.0`，然后通过 `http://服务器IP:8787` 访问。

## 5. HTTPS（推荐）

安装 Caddy，将 `deploy/Caddyfile.example` 复制到 Caddy 配置目录并替换域名。Caddy 会自动申请和续期 HTTPS 证书，反向代理到 `127.0.0.1:8787`。

防火墙建议：

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 6. 首次登录验收

1. 使用用户名 `admin` 和生产初始管理员密码登录。
2. 立即修改管理员密码。
3. 在“系统设置 → 上线前自检”确认账号、AI、数据目录和备份均正常。
4. 创建一个测试员工并完成首次改密。
5. 用测试 SKU 跑通“建任务 → 上传原图 → 生图/提交 → 审核 → Listing”流程。
6. Amazon 仍处于 sandbox 时验证模板和规则，不向真实店铺发布。

## 7. 更新与回滚

更新前先在系统设置创建手动备份，再执行：

```bash
git pull --ff-only
docker compose --env-file deploy/compose.env up -d --build
docker compose --env-file deploy/compose.env logs --tail=200 huacai
```

代码回滚：切换到上一个 Git 提交并重新构建。数据回滚：在管理员“系统设置”中选择更新前生成的备份恢复。

不要只依赖服务器本机备份。至少每天将 `data/backups` 复制到 NAS 或云端；同时定期备份整个 `data` 目录。

## 8. 运行维护

```bash
docker compose --env-file deploy/compose.env logs -f --tail=200 huacai
docker stats huacai
du -sh data data/uploads data/backups
```

容器日志已限制为最多 3 个、每个 10 MB。业务数据位于宿主机 `./data`，重建容器不会删除。
