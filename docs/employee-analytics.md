# 员工效率统计设计

## 权限

- 只有 `管理员` 角色可以看到“员工效率”导航和页面。
- `/api/analytics/employees` 与 `/api/activity` 的读取接口在后端再次校验管理员角色。
- 普通运营、设计和审核员工即使直接请求接口也返回 `403`。
- 员工只能产生属于自己的操作事件，不能查看其他员工统计。

## 自动记录的工作

| 事件 | 统计含义 |
| --- | --- |
| `SKU_CREATED` | 新建 SKU |
| `IMAGE_UPLOADED` | 上传商品原图数量 |
| `TASK_CREATED` | 创建生成任务 |
| `REVIEW_APPROVED` | 审核通过 |
| `REVIEW_REJECTED` | 审核驳回 |
| `LISTING_DRAFTED` | 新建 Listing 草稿 |
| `LISTING_VALIDATED` | 执行 Listing 校验 |
| `LISTING_PUBLISHED` | 发布 Listing |

事件由系统在动作成功后自动写入，员工不能手工修改数量。

## 管理建议

不要把不同岗位压成一个总分排名。运营、设计、审核的工作单位不同，应分别查看：

- 数量：做了多少
- 通过率：第一次提交质量
- 返工率：被驳回多少
- 周期：从领取到交付用了多久
- 异常：失败、超时和积压

后续迁移 PostgreSQL 时，事件表建议只追加不修改，并保存操作者、组织、时间、对象和来源 IP，形成审计日志。
