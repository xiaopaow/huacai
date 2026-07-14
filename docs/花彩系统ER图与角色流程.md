# 花彩系统 ER 图与角色流程

> 基于当前花彩代码与数据结构整理，适用于内部培训、需求评审、后续数据库迁移和 Amazon 上线联调。

## 0. 传统 Chen 实体关系总图

这张图以实际工作流为主线，采用“矩形表示实体、菱形表示关系、椭圆表示属性”的传统 Chen 画法，并标注了 `1 / N / M` 基数。

- [可缩放查看器（推荐）](./花彩系统详细Chen-ER图.html)
- [SVG 矢量原图](./花彩系统详细Chen-ER图.svg)
- [PNG 高清总图](./花彩系统详细Chen-ER图.png)

建议从上方四个角色开始，沿中间主线按 `①—⑧` 阅读：

`运营维护 SKU → 创建并派单 → 设计执行并提交 → 审核版本 → 通过后交付 → 运营完善 Listing → 应用类目模板与 PTD 规则 → 提交 Amazon 店铺`

## 1. 角色业务流程图

```mermaid
flowchart LR
    Start([公司工作区初始化])

    subgraph Admin["管理员"]
        A1[设置管理员密码]
        A2[创建与维护员工账号]
        A3[配置 AI / Amazon SP-API]
        A4[查看员工效率与操作记录]
        A5[创建、恢复与保留备份]
        A6[处理异常任务和本地草稿]
    end

    subgraph Ops["运营"]
        O1[新建或批量导入 SKU]
        O2[维护 ASIN / 品牌 / 类目 / 站点]
        O3[上传商品原图]
        O4[创建视觉生产任务]
        O5[选择设计负责人和截止日期]
        O6[创建 Amazon Listing]
        O7[搜索官方 Product Type 或上传类目模板]
        O8[填写标题、五点、类目字段、价格和库存]
        O9[本地检查与 Amazon VALIDATION_PREVIEW]
        O10{发布方式}
        O11[导出 Seller Central XLSM / XLSX]
        O12[通过 SP-API 直接提交]
        O13[查询 Amazon 处理结果]
    end

    subgraph Designer["设计"]
        D1[接收任务通知]
        D2[查看商品原图、模板和截止日期]
        D3[制作图片或使用 AI 创作]
        D4[上传当前任务成品]
        D5[提交 V1 / V2 / Vn 审核]
        D6[根据驳回意见修改]
    end

    subgraph Reviewer["审核"]
        R1[接收待审核通知]
        R2[检查成品、版本和商品要求]
        R3{审核结论}
        R4[填写修改意见并驳回]
        R5[通过审核]
    end

    Start --> A1 --> A2
    A1 --> A3
    A2 --> O1
    O1 --> O2 --> O3 --> O4 --> O5
    O5 -->|任务分配通知| D1
    D1 --> D2 --> D3 --> D4 --> D5
    D5 -->|待审核通知| R1
    R1 --> R2 --> R3
    R3 -->|不通过| R4
    R4 -->|驳回通知| D6
    D6 --> D4
    R3 -->|通过| R5
    R5 -->|商品状态：已交付| O6
    O6 --> O7 --> O8 --> O9 --> O10
    O10 -->|人工上传| O11
    O10 -->|店铺已授权| O12 --> O13

    O1 -.业务数据.-> A4
    O4 -.任务与图片操作.-> A4
    R3 -.审核记录.-> A4
    O12 -.Listing 状态.-> A4
    A4 --> A5
    A6 -.异常处理.-> O4
```

## 2. 核心状态流转

### 2.1 视觉任务

```mermaid
stateDiagram-v2
    [*] --> 待生成: 创建任务并绑定原图
    待生成 --> 生成中: 开始设计或生成
    生成中 --> 待审核: 上传成品并提交版本
    待生成 --> 待审核: 直接提交人工成品
    已驳回 --> 待审核: 修改后提交下一版本
    待审核 --> 已驳回: 审核不通过
    待审核 --> 已通过: 审核通过
    已通过 --> [*]
```

约束：

- 只有管理员或设计人员能够提交成品。
- 设计人员只能提交分配给自己的任务。
- 待审核任务不能重复提交；已通过任务不能覆盖。
- 驳回必须填写修改意见，每次提交都会增加版本号。
- 原图必须属于当前商品和任务；上传成品必须标记为 `output`。

### 2.2 Amazon Listing

```mermaid
stateDiagram-v2
    [*] --> 草稿
    草稿 --> 待完善: 通用或类目必填项缺失
    草稿 --> 基础通过: 本地检查通过但店铺未授权
    草稿 --> 可提交: 本地检查通过且店铺已授权
    待完善 --> 基础通过: 补齐资料
    待完善 --> 可提交: 补齐资料并完成授权
    可提交 --> 失败: Amazon 官方校验或提交失败
    失败 --> 可提交: 修复字段并重新检查
    可提交 --> 提交中: Amazon 接受提交
    提交中 --> 已发布: Amazon 返回可售或可发现状态
```

约束：

- 同一 `SKU + marketplaceId` 只能存在一条 Listing。
- 正式提交前先执行 Amazon `VALIDATION_PREVIEW`。
- 提交中或已发布的 Listing 不能只删除本地记录，必须走 Amazon 下架流程。
- Excel 类目模板字段会转换为 SP-API `attributes`，也可以保留原模板结构导出上传。

## 3. 数据库 ER 图

```mermaid
erDiagram
    EMPLOYEE {
        string id PK
        string username UK
        string passwordHash
        string name
        string department
        string role
        boolean active
        boolean mustChangePassword
    }

    AUTH_SESSION {
        string id PK
        string tokenHash UK
        string employeeId FK
        datetime createdAt
        datetime expiresAt
    }

    PRODUCT {
        string id PK
        string sku UK
        string asin
        string name
        string brand
        string category
        string marketplace
        string status
        int imageCount
        string updatedAt
    }

    TASK {
        string id PK
        string productId FK
        string sku
        string productName
        string type
        string status
        int progress
        string createdById FK
        string assignedToId FK
        datetime dueAt
        string templateId
        int version
        datetime submittedAt
        string reviewedBy
        datetime reviewedAt
    }

    REVIEW_RECORD {
        int version
        boolean approved
        string comment
        string reviewer
        datetime reviewedAt
    }

    UPLOADED_ASSET {
        string id PK
        string ownerId FK
        string taskId FK
        string productId FK
        string purpose
        string name
        string type
        int size
        datetime createdAt
    }

    GENERATED_ASSET {
        string id PK
        string ownerId FK
        string prompt
        string ratio
        string quality
        string model
        string size
        string templateId
        int referenceCount
        datetime createdAt
    }

    IMAGE_JOB {
        string id PK
        string ownerId FK
        string status
        int progress
        string prompt
        string ratio
        string quality
        json referenceAssetIds
        string resultAssetId FK
        int attempts
        datetime createdAt
        datetime updatedAt
        datetime nextRetryAt
    }

    AMAZON_LISTING {
        string id PK
        string sku
        string marketplaceId
        string marketplaceName
        string productType
        string title
        string brand
        decimal price
        string currency
        int quantity
        string status
        string ownerId FK
        string asin
        string templateFileName
        json templateValues
        string amazonSubmissionId
        json issues
        datetime updatedAt
    }

    NOTIFICATION {
        string id PK
        string employeeId FK
        string type
        string entityId
        string title
        string message
        datetime createdAt
        datetime readAt
    }

    ACTIVITY_EVENT {
        string id PK
        string employeeId FK
        string type
        string entityType
        string entityId
        int quantity
        json metadata
        datetime createdAt
    }

    EMPLOYEE ||--o{ AUTH_SESSION : logs_in_with
    EMPLOYEE ||--o{ NOTIFICATION : receives
    EMPLOYEE ||--o{ ACTIVITY_EVENT : performs
    EMPLOYEE ||--o{ UPLOADED_ASSET : uploads
    EMPLOYEE ||--o{ GENERATED_ASSET : generates
    EMPLOYEE ||--o{ IMAGE_JOB : starts
    EMPLOYEE ||--o{ AMAZON_LISTING : owns
    EMPLOYEE ||--o{ TASK : creates
    EMPLOYEE o|--o{ TASK : assigned_to

    PRODUCT ||--o{ TASK : has
    PRODUCT ||--o{ UPLOADED_ASSET : contains
    PRODUCT ||--o{ AMAZON_LISTING : linked_by_SKU

    TASK ||--o{ UPLOADED_ASSET : uses
    TASK ||--o{ REVIEW_RECORD : contains
    TASK }o--o{ GENERATED_ASSET : outputAssetIds

    IMAGE_JOB }o--o{ UPLOADED_ASSET : referenceAssetIds
    IMAGE_JOB o|--o| GENERATED_ASSET : resultAssetId
```

## 4. 实体关系说明

| 主实体 | 关联实体 | 当前实现 |
|---|---|---|
| 员工 | 会话 | 一个员工可以存在多个有效会话，修改密码后其他设备会退出 |
| 员工 | 任务 | 同时保留创建人和当前负责人 |
| 商品 | 任务 | `TASK.productId` 为真实关联，SKU 和商品名作为历史快照 |
| 商品 | Listing | 当前通过 `SKU` 逻辑关联，没有保存 `productId` 外键 |
| 任务 | 原图/成品图 | `inputAssetIds`、`outputAssetIds` 保存图片 ID；图片元数据同时保存 `taskId` |
| 任务 | 审核记录 | 当前嵌入 `TASK.reviewHistory`，并非独立数据库集合 |
| AI 任务 | 参考图 | `referenceAssetIds` 为多值 ID 数组 |
| AI 任务 | 生成作品 | `resultAssetId` 指向一张生成图片 |
| 通知 | 业务对象 | `entityId` 为多态关联，当前主要指向任务 |
| 操作记录 | 业务对象 | `entityType + entityId` 为多态关联，用于管理员效率统计 |
| Listing | 类目模板 | 保存模板文件名和已填写字段；原始模板文件只在浏览器本地解析 |

## 5. 角色权限矩阵

| 功能 | 管理员 | 运营 | 设计 | 审核 |
|---|:---:|:---:|:---:|:---:|
| 工作台 | ✓ | ✓ | ✓ | ✓ |
| SKU 新建、编辑、批量导入 | ✓ | ✓ | — | — |
| 创建视觉任务 | ✓ | ✓ | ✓（自动分配自己） | — |
| 设置负责人和截止日期 | ✓ | ✓ | — | — |
| 查看任务中心 | ✓ | ✓ | ✓ | ✓ |
| 提交设计成品 | ✓ | — | ✓（仅本人任务） | — |
| 审核通过 / 驳回 | ✓ | — | — | ✓ |
| 素材库与 AI 创作 | ✓ | ✓ | ✓ | ✓ |
| Listing 编辑与模板导出 | ✓ | ✓ | — | — |
| Amazon SP-API 提交 | ✓ | ✓ | — | — |
| 员工效率统计 | ✓ | — | — | — |
| 员工账号与角色管理 | ✓ | — | — | — |
| 数据备份与恢复 | ✓ | — | — | — |
| 修改自己的密码 | ✓ | ✓ | ✓ | ✓ |

## 6. 文件系统与外部服务

这些内容不属于数据库 ER 实体，但属于完整系统：

```mermaid
flowchart LR
    UI[React 工作台]
    API[Express API]
    DB[(LowDB huacai-db.json)]
    Files[(data/uploads 图片文件)]
    Backups[(data/backups 数据与图片快照)]
    OpenAI[OpenAI 图片生成 API]
    Amazon[Amazon SP-API]
    Seller[Seller Central 模板上传]

    UI --> API
    API --> DB
    API --> Files
    DB --> Backups
    Files --> Backups
    API --> OpenAI
    API --> Amazon
    UI -->|导出保留结构的 XLSM / XLSX| Seller
```

## 7. 后续数据库升级建议

当前 LowDB 适合单机、小团队内部使用。迁移 PostgreSQL 时建议：

1. 将 `reviewHistory` 拆成独立 `task_reviews` 表。
2. 将任务输入、输出、AI 参考图拆成统一的 `task_assets` 关系表。
3. 给 `amazon_listings` 增加 `product_id`，同时保留 SKU 历史快照。
4. 将 `notification.entityId` 和 `activity.entityId` 改为明确的业务关联或审计事件表。
5. 将图片文件迁移到对象存储，数据库只保存 URL、哈希、尺寸和归属。
6. 为 `SKU`、`username`、`SKU + marketplaceId` 建立数据库唯一约束。
