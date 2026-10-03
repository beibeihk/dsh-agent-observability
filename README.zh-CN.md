# dsh-agent-observability

面向 **DeepSeek Harness** 的社区插件：以持久化事件为依据，默认保护内容隐私，并把可追溯的可靠性发现导出为评估数据。项目独立维护，不代表 DeepSeek 官方。

[English](https://github.com/beibeihk/dsh-agent-observability/blob/main/README.md) · [示例报告](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.html) · [技术报告](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md) · [学习指南](https://github.com/beibeihk/dsh-agent-observability/blob/main/DEEPSEEK_HARNESS_STUDY_GUIDE.md)

## 快速开始

**安装**：准备 Node.js `^22.19.0 || >=24` 和 pnpm，从 [v0.1.0 Release](https://github.com/beibeihk/dsh-agent-observability/releases/tag/v0.1.0) 下载预构建 tarball。

```sh
npm install --global @deepseek-ai/dsh@0.2.0-rc.2 pnpm
dsh plugin --profile web add ./beibeihk-dsh-agent-observability-0.1.0.tgz
```

**启用**：`add` 自动把 bundle 加入所选 profile。确认配置中出现 `agent-observability`：

```sh
dsh --profile web --dump-config
```

**运行**：执行 `dsh web`，按通常方式配置自己的模型并完成任务，然后在当前会话输入 **`/observe`**。这是人工命令，直接显示报告，不发起模型回合。插件也会在 turn 完成和 session flush 时自动导出。

**查看报告**：命令会返回输出目录，打开其中的 `report.html`。默认路径为 `$DSH_HOME/profiles/web/observability/<会话ID摘要>/`，默认 Harness home 为 `~/.dsh`。同目录包含 `trace.json`、`trace.jsonl`、`summary.json`、`summary.csv`、`eval.jsonl` 和 `report.txt`。

npm 包名已准备为 `@beibeihk/dsh-agent-observability`；registry 发布尚需维护者本人登录。当前安装入口是 Release tarball，请不要把尚未发布的 npm 包当成可用安装路径。

### 不需要 API key 的真实 Harness demo

```sh
git clone https://github.com/beibeihk/dsh-agent-observability.git
cd dsh-agent-observability
npm ci --ignore-scripts
npm run demo
```

demo 会构建、打包，用真正的 `dsh plugin --profile headless add` 安装，再通过真正的 `dsh --profile headless --patch ...` 启动官方 agent-loop。只有模型适配器和工具是确定性的离线实现。生成文件位于 `artifacts/demo/`；独立 `.demo-home` 不改动已有 profile。实验关闭 Harness 自身遥测，不调用付费 API。[可复制示例](https://github.com/beibeihk/dsh-agent-observability/blob/main/examples/basic-observability/README.md)。

## 功能

按 Session、Turn、Step 和工具调用重建轨迹，计算可靠性指标，执行有明确证据的规则检测，输出人工报告和后续 benchmark 可读的失败 case。每条发现都保留事件 seq。默认报告使用指标和发现，不构造任意总分。

## 为什么这样设计

仅打印日志容易把一次重试算成一个新 step，把取消算成失败，或把历史替换算成重复工具结果。Harness 的 session log 是模型上下文的事实来源，观察器应读取这些事实，并保持 agent 的行为语义。

## 输出示例

```text
Session Reliability Report
Status: completed
Turns: 1 | Steps: 2 | Model requests (settled): 2
Tool calls: 1 | Successes: 1 | Failures: 0 | Cancelled: 0
Detected Issues:
- None detected
```

来自离线 Harness demo。[完整输出](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.txt) · [静态 dashboard](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.html)。页面没有脚本、外部资源或联网服务。

## 检测规则

| ID | 可观测模式 | 默认规则 |
|---|---|---|
| F01 | 关闭且完整的观察区间中，调用缺少终结结果 | error；取消与 fork 关闭除外 |
| F02 | 同一 turn/step/call 出现多个终结结果 | error；历史 surface replacement 除外 |
| F03 | 连续等价参数调用同一工具 | 60 秒内 3 次 |
| F04 | 同一工具在连续 step 中失败 | 连续 3 次 |
| F05 | 单 step 中已结算模型 attempt 过多 | 超过 3 次 |
| F07 | 持久化的异常 turn 终结 | error/interrupted；策略或 token 限制为 warning |
| F08 | call 到 result 的延迟过长 | 超过 30 秒 |
| F09 | 工具错误比例偏高 | 超过 50%，至少 4 个成功/错误结果 |
| F10 | request/header 或 context 频繁变化 | 至少 5 次；info |
| T01 | 一次工具错误 | info；恢复后仍可完成任务 |

F06 暂缓：公开事件不能客观证明任务是否取得了有效进展。这些规则识别运行与轨迹中的可观测模式，不解释所有失败原因，也不判断答案是否正确。[定义、阈值、误报风险和反例](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/failure-taxonomy.md)。

## 架构

官方 `dsh.bundle.patch` 插入一个 Cordis 插件，依赖 `sessions` 和 `sessionQuery`。实时读取只观察 `session/event`；恢复和重载通过公开的异步 `sessionQuery.observeSession()` 租约重放历史。`ctx.dshObservability` 提供异步 `trace()`、`export()`、`flush()` 和诊断，可选人工命令服务提供 `/observe`。注册随 fiber 卸载而撤销。

不修改核心、不 monkey patch、不改 node_modules、不拦截 waterfall，也不向模型增加工具或提示。[架构](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/architecture.md) · [集成](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/integration.md)。

## 隐私

**默认 metadata-only，插件不发送遥测。** 内容采集需要 `captureContent: true`，脱敏始终开启。reasoning blocks 与嵌入的 assistant stream 始终排除；正文摘要来自脱敏后的数据，参数等价比较使用会话内临时密钥的 HMAC。工具私有 meta 不导出。[隐私机制与边界](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/privacy.md)。

Harness 自己的遥测和 provider session-log 行为由上游控制，插件安装不会改变它们。插件脱敏也不会重写 Harness 原始日志。

## 性能

Node 24.12.0 / Windows x64 实测：仅 recorder 默认记录增加 **9.62 μs/事件**；官方 `Session.append` 与事件观察合计增加 **34.20 μs/事件**（在这一纯消息微基准中为 **+79.67%**）。内容模式后者增加 27.64 μs/事件。计时区间不含模型和磁盘 I/O，不能转换成整个任务的耗时增幅。堆内存及 RSS 差值受 GC 和系统调度影响。[原始结果](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/benchmarks/results.json) · [实验方法](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md)。

130 条合成轨迹得到 TP=130、FP=0、FN=0，precision/recall 均为 1.0；统计单位是 session/type 标签对。样本来自 13 个设计模板的有限变体，不是独立真实任务，结果只验证所定义的规则。

`npm run benchmark` 验证 130 条预标注合成轨迹，运行 10,000 事件微基准，输出 precision、recall、误报、时间、吞吐量、heap/RSS 变化和投影/序列化成本。[原始结果](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/benchmarks/results.json)。极简循环基线与完整 Harness 任务延迟不是同一口径，报告不把两者混为一谈。

默认最多保留 64 个 recorder，每会话最多 100,000 个事件，内容模式每条 payload 最多保留 16 KiB。历史初始化和导出队列有界，超限会给出诊断。写盘采用异步快照与单文件原子替换；不会逐 token 写盘或 fsync。

## 兼容性

测试对象为发布的 **DeepSeek Harness `0.2.0-rc.2`** 与 Cordis `4.0.4`。peer 使用精确 prerelease，`engines.dsh` 同步声明。尚未声称兼容其他版本或 `0.2.1-alpha.1`。[兼容验证](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/compatibility.md)。

## 开发

```sh
npm ci --ignore-scripts
npm run validate
npm run test:coverage
npm run benchmark
npm run demo
npm pack
```

CI 在 Node 22.19+ 和 24 执行 lint、typecheck、离线测试、build、合成基准和官方启动器安装 demo。生产代码只使用公开接口；弃用的同步历史读取仅用于测试检查。

## 局限

token 汇总仅覆盖提供可靠 usage 的 assistant message，`usage_coverage` 标示覆盖率；崩溃前尚未结算的模型请求不计入 settled request。没有推算 context utilization、任务进展评分、网络轨迹、隐藏 reasoning、完整 PTC 子调用模型或真实世界准确率。fork 指标只统计 child 自有工作，继承证据保留标记。dispose/remount/replay 已测试；没有宣称完成文件监视器驱动的 source-HMR 压力矩阵。

各文件单独原子替换，不是跨文件事务。硬崩溃可能丢失尚未导出的区间，之前写好的 JSONL 仍可解析。V1 不自动删盘上历史，按需删除对应摘要目录。[恢复与清理](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/integration.md)。

## 后续方向

通过独立 exporter 和 detector 扩展到 Agent Reliability Observatory、OpenTelemetry、benchmark adapter 和显式启用的 judge。V1 保持本地文件和确定性规则，不实现远程遥测或 LLM judge。

MIT · © 2026 Kun Huang。项目采用官方建议的 DSH 缩写命名，明确社区身份。
