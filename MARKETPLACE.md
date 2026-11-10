# Verilog Signal Trace

从一条 RTL 语句出发，查看谁给信号赋值、哪些条件控制写入，以及信号经过哪个实例端口。支持 VS Code 1.85 及以上版本，分析在扩展宿主中完成，无需额外安装 Ctags、仿真器或综合工具。

## 第一次使用

打开一个设计的 RTL 文件夹，将光标放在信号的使用处。悬停可查看声明，按 F12 可定位到声明行。右键菜单提供三个命令：

| 命令 | 用途 |
| --- | --- |
| Verilog：查看直接上下游 | 查看数据来源、下游使用和时序写入条件，点击结果选中对应的 RTL。 |
| Verilog：多级追踪信号 | 沿一条路径继续展开，跨越命名端口进入具体实例，或返回上一步。 |
| Verilog：绘制上下游关系图 | 单击节点展开，Ctrl+单击节点查看声明。点击关系标签定位到赋值行，点击“条件”定位到控制语句。 |

例如，下面两个 always 块分别展示“控制写入”和“控制选值”。在 en 上绘图，en 到 q 和 r 的两条边会标明各自的作用。

```verilog
module example(input wire clk, en, d, output reg q, r);
  always @(posedge clk) if (en) q <= d;
  always @(posedge clk) r <= en ? d : q;
endmodule
```

工具栏中的“选择信号对”可查询图中涉及的模块实例内两个显式声明信号的直接关系，即使两个信号尚未展开。清除聚焦后可继续查看原图。

## 支持范围

支持连续赋值、常见边沿触发块中的非阻塞赋值、if/else 和 case 分支，以及直接模块实例的命名端口连接。跨文件追踪扫描当前工作区文件夹中的 .v、.vh、.sv 和 .svh 文件，并采用已打开文件的当前文本。建议单独打开一个设计的 RTL 目录。宏展开、generate 展开、位置端口和复杂端口实参尚未覆盖。

## English quick start

Open the RTL folder for one design in VS Code 1.85 or later. Hover over a declared signal to inspect its declaration, or press F12 to jump there. The context menu commands use the Chinese labels listed above, in order: **direct dependencies**, **multi-hop tracing**, and **relationship graph**.

In the example, en controls whether q is written and selects the value written to r. Click an edge label to inspect its assignment. Click a node to expand it, or Ctrl+click it to open its declaration. Pair focus queries both endpoints even when they have not yet appeared on the graph.

The extension analyzes source locally in the extension host. It traces named port bindings across instances and handles common continuous and clocked assignments. Macro and generate elaboration, positional ports, and compound port arguments are outside its current scope.
