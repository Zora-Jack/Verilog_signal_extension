# 维护者发布流程

Verilog Signal Trace 的正式扩展 ID 是 `ZoraJack.verilog-signal-trace`。发布新版本时，用同一个 VSIX 更新 Marketplace 和 GitHub Release，方便用户通过任一渠道安装相同版本。

1. 在准备发布的提交中核对 `package.json` 的版本号、发布者和文件清单，更新[商店介绍](MARKETPLACE.md)。从干净的工作区测试并打包：

   ```powershell
   $version = (Get-Content -Raw package.json | ConvertFrom-Json).version
   $package = "verilog-signal-trace-$version.vsix"
   node --test test/*.test.js
   if ($LASTEXITCODE) { throw 'Tests failed' }
   npx --yes --package @vscode/vsce@4.1.0 vsce package --no-dependencies --readme-path MARKETPLACE.md --skip-license --out $package
   if ($LASTEXITCODE) { throw 'Packaging failed' }
   Get-FileHash $package -Algorithm SHA256
   ```

   当前项目尚无单独的许可证文件，打包时使用 `--skip-license`。保留这个安装包供两个渠道上传。

2. 在 [Marketplace 发布者管理页](https://marketplace.visualstudio.com/manage) 选中已有扩展，上传新版本。验证通过后，在[商店页](https://marketplace.visualstudio.com/items?itemName=ZoraJack.verilog-signal-trace)核对版本号。
3. 给实际用于打包的提交打 `v<版本号>` 标签并推送。在 GitHub 针对该标签创建 Release，将同一个 VSIX 上传为附件并发布。[查看 Releases](https://github.com/Zora-Jack/Verilog_signal_extension/releases)
4. 以未登录用户身份打开 Release，下载安装包并核对 SHA-256。VSIX 由 Git 忽略，源码和发布附件分别存放在提交和 Release 中。
