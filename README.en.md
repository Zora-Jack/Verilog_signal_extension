# Verilog Signal Trace

[简体中文](README.md) | **English**

Verilog Signal Trace is a VS Code extension for reading RTL. It grew out of three questions that come up when reading CPU pipelines and AXI bridges. Where is this signal declared? Which signals determine its value? Which logic depends on it? Start at a signal under the cursor and follow each result to the Verilog expression that establishes the dependency.

## Current features

| Version | What you can do |
| --- | --- |
| `v0.1.0` | Hover over a signal to see its explicit declaration, module, and line number. Press `F12` to jump to the declaration. Verified with internal wires, registers with declared widths, module ports, and signals that share a name across modules in the same file. |
| `v0.2.0` | Right-click a signal and choose **Verilog：查看直接上下游** (show direct dependencies) to trace one step upstream or downstream through continuous assignments in the current module. Each result shows the direction, signal name, line number, and assignment expression. Select it to jump to the relevant operand or assignment target. |
| `v0.3.0` | Trace data in both directions through nonblocking writes in edge-triggered `always` and `always_ff` blocks. Each result shows the event control and assignment line. |

The extension reads the current editor buffer and traces continuous assignments such as `wire x = expr;` and `assign x = expr;`. An empty list means it found no dependencies in the constructs it supports. Clocked tracing accepts rising and falling edges on simple signals, including edge lists. Write conditions, macro expansion, `generate` constructs, and connections across instances are outside the current scope.

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

## Run and develop

Open the extension folder in VS Code 1.85 or later and press `F5` to launch the Extension Development Host. Open a Verilog project in that window and place the cursor on a signal to try hover, Go to Definition, and the context menu command. If you have a local VSIX package, you can also install it with **Extensions: Install from VSIX...**.

[signals.js](signals.js) indexes source text and resolves dependencies. [extension.js](extension.js) provides hover information, navigation, and the results list. Write Git commit subjects and bodies in English.

## Roadmap

1. **Add control conditions to clocked writes.** Use `inst_rdata_reg` in exp15 as the first test case. Its data comes from `rdata`. The write depends on the `I_WAIT` state, the read-channel handshake, and the response ID. The register in turn drives `inst_sram_rdata`. Show the data source, write conditions, and active clock edge separately.
2. **Follow multiple steps within a module.** Let the reader expand a result while keeping the assignments already visited. When a feedback path returns to a signal, mark that signal and stop expanding the cycle.
3. **Trace across files and module instances.** Follow a parent module’s port connection into the corresponding child instance. Preserve the instance path when a module is instantiated more than once so each result leads to the correct connection in the source.
