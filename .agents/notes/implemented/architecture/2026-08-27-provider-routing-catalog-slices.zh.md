# Agent Note: Provider-declared routing slices and the three-bucket model menu

Status: implemented

[English](2026-08-27-provider-routing-catalog-slices.md) | 中文

## 问题

LiteLLM 网关把路由别名（`dsh-cost`/`dsh-balanced`/`dsh-quality`）与直连虚拟模型作为同一个扁平提供方分组公布，于是 composer 的模型座位把它们全部平铺在泛化的「模型」根行之下，而推理等级选择器即使只对当前已选中的那一个模型有意义，也占据一个根行。用户还无法在不离开 DSH 的情况下看到路由器实际命中的具体后端（例如 `qwen3.5-plus`）。接缝中没有任何东西区分「路由档位」和「直连模型」：这份知识住在提供方插件里，但唯一可用的表达载体 `LlmConfigurableProvider` 只承载配置指针。

## 决策

可配置提供方现在可以在其目录条目上发布建议性的 **catalog**（`LlmConfigurableProvider.catalog`：`routes`、`models`、可选 `credentialEnv`）。注册表在注册时高声校验（id/name 非空、列表内唯一）并分离数组副本；选择语义完全不变——条目始终是建议性元数据，每次提交仍是普通的 provider/model 对，由所属适配器校验。

宿主把每个已挂载的切片以可选的 `SessionModels.routing[]` 块（`SessionRoutingSection`：提供方身份、经 `credentials.describe` 的在场性解析出的 `credentialRequired`/`credentialReady`，以及两个条目列表）透传给浏览器。web 模型座位仅凭这份数据渲染三个根分组——路由 / 路由模型 / DSH模型——列表为空的分组行不显示；凭据未解析的条目保持可见但不可选，并附一条解释提示；网关提供方会被从 DSH 分组中滤除。没有路由切片的部署目录呈现与之前完全相同的单组行为。推理等级失去自己的根行：它现在以缩进的单选子组形式直接渲染在当前选中的模型行之下，适用于所有模型列表面板。

所有 LiteLLM 专属知识都留在其插件内：发布切片（按 cost/balanced/quality 排序的别名，指向同一 id 的档位合并为一条，直连模型剔除别名后的余集，以及 `credentialEnv`），加上新的 `litellmGateway.activeModel` Remote——返回最近一次完成请求的上游模型 id。取值在现有用量账本的 `llm/stream` 拦截内部从 finish chunk 的 pi-ai 回放封套（`response.responseModel`，即 OpenAI 兼容响应点名的具体后端）提取。失败绝不会移动该读数。插件向 composer 工具行左端座位贡献一个纯文本徽标：只要最近一次完成的响应带出了名字就显示它，在挂载时及所属会话 running→idle 轮次边缘刷新——没有轮询循环，跨线传输的只有名字本身。

## 备选方案的考虑

**让 `ui-model-selection` 直接认识 LiteLLM。** 到达目标菜单的最快路径，但直接否决：把消费者专属知识放进行为界面打破了仓库在其他地方已经执行的 capability-seam 规则，第二个网关出现时会立刻分叉渲染逻辑。

**通用多分组 catalog（`sections: {label, models}[]`）。** 更灵活，但当前唯一的消费者需要的恰好是 routes/direct 划分加一个凭据事实；开放式 sections 把标注策略推给提供方，却没有任何证据支持，还会招致风格各异的菜单。输给封闭的 `routes`+`models` 形状，直到第二种模式真正出现。

**为所有提供方扩展 `StreamChunk`（或浏览器 assistant 节点）携带上游模型。** 回放封套在设计上是适配器私有的，只有响应的适配器知道其 wire 方言里 `model` 是什么意思；把它穿进共享运行时词汇——或者把 `replayState` 折叠进通用 chat 节点以便转录侧订阅者能读到——是为单一插件拥有的展示性关注点支付核心复杂度。网关自有的账本提取在原本就合法的位置读取同一封套。

**经会话日志关联做按会话的上游归因。** 并发会话下能让徽标精确，但为了一个标签需要新建会话→插件的事件通道。暂缓；该 Remote 读数本身就自我声明为部署级，且失败时保留上一个正确名字而非错误归因。

## 后果

菜单结构自此端到端数据驱动：接入第二个路由型提供方无需改动 UI；未使用路由切片的部署除 DSH 分组改名外触发器行为逐字节一致。推理等级根行消失——键盘顺序与测试相应调整，`/model` 保持扁平（别名在内），因为扁平化在那里不损失任何东西。接受的代价：路由标签逐字跟随提供方配置（本地化的成本/均衡/高质量文案只存在于设置卡片）、徽标无法把后端归因到特定会话、缺少可识别回放封套的响应保留上一次读数，且 `routing` 块仅在至少一个已声明切片处于服务状态时出现在 `session.models` 响应上。覆盖面在单元层面钉住：注册表校验、网关发布与合并规则、账本提取/detach，以及座位上的每个新交互（分组导航、路由选择、直连选择、门控提示、触发器命名）。
