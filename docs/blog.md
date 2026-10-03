# Observing Agent Failures Through Event-Sourced Traces in DeepSeek Harness

Kun Huang · 2026-10-03 · 本文为可另行编辑发布的技术博客草稿。

同一个工具连续报错三次，Agent 最后仍然完成任务，应该算成功还是失败？模型请求失败后重试，应该增加一个 step 吗？用户按下取消键，能否算异常终止？这些问题使 Agent observability 超出了“把日志打印出来”的范围。可靠诊断需要区分过程事实、规则命中和任务结果。

我实现的 [dsh-agent-observability](https://github.com/beibeihk/dsh-agent-observability) 是 DeepSeek Harness 社区插件。它围绕三个要求展开：每个 finding 能追溯事件证据；默认只留元数据；轨迹能进入后续 evaluation。V1 不使用 LLM judge，也不提供一个缺乏定义的综合分数。

## 先找事实来源

Harness 的架构以 Cordis 插件组合为基础。Session、Agent、LLM、tools 与 UI 都通过服务和事件协作。Profile 决定一个应用实例使用哪些 bundles，bundle 的 patch 再修改插件树。因此，一个真正的生态插件应该进入官方插件装载流程，并遵守服务和 effect 的生命周期。

本项目从 committed `session/event` 获取新事实。模型调用的 settlement、工具 call/result、turn/step 的边界，都有 durable 事件。对于恢复和 fork，已有事件不会逐条重新发射；插件通过异步 `sessionQuery.observeSession()` 读取一次精确切片，释放 lease，再处理 bootstrap 期间缓冲的新事件。用 seq 去重后，切片和实时事件的交叠不会造成双倍统计。

这里必须区分 append-only log 与模型可见 surface。一次工具结果替换可能追加新的 log 记录，但它不等于工具执行完成了第二次。只有读懂 `surfaceOp` 与来源序号，duplicate-result detector 才不会误报。类似地，fork 可以继承父事件，但子 session 的指标只计算自己的工作。

## 观察器需要可证明的克制

`tools/pre-execute`、`tools/execute` 等 pipeline 可以改变执行行为；waterfall listener 如果没有正确继续 `next()`，甚至会阻断调用。V1 不需要拦截执行链，选择只读的 durable seam。

“只读”也不足以宣称完全没有影响：CPU 开销、内存压力和写盘仍然存在。项目将语义透明与性能代价分别验证。确定性 adapter 的两次真实 Harness loop 运行，一次带插件、一次不带，比较模型请求和 durable 数据；只归一化随机 UUID 与时钟字段。另一个微基准单独测量观察开销。

插件自己的 I/O 错误会产生通用 diagnostic，后台导出不会把主 Agent 的完成状态改成失败。人工 `/observe` 命令则返回可操作的导出错误。卸载由 Cordis fiber 清理监听、服务、命令和待完成的本地工作；重新挂载从 durable 证据重建指标。

## 从证据到 finding

设想某个 turn 中，三个连续 step 都执行 `lookup`，参数仅 JSON 对象键顺序不同。这是 F03：equivalent repeated calls。参数 canonicalization 保留值和数组顺序；等价比较使用每个 recorder 新生成的 HMAC key。Finding 保存三条 call 的 seq，而不是保存明文参数。

如果工具错误后换参数重试成功，T01 仍记录一次可观察错误，但整个 session 可以是 completed。如果用户取消，状态是 cancelled；未完成 call 不会因此被 F01/F07 判成执行失败。F06 “没有进展”则没有实现：工具成功和助手文本都不能为任意任务提供客观进展标准。这是数据契约的边界。

## 隐私与可研究性

默认输出保留事件身份、时间、状态、工具名、长度、redacted hash 和可靠 usage。启用内容捕获时仍会移除 secret 字段、常见 token、Authorization/Cookie 和自定义 regex；reasoning block 与 assistant stream 始终排除。插件的 redaction 不会追溯修改 Harness 自身的日志，也不是万能个人信息识别器。

JSONL 是逐 observation 的分析出口，summary JSON/CSV 是 session 层指标，eval JSONL 每行包含一个 finding 的标签、证据、配置记录、轨迹与 outcome。未来可以接入跨 Agent observatory，但这些标签目前只是确定性规则标签，不能直接当作任务奖励或因果解释。

## 实验真正说明了什么

36 项离线测试覆盖真实 loop、重试、并行、取消、JSONL 持久化恢复、fork、卸载重挂、内容过滤与导出。CLI demo 通过真实 `dsh plugin --profile headless add` 安装打包插件，再用官方 headless profile 完成一次工具调用。运行结果和截图都来自这次执行。

130 条合成轨迹的 session/type 标签 precision/recall 均为 1.0，FP/FN 均为零。但这些轨迹来自 13 个专门设计的模板，没有独立真实任务的多样性。这是规则一致性验证，不是“Agent 失败检测准确率 100%”。

在记录的 Node 24.12.0 / Windows 运行中，默认 recorder 增加约 9.62 μs/事件。使用真实 Session 分发后增加约 34.20 μs/事件，在纯消息微基准中占 +79.67%。后一个比例并不低，应正视和继续分析；计时区间没有模型等待和磁盘 I/O，不能换算成完整任务的延迟比例。

## 后续值得研究的问题

发布后补充的真实 provider smoke test 使用官方 API-key adapter 和 `deepseek-flash`，关闭 thinking，以 128 token/请求为上限。十个公开 marker lookup 任务都完成一次工具调用并返回预期标记，共 20 次请求、输入 4,228 token、输出 480 token，没有规则 findings。它验证了真实 provider 与 loop/observer 的协作，但任务过于受控，不能当作真实世界准确率。[逐任务结果](experiments/live-results.json)。

首先建立独立标注的公开任务集，保留有意 polling 等容易误报的负例，再评估阈值在不同工具和模型之间是否稳定。其次对高事件密度、多 session 和长内容进行 profiling，测峰值内存与任务尾延迟。最后才考虑引入 task-outcome judge，并把规则证据、人工标签和模型评价明确分开。

当前交付是一条可安装、可测试、可回溯的观测路径。它的价值在于让后续可靠性研究有明确的数据来源、边界和可复现实验，而不是声称仅靠 trace 就能理解全部 Agent 失败原因。

[技术报告与原始测量](technical-report.md) · [事件架构](architecture.md) · [failure taxonomy](failure-taxonomy.md) · [官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
