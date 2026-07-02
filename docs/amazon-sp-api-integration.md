# Amazon Listing 与 SP-API 集成

## 当前实现

- Listing 草稿数据库
- 美国、英国、德国、日本站点
- 标题、品牌、五点、描述、Search Terms、价格和库存编辑
- 本地基础校验
- Amazon Listings Items API 请求体预览
- SP-API 配置状态
- 未授权时禁止提交

## 正式接口流程

1. 使用 Amazon Product Type Definitions API 根据站点和商品名称推荐 Product Type。
2. 获取该 Product Type 的最新 JSON Schema。
3. 动态渲染类目必填属性，不在前端写死字段。
4. 使用 Amazon 的 schema 在内部执行提交前校验。
5. 单个 SKU 使用 Listings Items API 的 `putListingsItem`。
6. 大批量 SKU 使用 Feeds API 的 `JSON_LISTINGS_FEED`。
7. 保存 submission ID、Amazon 返回问题和最终处理状态。
8. 发布成功后写入 `LISTING_PUBLISHED` 员工事件。

## 为什么不能直接复用固定表单

Amazon 的字段要求会随站点、类目、卖家类型和父子变体关系变化。Product Type Definitions API 返回最新要求，并支持 `PARENT`、`CHILD`、`NONE` 三种关系。正式版本应缓存 schema，但必须支持定期刷新。

## 授权前置条件

- 注册 Amazon Selling Partner API 应用
- 应用获得 `Product Listing` 角色
- 卖家账号授权应用
- 获得 Seller ID、LWA Client ID、LWA Client Secret 和 Refresh Token
- 将密钥只配置在后端环境变量，不写入前端或数据库明文

环境变量模板见项目根目录 `.env.example`。

## 安全提交策略

- 默认只允许“校验预览”，不直接发布
- 管理员可控制哪些角色有发布权限
- 发布前需要人工审核
- `putListingsItem` 是完整替换操作，遗漏属性可能导致旧属性被删除；修改已有 Listing 时优先根据意图选择 `patchListingsItem`
- 批量 Feed 需要保存每条 SKU 的处理结果，不能只看 Feed 整体成功
