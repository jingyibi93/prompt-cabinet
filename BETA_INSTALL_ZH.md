# Prompt Cabinet Beta 安装说明（Apple Silicon Mac）

本测试版适用于配备 Apple 芯片（M1、M2、M3、M4）的 Mac。

## 安装

1. 在 GitHub Releases 下载 `Prompt-Cabinet-0.1.0-beta.2-mac-arm64.dmg`。
2. 双击打开 DMG。
3. 将 Prompt Cabinet 拖入“应用程序”文件夹。
4. 打开“应用程序”，右键点击 Prompt Cabinet，选择“打开”。
5. 在安全提示中再次点击“打开”。

由于这是未公证的内测版本，第一次启动必须使用右键“打开”。之后可以正常双击启动。

如果右键打开后仍被系统阻止：

1. 打开“系统设置”。
2. 进入“隐私与安全性”。
3. 找到 Prompt Cabinet 被阻止的提示。
4. 点击“仍要打开”。

## 首次使用 Insert

第一次使用 Insert 时，Prompt Cabinet 会请求“辅助功能”权限：

1. 按弹窗提示打开“系统设置 > 隐私与安全性 > 辅助功能”。
2. 打开 Prompt Cabinet 旁边的开关。
3. 回到目标输入框，再次点击 Insert。

## 数据

Prompt 默认存储在本机。卸载应用不会自动删除 Prompt 数据。建议在测试重要功能前使用“设置 > Export/Import”导出备份。

使用兼容 OpenAI 的 API 分析时，Prompt 会发送给用户自行配置的 API 服务商。本地规则分析不会发送网络请求。
