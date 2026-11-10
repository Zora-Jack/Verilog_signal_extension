# 发布到 Visual Studio Marketplace

商店页面使用中英双语的 [MARKETPLACE.md](MARKETPLACE.md)。发布包的文件清单由 package.json 中的 files 指定。仓库 README 和 GitHub Release 可独立维护。

1. 在 [发布者管理页面](https://marketplace.visualstudio.com/manage) 登录 Microsoft 账号，核对自己有权使用的 Publisher ID。它必须与 package.json 的 publisher 一致。当前本地扩展沿用 local-rtl；更换发布者会改变扩展 ID，安装过旧 VSIX 的用户需另行安装新 ID。
2. 检查版本号后，在插件目录运行以下命令。项目目前没有单独的许可证文件，打包命令显式保留这个现状。

   ```powershell
   node --test test/*.test.js
   npx --yes --package @vscode/vsce@4.1.0 vsce package --no-dependencies --readme-path MARKETPLACE.md --skip-license --out verilog-signal-trace-0.8.2.vsix
   ```

3. 在发布者管理页面选择该发布者，通过 **New extension → Visual Studio Code** 上传生成的 VSIX。以后更新已有条目时，选择该扩展的更新版本操作。也可以在本机完成 CLI 身份验证后运行以下命令。

   ```powershell
   npx --yes --package @vscode/vsce@4.1.0 vsce publish --packagePath verilog-signal-trace-0.8.2.vsix
   ```

4. 等待 Marketplace 完成验证，再从扩展页核对发布者、版本号和双语说明，并在 VS Code 扩展视图里验证安装。

仓库可维持私有。商店介绍全文包含在 VSIX 中。具体身份验证方法见 [微软发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
