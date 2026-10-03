# DeepSeek Harness 学习与面试指南

本指南对应本项目 v0.1.0、published Harness 0.2.0-rc.2 和 Cordis 4.0.4。官方 master 的新设计不能自动当成该发布版已经实现的契约。先读 [upstream audit](docs/upstream-audit.md)、[官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)，再运行 demo 和 integration tests。

## 一、Cordis：插件如何协作

**Plugin** 是挂载到 Context 的扩展单位。它可以提供 Service、监听 Event、注册资源，也可以挂载子插件。Harness 的 Agent 系统本身由插件构成，社区插件并非附属在一个不可替换的大核心外面。

**Context** 是有生命周期和作用域的协作入口。它承载服务可见性、事件和插件树；一个子 Context 可以具有自己的资源所有权。`ctx.plugin()` 返回的 fiber 是挂载与卸载的实际管理边界。不要把 Context 理解成随便修改的全局对象。

**Service** 是可注入的能力，例如 `ctx.sessions`、`ctx.sessionQuery` 和本项目的 `ctx.dshObservability`。`inject` 声明所需能力；服务不满足时，不应假装功能已就绪。可选的 `ctx.inject(['commands'], ...)` 在命令服务可用时添加人工命令。

**Event** 是有明确分发语义的 typed contract。emit/parallel 的通知与 serial/waterfall 的控制流不同。waterfall listener 可以影响链的结果；要继续执行必须按具体接口调用 `next()`。本项目用 observe-only committed `session/event`，无需承担工具执行链的控制职责。

**Effect** 管理可逆资源。资源注册必须绑定插件的生命周期：卸载时清理 listener、command、service、timer/queue 等。本项目通过 `ctx.effect()` 等待导出队列、终止 history lease 读取并清空缓存；Cordis 的 listener/service/command 注册随 fiber 撤销。用“进程退出后都会清理”替代 effect，会在 reload 时留下旧对象。

## 二、Harness：运行入口与能力边界

| 概念 | 理解方式 | 与本项目的关系 |
|---|---|---|
| profile | 一个应用实例的持久配置与选定 bundles，例如 web/headless | 默认输出在当前 profile 的 observability 目录 |
| bundle | 携带一组可组合配置的包级分发单位 | npm/tarball 通过 `dsh.bundle.patch` 声明配置 |
| patch | 对插件配置树的声明式修改 | 插入 `agent-observability` 行，不改核心源码 |
| plugin tree | 挂载、注入、作用域和资源所有权的运行结构 | 决定何时激活与如何撤销观察器 |
| session | durable 事实记录和模型上下文推导的基础 | 我们的原始证据边界 |
| agent | 绑定 session、具有生命周期与运行状态的执行对象 | 人工命令收到当前 agent，读取其 session |
| agent-loop | 将 turn/step、LLM 与 tools 编排成运行循环的插件 | integration tests 执行真实发布版 loop |
| tools | 工具注册、schema、执行与可见结果的能力 | 通过 durable call/result 观察执行结果 |
| LLM | adapter、模型信息、请求和流的统一能力 | 离线 adapter 经公开注册入口参与真实 loop |
| capability seam | 可替换且有契约的服务/事件接口 | 选择 sessions/query，不 import 私有文件 |

真实安装命令是 `dsh plugin --profile web add <spec>`。安装选择 bundle，bundle patch 挂载 plugin；随后通过官方 `dsh web` 启动应用。不要另外造一个与 profile/config 生命周期脱节的 Agent launcher。本项目也没有修改 node_modules 或 monkey patch 方法。

HMR 是插件生命周期问题，也涉及模块依赖与已有状态。本项目实际验证的是 dispose → 新挂载 → durable replay，不声称完成所有文件 watcher/source HMR 压力测试。

## 三、Session event sourcing

**Append-only** 指事实记录追加新事件，不通过改旧记录伪装历史。它不意味着模型下一次看到“历史所有内容的简单拼接”。模型可见 surface 由日志推导；logged replacements、清理等操作可能改变有效视图。

**Model-visible means logged** 的要点：模型请求上下文变化要有可追溯的 durable 事实。诊断不能读取某个隐含缓存，再假设模型看见了同样内容。项目的 message count 是追加消息数，不冒充 replacement 后当前上下文长度或 history growth。

**deriveMessages** 表达从 session 事实推导模型消息视图这一过程。不要为了取指标复制其内部实现，也不要未经核验把某个符号当成本版 public export。本项目读取 logged header/context 及其可证明的元数据，不另外计算私有消息视图。

**Replay** 是将一个确定的事件切片再次折叠为派生状态。插件用 query lease 的不可变切片；初始读取期间的新事件先进入有界 buffer。按 seq 去重后，buffer 与初始切片交叠不重复统计。seq 缺口或截断必须在 integrity 中暴露。

**Projection** 是原始事件到结构化视图的派生函数。我们的 `project()` 是中立 trace 的纯 projection；它不是替代 Harness 自身的模型上下文 projector。Session、turn、step、call 的 key 保留来源身份，方便审计。

**Replacement** 是 model-visible surface 的替换证据。新增 replacement 记录依然在 durable log 中，但不能因此增加第二个 terminal tool result。F02 排除 replacement；保留来源 seq 使人可以回到原记录查看。

**Resume** 通过官方 persistence 读回原 session，再继续执行。测试实际做 start → flush → stop → 新 runtime → resume，对比前缀 summary，再执行第二个 turn。

**Fork** 可以带着父 session 的 inherited prefix 创建子 session。子 trace 标记 parent 和 inherited count，继承事件作为上下文证据保留，但子 summary 和 failure 检测只统计 child-owned work。否则父错误会污染子任务评价。

## 四、Turn、Step 与 Attempt

```text
Turn：一次运行轮次
 ├─ Step 1
 │   ├─ Model attempt 1 → transient failure / assistant/attempt
 │   ├─ Model attempt 2 → assistant/message
 │   ├─ Tool call A、B
 │   └─ Tool result B、A
 └─ Step 2
     └─ Model settlement → final answer
```

一个 turn 可以需要多次模型调用：先选择工具，再读取工具结果，最后作答。Retry 可以发生在同一个 step 内，因此 attempt 不能直接当 step。我们按 durable assistant settlements 计请求次数，对每个 step 计算额外 attempt；丢在 durable settlement 之前的请求没有可证明的计数。

Call/result 通过 `(turn, step, callId)` 关联，不能按完成顺序 zip。并行工具 B 先完成不意味着 A 的结果属于 B。Tool duration 是 call 到 result 的时间；多个并行工具的时长和可以大于 session wall time。

Usage 只累计公开、可靠的 assistant message counters，并报告覆盖率。没有 usage 不补零当成已知真实消耗，不用字符数伪装 token。Context window 是容量；没有可靠输入规模时不报 context utilization。

## 五、工具管线与透明观察

```text
durable tool/call
  ↓ tools/pre-execute
  ↓ tools/execute
  ↓ tools/post-execute
durable tool/result
```

前三个 `tools/*` 是控制/执行能力；`tool/call`、`tool/result` 是 session 证据。先看官方 event map 的 exact name 与分发模式，不能根据名字猜 listener 签名。本项目不监听执行 waterfall，避免忘记 `next()` 或改变结果。Agent live events 适合 UI 和运行状态观察，但 assistant-stream 可能包含 reasoning，并不适合 V1 durable metric 来源。

透明性的验证不是“代码看起来只读”。`tests/integration.test.ts` 对实际 published loop 的 with/without 两次执行比较 semantic durable events 和准确的 model-visible requests；只移除时钟字段并归一化随机 UUID。CPU/内存开销另测，不能由语义等价推出零性能影响。

## 六、六个模块如何解释

| 模块 / 文件 | 输入 → 输出 | 关键 invariant | 主要证据 |
|---|---|---|---|
| Recorder / `src/recorder/index.ts` | committed envelope → detached observations | 有界、seq 去重、正文默认不保留、raw data 不改写 | replay、bounds、真实 loop、secret tests |
| Metrics / `src/metrics/index.ts` | observations → turns/steps/calls/summary | retries 不加 step、call identity、子任务排除 inherited | parallel、retry、cancel、resume、fork |
| Detectors / `src/detectors/index.ts` | trace + thresholds → findings | 证据 seq 可回溯、没有数据不推定缺失 | F01–F10 counterexamples、golden、synthetic labels |
| Exporters / `src/exporters/index.ts` | trace → JSON/JSONL/CSV/eval/files | 一行可解析、路径不注入、每文件原子替换 | JSONL property、I/O failure、官方 demo |
| Redaction / `src/redaction/index.ts` | structured/text payload → filtered payload | 两种 capture 均过滤 secret、reasoning 排除、idempotent | 假 key/header/env/marker、150 arbitrary strings |
| Report / `src/report/index.ts` | trace → plaintext / static HTML | 不执行 captured HTML、不用任意总分 | golden text、HTML escaping、真实截图 |

Host entry `src/index.ts` 负责注入、query lease、生命周期和队列。算法与 host adapter 分离，使 `./analysis` 可以被跨 Agent 平台使用，而不要求调用者重建 Cordis Agent。

## 七、35 道面试题与参考答案

### 1. 为什么 Agent observability 难？

事件横跨请求重试、工具并行、上下文替换、取消和恢复。临时 live 状态与 durable settlement 不同，任务最终正确性又是另一层。必须先定义事实、身份与计数单位，再讨论 failure。

### 2. 为什么不用 console.log？

Console 可辅助定位，却没有稳定 schema、durable sequence、fork provenance 或 replay contract。可研究的 finding 需要关联 call identity 和确切 evidence seq，并在重新读取时得到同样指标。

### 3. Session event 和 Agent event 有什么区别？

Session event 是已提交的轨迹事实；Agent event 服务于当前运行生命周期与控制协作。例如真实 live seam 有 `agent/status`、`agent/request`、`agent/assistant-stream`。需要根据每个事件的公开 contract 和分发模式选择，而不是认为所有 live event 都能持久重放。

### 4. Durable 与 live 能混用吗？

可以作为不同证据层，但不能把同一事实重复计数或让 live 推测覆盖 durable 事实。V1 指标只用 durable。若未来增加 live latency，应标明观测时钟、落盘边界和 crash 丢失风险。

### 5. 为什么 metadata-only？

调试通常先需要类型、身份、时序、状态和可用 usage，未必需要整段 prompt/output。默认少收集降低泄露与存储风险；内容捕获要显式启用，且仍需 redaction。元数据也不是天然无敏感信息。

### 6. 如何对应 tool call/result？

以 turn、step 和 callId 为关联 key。Call 的字段是 `data.callId`，result 的字段是 `data.message.toolCallId`；不能假设两边形状一样。Replacement 是 surface evidence，不是新 terminal completion。

### 7. Parallel tools 怎么处理？

先记录所有 call，再按 ID 收集各 result，顺序不相关。性质测试随机排列合法完成顺序，确认状态不串号。时长求和与 wall-clock span 分别解释。

### 8. Retry 怎么算？

每个 step 的 durable assistant attempt/message 是 settled request evidence；额外 settlement 计 retry，step 本身不重复计。缺乏 durable settlement 的启动请求不计入已知总数。这是可观测计数的边界。

### 9. Cancellation 是 failure 吗？

用户主动取消是 cancelled outcome，不能简单映射为 F07。取消留下 pending call 也不证明 missing result 的执行故障。工具本身的中止 result 要与普通 error 区分。

### 10. 如何判断 tool loop？

F03 检查短窗口内同工具与等价参数的连续调用；F04 检查连续 step 的同工具错误。两者不同：重复调用可能成功，错误 loop 可能改变参数。都需阈值和反例，不能宣称主观“没有思考”。

### 11. 如何降低 false positive？

精确限定 observation interval、排除 replacement/inherited/cancelled，成功和 step 间隔能打断 error run，暴露 threshold 与 evidence。为合法 polling、预期错误、换 route 和不完整捕获建立独立负例。

### 12. 为什么先不用 LLM-as-a-judge？

可客观定义的规则更可复现，标签能直接回到 seq，且无需外部数据传输。Judge 应另用于任务正确性等难以规则定义的层，并独立验证一致性、偏差、成本和隐私。

### 13. Event sourcing 是什么？

将变化记录成追加的事实序列，再从其推导当前视图或统计。它让恢复和审计有来源，但不能保证日志完整，也不自动证明任务成功；projection 与事件版本必须明确。

### 14. 如何 replay 而不双倍统计？

获取 async query lease 的一次精确切片，初始化期间 buffer live events，再按 sequence 去重。对 gap/truncation 暴露 incomplete 标记。每次 remount 重新建 recorder，不能保留旧 listener 与新 recorder 两套统计。

### 15. 插件如何卸载？

Dispose 挂载 fiber，让它撤销 listener/service/command 注册，并通过 effect 等待本地 queue 与读取清理。测试卸载后 service 和命令消失，再挂载 replay 后计数准确；仅清空某个 Map 不足以卸载插件。

### 16. Cordis effect 是什么？

可逆资源的所有权机制。注册资源时就定义清理，生命周期结束时执行。异步工作尤其要考虑 dispose 时是否仍会写盘或持有 lease，避免 stale state 和重复资源。

### 17. 如何证明 observer 不改变语义？

用确定性 adapter/tool 运行真实 loop 的 with/without 对照，比较 durable payload、模型请求消息和 tool schemas。只归一化不可比较的生成 ID/时钟字段。这个测试只支持所测 composition，不能证明所有第三方插件组合。

### 18. HMR 会导致什么问题？

旧 listener 未撤销、命令双注册、读写 queue 残留、服务指向旧实例、replay 重复或种子丢失。项目验证 dispose/remount/replay；源文件 watcher 压力测试仍是明确未验证范围。

### 19. 如何 benchmark observer overhead？

分别测 recorder 与真实 Session 分发；同负载、模式轮换、warm-up、多轮 median，报告绝对每事件增加时间及相对 baseline。当前 dispatch metadata 增加 34.20 μs/事件、纯消息耗时 +79.67%，不能把它当作整个模型任务耗时增幅。

### 20. 如何处理 secret？

先减少 capture，再对结构字段及文本模式做 redaction，always exclude reasoning/streams，按 session HMAC 比较参数，测试序列化后的 JSONL/eval。不能将 pattern filtering 宣称成完全 DLP，导出前仍需按分享目的审查。

### 21. 如何变成 eval dataset？

保留 neutral schema 版本、配置事件、observable trace、规则 label、evidence、outcome 和 integrity/privacy。统计单位是 session/type label pair。独立人工任务标注应另存，避免将 detector 的输出直接当外部 ground truth。

### 22. 如何变成 RL training data？

需要合法数据授权、明确 trajectory/action 边界、任务 outcome 与独立 reward 定义。现有规则标签可作为过程候选特征或负例筛选，不能直接把“工具报错”作为负 reward，因为探索与恢复也可能有价值。

### 23. Model failure 与 Harness failure 怎么区分？

先描述事实：请求错误、工具错误、durable 异常终止或捕获缺失。再结合 provider/error code、复现和控制实验归因；同一 tool error 可能来自工具输入、环境或执行实现。V1 不自动判责。

### 24. 如何接 OpenTelemetry？

在 neutral exporter seam 映射 session/turn/step/call span 与属性，显式选择远程 endpoint、身份和隐私策略。Span ID 与 durable seq provenance 都保留。新增网络队列须有 backpressure 与 opt-in，当前未实现。

### 25. Multi-agent 怎么扩展？

增加明确 parent/child/link 与独立 session identity，区分 inherited context 和新执行，避免父子双计 token/tool。不同 session 的时钟和 happens-before 需要额外契约，不能仅按 timestamp 排序声称因果链。

### 26. 如何比较 Codex 与 dsh？

把各自公开证据映射到相同 neutral definitions，同时保留来源和 coverage。统一任务与环境，先报告哪些信息不可比，再做指标对比。不能把 settlement count 与另一系统的 request-start count 混用。

### 27. 为什么对 post-training 有价值？

可回溯的过程模式帮助定位数据筛选、恢复策略和工具使用训练的候选目标。价值来自可审计数据基础，不代表这些规则就是有效 reward；仍需独立 task-outcome 和干预实验验证。

### 28. 哪些 failure 不能靠 trace 判断？

答案正确性、研究推理质量、用户真实目标、任务有效进展，以及缺少外部 ground truth 的工具结果真实性。没有日志的网络尝试和隐藏 CoT 也不能可靠重建。

### 29. 本项目最大的限制是什么？

规则在设计合成样本上验证，还没有独立真实任务集；session-only 事实不能覆盖所有启动/中断请求；不同版本的 contract 仍在演化。性能与隐私的保证也只在已测 workload/pattern 范围内。

### 30. 如果进入 DeepSeek，下一步做什么？

先用公开任务和独立标注建立负例丰富的评测集，验证 taxonomy 与阈值，再 profiling 高事件密度与多 session workload。向团队提供复现、测量和反例，不用一个 100% 合成分数替代真实可靠性评估。

### 31. 为什么不实现 F06 “没有进展”？

多个 step、文本变化或工具成功都不是任意任务的客观 progress。需要任务状态机、环境 transition 或明确 goal metric。缺少这类 public evidence 就不实现，避免规则混入主观评价。

### 32. 崩溃安全保证到什么程度？

已写完成的文件通过临时写入后 rename 替换，此前 JSONL 保持完整可解析。七个文件不是事务，且没有 fsync 保证；硬崩溃可能丢失本轮尚未导出的区间。恢复时以 Harness durable session 重新投影。

### 33. 如何解释 130 条轨迹 precision/recall 为 1？

它说明规则与预定义 synthetic labels 一致。13 模板各 10 次，变化有限，不是独立真实世界样本；不能报告通用 failure accuracy 100%，也不能据此给可靠置信区间。

### 34. Metadata hash 是否天然匿名？

不是。公开 hash 可被低熵字典猜测，标识符和工具名也可能泄露信息。这里 content hash 作用于 redacted content，参数比较用不导出的 session HMAC key；这些措施降低特定风险，不构成完全匿名化。

### 35. 如何保证未来版本兼容？

声明确切 peer version，追踪 public types 与 event contract，用 packed installation、semantic contrast、resume/fork 和 teardown 测试验证后才扩大范围。不依赖某个私有源码路径，也不把 engines 字段当成运行时强制校验的全部。

## 八、动手验证顺序

1. `npm ci --ignore-scripts && npm run validate`，阅读 semantic comparison 而不是只看 PASS。
2. `npm run demo`，找到 call/result 的 seq，解释为什么 two requests = two steps 在此例成立，但通常不能这样等同。
3. 查看 `fixtures/repeat-loop`，将参数键顺序变化与 F03 的 evidence 对照。
4. 阅读 `tests/integration.test.ts` 的 retry/cancel/resume/fork 和 command disposal，逐条指出它们检验的 contract。
5. `npm run benchmark`，对照 [技术报告](docs/technical-report.md) 解释统计单位、计时范围、内存噪声和外推限制。

面试前至少能亲自解释：插件生命周期、durable/model-visible 边界、call/step/attempt 身份、隐私采集边界，以及实验的结论与不能推出的结论。
