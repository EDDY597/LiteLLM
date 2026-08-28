# Agent Note: LiteLLM plan-balance panel over gateway billing objects

Status: implemented

[English](2026-08-27-litellm-plan-balance-panel.md) | 中文

## 问题

用户的所有付费上游模型都经过同一个 LiteLLM 网关，希望在 DSH 的插件设置里直接看到每个付费模型剩余的 coding plan 额度或预存余额。DSH 本身拿不到这个数字：请求只携带虚拟别名，spend 记账在网关手里。没有读取路径时，查余额就意味着离开产品去 LiteLLM 自己的界面或 API。

## 决策

插件配置新增可选的 `plans` 列表——`{ id, name?, kind: 'key' | 'budget', target }`，指向要跟踪的 LiteLLM 计费对象（api key 值或 `budget_id`）。宿主侧新增 `LiteLlmPlansReader`，用与模型流量相同的 master key 凭据查询网关管理端点（`/key/info`、`/budget/info`；从 `baseURL` 去掉尾部 `/v1` 推导），凭据按次刷新即时解析，因此凭据轮换立即生效；凭据无法解析时整次读取高声失败，而不是返回残缺数字。

字段提取容忍代理版本漂移（部分响应把信息对象嵌在 `{ data }` 下），并按常见字段名读取 spend/上限/重置时间。单条失败被隔离进快照的 `failures` 行，其余条目保持可读；没有轮询——卡片已有的刷新按钮同时重读两个面板，且各自独立落地（settle）。结果经新增的 `litellmGateway/plans` Remote 方法（与 `usage`/`activeModel` 并列）到达浏览器，设置卡片将其渲染为表格（名称、类型、已用、上限、剩余、重置），失败行附于表下。

## Alternatives considered

**直查每个上游提供方的原生余额 API。** 能直接显示订阅配额真值，但每家提供方的认证与响应方言各异，凭据也会超出「单一共享 master key」这条接缝成倍增长。网关已经拥有统一的 spend 记账；把原生配额镜像为 LiteLLM budget 是部署侧的正解，README 限制一节已明确写出。

**客户端定时轮询余额。** 无需用户操作即可保持新鲜，却引入了后台请求循环，且两次轮询之间的数据同样陈旧；用量面板已有的显式刷新交互本来就是这张卡片认可的 freshness 契约。

**把余额并进 usage 快照载荷。** 少一个 Remote 方法，但把两个独立失败读取耦合到同一条 strict wire schema 上，还会让余额错误连坐清空用量表格；拆分方法让每个面板的错误状态保持诚实。

## Consequences

部署只要在配置里描述计费对象即可获得余额视图，零新增基础设施：每个条目每次刷新一次管理端 GET，未配置则零开销。接受的代价：数字只与最后一次点击一样新；它反映的是 LiteLLM 账本而非上游原生配额计数器（除非镜像为 budget）；管理路由推导假定常规的 `/v1` 划分而非可配置管理基址。覆盖面钉住：配置校验（重复 id、封闭 kind、非空 target、副本分离）、两种 kind 的端点与鉴权构造、`{ data }` 解包、无上限字段的省略、含畸形 JSON 与传输抛错的失败隔离，以及任何请求发出前的凭据高声拒绝。
