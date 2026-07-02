# 第一阶段技术决策

## 产品范围

首个版本只服务 Amazon 内部视觉生产流程：

1. 建立 SKU 商品资料
2. 上传商品原图
3. 创建白底主图或六图套图任务
4. 后台生成并执行合规检查
5. 人工审核
6. 按 SKU 交付下载

美国站作为首个默认站点，英国、德国、日本站保留在数据模型中。

## 前端

- React + TypeScript + Vite
- 按 `dashboard/products/create/tasks/reviews/assets/settings` 划分业务页面
- 领域类型集中在 `src/types/domain.ts`
- 第一阶段使用 localStorage 验证刷新持久化；接入 API 后移除该实现

## 目标后端

- API：NestJS（TypeScript）
- 数据库：PostgreSQL
- ORM：Prisma
- 文件：兼容 S3 协议的对象存储
- 队列：Redis + BullMQ
- 图片处理：Sharp
- 权限：组织级 RBAC
- 部署：Docker
- 监控：Sentry + 结构化日志

核心服务边界：

- Identity：登录、组织、成员、角色
- Catalog：品牌、项目、SKU、商品资料
- Asset：原图、生成图、版本和访问权限
- Generation：任务编排、模型调用、重试和成本
- Compliance：背景、主体占比、分辨率、文字和水印检查
- Review：提交、通过、驳回、意见和审计日志

## 第一版数据实体

- Organization
- User
- Role
- Brand
- Project
- Product
- ProductAsset
- GenerationTask
- GenerationOutput
- ComplianceReport
- Review
- AuditLog

所有业务表都需要 `organizationId`，避免未来团队数据串用。生成结果必须保存模型、模型版本、参数、提示词模板版本和成本。

## AI 服务策略

使用适配器层，业务代码不直接依赖单个模型厂商：

- `BackgroundRemovalProvider`
- `ImageGenerationProvider`
- `VisionInspectionProvider`
- `TranslationProvider`

第一批能力的选择标准：

1. 商品主体保持能力
2. 商用授权与数据策略
3. 异步任务、失败率和延迟
4. 单张成本
5. 中国大陆服务可用性

在完成 30–50 个真实 SKU 的小样评测前，不锁定最终供应商。评测集至少覆盖服饰、3C、家居、美妆和透明/反光材质。

## 安全边界

- API 密钥只能保存在服务端
- 对象存储默认私有
- 通过短时签名 URL 访问图片
- 上传文件进行类型、尺寸和恶意内容检查
- 保存下载、删除、审核和权限变更日志
- 明确原图及生成图的保存期限

## 第二阶段接口契约

建议优先实现：

- `POST /auth/login`
- `GET /products`
- `POST /products`
- `POST /products/:id/assets`
- `GET /generation-tasks`
- `POST /generation-tasks`
- `POST /generation-tasks/:id/submit`
- `POST /reviews/:id/approve`
- `POST /reviews/:id/reject`

前端的 `Product` 和 `GenerationTask` 类型即为第一版接口契约起点。
