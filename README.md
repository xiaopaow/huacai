# 花彩 Amazon Studio

面向 Amazon 内部运营、设计和审核团队的商品生产工作台。

## 已实现

- SKU 商品资料与共享任务中心
- 运营派单、负责人、截止日期与逾期提示
- 美工提交 V1/V2 成品、审核意见与版本记录
- 站内通知和角色权限
- 灵感模板“做同款”、提示词回填和后台 AI 生图任务
- 图片素材持久化、自动重试和团队作品库
- Amazon Listing 编辑、本地检查与 SP-API 发布连接器
- 员工账号、强制首次改密、登录限流和会话管理
- 管理员专属效率统计
- 数据库与图片完整备份、安全恢复

## 本地开发

要求 Node.js 20+。

```bash
cp .env.example .env.local
npm ci
npm run dev
```

- 前端：`http://localhost:5173`
- API：`http://127.0.0.1:8787`

## Docker 部署

1. 复制并填写环境变量：

```bash
cp .env.example .env.local
```

至少修改：

```env
INITIAL_ADMIN_PASSWORD=请设置强密码
INITIAL_EMPLOYEE_PASSWORD=请设置强密码
```

2. 构建并启动：

```bash
docker compose up -d --build
```

3. 打开：

```text
http://服务器IP:8787
```

4. 查看运行状态：

```bash
docker compose ps
docker compose logs -f huacai
```

业务数据和图片保存在宿主机 `./data`，重新构建容器不会丢失。

## AI 生图

在 `.env.local` 配置：

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
MONTHLY_IMAGE_QUOTA=500
```

如果服务器需要代理：

```env
OUTBOUND_PROXY=http://代理地址:端口
```

## Amazon SP-API

默认使用沙盒，不会影响真实店铺：

```env
AMAZON_MODE=sandbox
AMAZON_SELLER_ID=
AMAZON_LWA_CLIENT_ID=
AMAZON_LWA_CLIENT_SECRET=
AMAZON_REFRESH_TOKEN=
```

切换正式环境时必须同时配置：

```env
AMAZON_MODE=production
AMAZON_PRODUCTION_CONFIRMATION=I_UNDERSTAND
```

系统会先调用 Amazon `VALIDATION_PREVIEW`，通过后再正式提交。

## 数据安全

- `data/huacai-db.json`：业务数据库
- `data/uploads/`：上传和生成的图片
- `data/backups/`：数据库与图片完整快照

管理员可在“系统设置”创建和恢复快照。恢复业务数据时不会回滚员工密码和登录会话。

## 生产说明

当前文件数据库适合单机、小团队内部使用。若需要多台应用服务器、高并发或跨地域部署，应迁移至 PostgreSQL，并将图片迁移到对象存储。
