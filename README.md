# opencode-model-sync

![license](https://img.shields.io/badge/license-MIT-green.svg)
![node](https://img.shields.io/badge/node-%3E%3D18-blue.svg)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

一个 **OpenCode 本地插件**，在 OpenCode 启动时自动同步远端 provider `/models` 到 `opencode.json` 的 `provider.<name>.models`。

- ✅ 本地插件（放到 `.opencode/plugin/`）
- ✅ 零依赖（仅 Node.js 标准库）
- ✅ 安全写入（先备份，再原子替换）
- ✅ 支持 dry-run 与多种返回格式

## 安装

将插件文件复制到项目目录：

```text
.opencode/plugin/model-sync.js
```

> 注意：目录是 `plugin`（单数），不是 `plugins`。

## 配置示例（JSONC）

请参考完整样例：[`examples/opencode.example.jsonc`](examples/opencode.example.jsonc)。

## 快速使用

1. 在 `opencode.json` 中给目标 provider 配置 `options.modelSync.enabled = true`。
2. 设置 API key 环境变量。
3. 启动 OpenCode。

### Windows PowerShell

```powershell
$env:MINGIE_API_KEY = "sk-xxxx"
opencode
```

### macOS / Linux

```bash
export MINGIE_API_KEY="sk-xxxx"
opencode
```

## 同步行为

插件启动后会：

1. 按优先级定位配置文件（`OPENCODE_CONFIG` → 向上查找 → `~/.config/opencode/opencode.json`）
2. 查找启用了 `modelSync.enabled === true` 的 provider
3. 请求 models endpoint
4. 兼容提取：
   - `{ object: "list", data: [...] }`
   - `[...]`
   - `{ models: [...] }`
5. 比对差集并追加模型（不覆盖、不删除）
6. 非 dry-run 模式下创建备份并原子写入

## dry-run 测试

将 `modelSync.dryRun` 设为 `true`：

- 会打印远端/本地/新增数量和新增模型 ID
- 不会创建备份
- 不会写入 `opencode.json`

## 最小测试样例（本地 mock）

本仓库提供 `node --test` 可运行的最小验证：

```bash
node --test test/model-sync.test.mjs
```

其中会启动本地 HTTP 服务，返回：

```json
{ "object": "list", "data": [{"id":"test-model"}] }
```

并验证可正确提取模型与同步写入行为。

## FAQ / 排障

### 1) 插件没有加载

- 检查路径是否为 `.opencode/plugin/`（单数）
- 文件扩展名是否是 `.js`
- Node 版本是否 `>= 18`

### 2) HTTP 401 / 403

- 检查 `apiKey` 对应环境变量是否存在
- 检查 `{env:XXX}` 拼写

### 3) 出现 `/v1/v1/models` 或 `/v1models`

- 检查 `baseURL` 结尾斜杠
- 检查 `endpoint` 开头斜杠
- 插件已做标准化拼接，建议使用 `baseURL: https://host/v1` + `endpoint: /models`

### 4) 返回格式不兼容

- 查看日志中错误信息
- 扩展 `extractModelIds` 的字段映射逻辑（目前支持 `id/name/model`）

### 5) 写入后模型选择器未刷新

- 必须重启 OpenCode（provider/models 在启动时加载）

### 6) 备份越来越多

- 可定期清理 `opencode.json.bak.*`

## 安全与隐私声明

- 插件不会上传数据到第三方服务
- 仅请求你在 provider 里配置的 endpoint
- 不打印 API key / Authorization 完整值
- 请求失败、超时、JSON 解析失败时不会写入配置

## 风险说明

- 该插件会修改 `opencode.json`，请先确认配置文件可写
- 强烈建议将 `opencode.json` 纳入版本管理
- 若 provider 模型列表变化频繁，备份文件可能快速增长

## 开发

```bash
node --test
```

## 版本

当前版本：`0.1.0`

变更历史见 [`CHANGELOG.md`](CHANGELOG.md)。

## License

MIT
