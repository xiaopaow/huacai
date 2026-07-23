# 花彩 Amazon Studio

面向 Amazon 内部运营、设计和审核团队的商品生产工作台。

新部署默认只创建管理员账号，商品库、任务、Listing 和员工统计均为空，不再自动写入演示业务数据。

## 已实现

- SKU 商品资料与共享任务中心
- 运营派单、负责人、截止日期与逾期提示
- 美工提交 V1/V2 成品、审核意见与版本记录
- 站内通知和角色权限
- 灵感模板“做同款”、提示词回填和后台 AI 生图任务
- 图片素材持久化、自动重试和按角色隔离的作品历史库
- Amazon Listing 编辑、本地检查与 SP-API 发布连接器
- 员工账号、强制首次改密、登录限流和会话管理
- 管理员专属团队效率统计，以及普通员工仅本人可见的个人产出
- Listing AI 生成版本库，保留生成者、竞品、模型、规则结果和采用记录
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

## 导入公司 SKU

管理员或运营可在“SKU 商品库”点击“Excel / CSV 导入”：

- 支持 `.xlsx`、`.csv`、`.tsv`
- 必填列：`SKU`、`商品名称`、`品牌`
- 可选列：`Amazon 类目`、`目标站点`、`ASIN`
- 单次最多 500 个 SKU
- 导入前会预览并标记已有 SKU、文件内重复和字段错误

弹窗中可下载 CSV 模板，用 Excel 填写后直接导入。

旧版本已经写入耳机、保温杯等演示记录时，管理员可在“系统设置”使用“清理演示数据”。系统会先自动创建完整备份，并且只删除签名完全匹配的演示记录。

管理员还可在“员工账号与权限”中编辑员工的用户名、姓名、部门和角色。系统禁止停用当前登录管理员，并且始终要求至少保留一个启用的管理员账号。

提交前验证：

```bash
npm test
npm run build
```

交互测试会检查“做同款”原地载入并提交生图，以及退出登录的二次确认流程。

## Docker 部署

完整的生产服务器、HTTPS、备份、更新与回滚步骤见 [生产部署手册](docs/deployment.md)。

1. 复制并填写环境变量：

```bash
cp .env.example .env.local
```

至少修改：

```env
INITIAL_ADMIN_PASSWORD=请设置强密码
INITIAL_EMPLOYEE_PASSWORD=请设置强密码
```

不要沿用示例或旧版本默认密码。首次进入系统后，管理员应在“系统设置 → 上线前自检”确认“账号安全”不再提示默认初始密码，并让所有员工完成首次改密。

2. 准备端口绑定并执行上线前检查：

```bash
cp deploy/compose.env.example deploy/compose.env
mkdir -p data/uploads data/backups
sudo chown -R 1000:1000 data
npm ci
npm run deploy:check
```

默认仅监听 `127.0.0.1:8787`，适合由 Caddy/Nginx 提供 HTTPS。可信局域网直接访问时，将 `deploy/compose.env` 的 `HUACAI_BIND_ADDRESS` 改成 `0.0.0.0`。

3. 构建并启动：

```bash
docker compose --env-file deploy/compose.env up -d --build
```

4. 打开：

```text
http://服务器IP:8787
```

5. 查看运行状态：

```bash
docker compose --env-file deploy/compose.env ps
docker compose --env-file deploy/compose.env logs -f huacai
```

业务数据和图片保存在宿主机 `./data`，重新构建容器不会丢失。

## AI 生图与 Listing 文案

在 `.env.local` 配置：

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_TEXT_API_URL=https://openrouter.ai/api/v1/chat/completions
OPENAI_TEXT_MODEL=openai/gpt-5.4
ETSY_API_KEY=
MONTHLY_IMAGE_QUOTA=500
```

Listing 中心支持粘贴单个 Amazon 或 Etsy 竞品详情页链接，自动识别 ASIN/Listing ID、读取公开商品信息并生成标题、五点卖点、描述和 Search Terms。Etsy 默认读取公开的链接预览资料，不要求 API Key；如果以后需要更完整、更稳定的字段，可申请 Etsy Open API v3 凭证，并将 `keystring:shared_secret` 填入可选的 `ETSY_API_KEY`。平台返回验证码或限制访问时，系统会明确提示，不会伪装成已经完成竞品分析。

每次 AI Listing 成功生成都会写入独立历史版本，不会被下一次生成覆盖。管理员可以查看全部员工版本；运营只能查看、恢复自己生成的版本。生图历史同样只向普通员工返回本人作品，管理员可查看团队作品。员工工作台显示本人当月成功生图和 Listing 生成量，团队总量及员工明细只在管理员效率后台开放。

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

系统运行期间每小时检查一次，超过 24 小时没有新快照时会自动备份；默认保留最近 14 份，可通过
`BACKUP_RETENTION_COUNT` 调整为 3–90 份。管理员也可在“系统设置”手动创建和恢复快照。
恢复业务数据时不会回滚员工密码和登录会话，图片目录会精确恢复到快照状态。

## 生产说明

当前文件数据库适合单机、小团队内部使用。若需要多台应用服务器、高并发或跨地域部署，应迁移至 PostgreSQL，并将图片迁移到对象存储。
