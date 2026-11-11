# Verilog Signal Trace

**简体中文** | [English](README.en.md)

[从 VS Code Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=ZoraJack.verilog-signal-trace)

Verilog Signal Trace 是一个用于阅读 RTL 源码的 VS Code 扩展。开发这个插件的起点，是阅读 CPU 流水线和 AXI 转接桥时经常遇到的三个问题：一个内部信号在哪里声明，哪些值决定它，以及它又会影响哪些逻辑。插件从光标所在的信号出发，让每一条查到的关系都能跳回对应的 Verilog 语句。

## 安装与快速上手

使用 VS Code 1.85 或更新版本。已经取得 VSIX 时，在命令面板运行 **Extensions: Install from VSIX...** 并选择安装包。打开单个设计的 RTL 文件夹，在一个已声明的信号上右键选择 **Verilog：查看直接上下游**。扩展直接读取当前文本，无需安装 Ctags 或仿真器。

[中英双语商店介绍](MARKETPLACE.md) · [下载最新 VSIX](https://github.com/Zora-Jack/Verilog_signal_extension/releases/latest)

## 当前进度

| 版本 | 已实现的功能 |
| --- | --- |
| `v0.1.0` | 悬停显示显式信号声明、所属模块和行号，按 `F12` 跳到声明。已用内部 `wire`、带位宽的 `reg` 和模块端口验证，并检查了同一文件中不同模块的同名信号。 |
| `v0.2.0` | 在信号上右键选择 **Verilog：查看直接上下游**，查看当前模块中连续赋值的一层依赖。结果列出方向、信号名、行号和赋值表达式，选择一项即可跳到表达式中对应的信号。 |
| `v0.3.0` | 对边沿触发的 `always` / `always_ff` 中的非阻塞写入，双向追踪右值数据与写入目标，并在结果中显示触发边沿和赋值行。 |
| `v0.4.0` | 查询时序写入目标时，分别列出上游数据和包围该写入的 `if/else`、`case/casez/casex` 分支。条件项标明所属赋值行，选择后定位到谓词或分支标签。 |
| `v0.5.0` | 在当前模块内连续追踪数据依赖和控制关系，可沿路径返回上一处源码。 |
| `v0.6.0` | 在多级追踪中沿命名端口跨文件进入子实例或返回父模块，保留实例路径与每步源码位置。 |
| `v0.7.0` | 右键绘制可展开的上下游关系图，分别跳到信号声明、赋值和写入条件。 |
| `v0.8.0` | **撤销展开**逐步恢复上一次展开前的图。在任意两节点间的关系上点**聚焦**，可单独查看它们之间的全部直接关系并跳回源码；**清除聚焦**恢复先前视图。 |
| `v0.8.1` | **选择信号对**可选当前图涉及的模块实例中的显式信号，即使两个信号都未展开或显示。聚焦从两个端点查询当前索引支持的直接关系；清除后恢复原图。 |

当前追踪范围包括 `wire x = expr;` 和 `assign x = expr;` 等连续赋值，分析使用编辑器中的当前文本。时序分析支持简单信号的上升沿、下降沿及其事件列表，可查看各写入点的分支条件。对宏展开及 `generate`的分析尚未覆盖，因此列表为空只表示在当前支持范围内没有找到关系。

## 用 take_data 验证

在 exp15 的 `myCPU/sram_axi_bridge.v` 中，数据侧请求被接受时，`take_data` 有效：

```verilog
wire take_data = data_sram_req && data_sram_addr_ok;
```

选中 `take_data` 并执行 **Verilog：查看直接上下游**。以下五个结果均已在 VS Code 扩展宿主中逐项验证：

| 方向 | 结果 | 在测试版本中的跳转位置 |
| --- | --- | --- |
| 上游 | `data_sram_req`、`data_sram_addr_ok` | 第 128 行，同一表达式中的两个操作数可以分别跳转 |
| 下游 | `take_load` | 第 129 行，读请求的判定 |
| 下游 | `take_store` | 第 130 行，写请求的判定 |
| 下游 | `issue_inst` | 第 174 行，取指请求的发出条件包含 `!take_data` |

选中 `data_sram_req`，右键 **Verilog：多级追踪信号**。依次选择下游数据 `take_data`、`take_load`，再选第 153 行的受控写入 `load_state`。其条件位于第 152 行；第 165 行的同名目标是三元表达式的受控选值。选择“返回上一步”恢复上一个源码位置。路径中已经出现过的信号可以定位，继续展开会在该处停止。

## 运行与开发

维护版本时可参照[发布流程](PUBLISHING.md)同步 Marketplace 和 GitHub Release。

使用 VS Code 1.85 或更高版本打开插件目录，按 `F5` 启动扩展开发宿主。在新窗口中打开 Verilog 工程，将光标放在信号名上即可测试悬停、定义跳转和右键命令。已有本地 VSIX 安装包时，也可以通过 **Extensions: Install from VSIX...** 安装。

源码索引与依赖查询位于 [signals.js](signals.js)，VS Code 的悬停、跳转和结果列表位于 [extension.js](extension.js)。Git 提交的标题和正文使用英文。

在信号上右键选择 **Verilog：绘制上下游关系图**。单击节点展开一层，Ctrl+单击节点跳到声明，点击关系标签跳到该关系的赋值或端口连接；“条件”定位到控制写入的分支。在 exp15 中，`take_load` 到 `load_state` 有两条边：控制写入定位到第 153 行（条件在第 152 行），控制选值定位到第 165 行。

## 跨文件追踪

将单个设计的 RTL 目录作为工作区打开，例如 exp15 的 `myCPU`。从桥的 `inst_rdata_reg` 追到 `inst_sram_rdata`，选择 `mycpu_top.u_bridge` 返回顶层，再进入 `u_mycpu_core` 和 `u_if_stage`。在子模块源码中直接开始时，各父实例分别列出；从指定实例进入后，向上只返回该实例。

每次启动多级追踪会扫描当前工作区文件夹的 .v、.vh、.sv 和 .svh 文件，采用已打开文件的当前文本。支持直接模块实例的显式命名连接 `.port(signal)`，按 input、output、inout 标记方向。重名模块定义、位置连接、表达式、位选、generate 和宏展开暂未覆盖。

## 贡献者

Zora Jack 提出信号追踪需求，确定功能范围，并在 CPU 实验工程中试用扩展、反馈问题。OpenAI Codex 作为 AI 编程助手参与实现 RTL 依赖分析、跨实例追踪和交互关系图，并编写和运行回归测试。
