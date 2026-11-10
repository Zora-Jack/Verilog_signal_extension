# Verilog Signal Trace

[简体中文](README.md) | **English**

Verilog Signal Trace is a VS Code extension for reading RTL. It grew out of three questions that come up when reading CPU pipelines and AXI bridges. Where is this signal declared? Which signals determine its value? Which logic depends on it? Start at a signal under the cursor and follow each result to the Verilog expression that establishes the dependency.

## Current features

| Version | What you can do |
| --- | --- |
| `v0.1.0` | Hover over a signal to see its explicit declaration, module, and line number. Press `F12` to jump to the declaration. Verified with internal wires, registers with declared widths, module ports, and signals that share a name across modules in the same file. |
| `v0.2.0` | Right-click a signal and choose **Verilog：查看直接上下游** (show direct dependencies) to trace one step upstream or downstream through continuous assignments in the current module. Each result shows the direction, signal name, line number, and assignment expression. Select it to jump to the relevant operand or assignment target. |
| `v0.3.0` | Trace data in both directions through nonblocking writes in edge-triggered `always` and `always_ff` blocks. Each result shows the event control and assignment line. |
| `v0.4.0` | Inspect data sources and enclosing `if/else` and `case/casez/casex` branches separately. Each guard identifies its write site and jumps to the predicate or branch label. |
| `v0.5.0` | Follow data and control dependencies across multiple steps within a module and return to previous source locations. |
| `v0.6.0` | Follow named port connections across files and instances while preserving the instance context and previous source locations. |
| `v0.7.0` | Draw a graph of direct relationships, expand individual signals, and navigate to declarations, writes, and guards. |
| `v0.8.0` | **撤销展开** undoes the last node expansion. Click **聚焦** on a relationship to isolate its two endpoints and all direct edges between them. Edge navigation stays active. **清除聚焦** restores the previous graph. |

The extension reads the current editor buffer and traces continuous assignments such as `wire x = expr;` and `assign x = expr;`. An empty list means it found no dependencies in the constructs it supports. Clocked tracing accepts rising and falling edges on simple signals, including edge lists. Macro expansion and `generate` constructs are outside the current scope.

## Try it with take_data

In the exp15 CPU project, `myCPU/sram_axi_bridge.v` asserts `take_data` when the bridge accepts a data-side request.

```verilog
wire take_data = data_sram_req && data_sram_addr_ok;
```

Select `take_data` and run **Verilog：查看直接上下游**. All five results and their jump targets were verified in the VS Code Extension Development Host.

| Direction | Signal | Jump target in the tested revision |
| --- | --- | --- |
| Upstream | `data_sram_req`, `data_sram_addr_ok` | Line 128. Each result selects its own operand in the same expression. |
| Downstream | `take_load` | Line 129, where the bridge identifies a read request. |
| Downstream | `take_store` | Line 130, where the bridge identifies a write request. |
| Downstream | `issue_inst` | Line 174, where the instruction-fetch issue condition includes `!take_data`. |

Right-click `data_sram_req` and select **Verilog：多级追踪信号**. Follow the downstream data links to `take_data` and `take_load`, then select the guarded write to `load_state` on line 153. Its guard is on line 152. The separate result on line 165 uses `take_load` to select a value in a ternary expression. Choose **返回上一步** to restore the previous source location. A signal already on the path can be visited once more, where expansion stops.

## Run and develop

Open the extension folder in VS Code 1.85 or later and press `F5` to launch the Extension Development Host. Open a Verilog project in that window and place the cursor on a signal to try hover, Go to Definition, and the context menu command. If you have a local VSIX package, you can also install it with **Extensions: Install from VSIX...**.

[signals.js](signals.js) indexes source text and resolves dependencies. [extension.js](extension.js) provides hover information, navigation, and the results list. Write Git commit subjects and bodies in English.

Right-click a signal and choose **Verilog：绘制上下游关系图**. Click a node to expand it, Ctrl+click to jump to its declaration, or click an edge label to show the assignment or port binding. The **条件** button jumps to the guard. In exp15, the two edges from `take_load` to `load_state` lead to the guarded write on line 153 (guard on line 152) and the value selection on line 165.

## Cross-file tracing

Open the RTL folder for one design, such as the exp15 `myCPU` directory. Follow `inst_rdata_reg` to `inst_sram_rdata`, go up through `mycpu_top.u_bridge`, then descend into `u_mycpu_core` and `u_if_stage`. Starting inside a module lists its possible parent instances. After entering a particular instance, upward navigation follows that instance.

Each multi-hop session scans .v, .vh, .sv and .svh files in the current workspace folder and uses the current text of open documents. Direct module instances with explicit named connections of the form `.port(signal)` support input, output and inout directions. Duplicate module definitions, positional connections, expressions, bit selects, generate constructs and macro expansion are outside this release.
