# 灵感追踪

灵感追踪是一个面向自媒体运营的选题与内容辅助工具，基于 RedFox 热点数据和可配置 LLM，帮助创作者发现热点、筛选低粉爆款、跟踪 IP 选题资产，并生成适配不同平台的内容草稿。

## 功能

- 热榜浏览：查看抖音、公众号等平台热点数据。
- 选题发现：按关键词或客群画像搜索关联热点。
- 低粉爆款雷达：从互动量、粉丝量、发布时间等维度筛选可参考内容。
- IP 运营工作台：维护 IP 档案、长期选题、快照和选题资产库。
- 爆款拆解：对可参考作品生成结构化拆解。
- 文案生成：为小红书、抖音、视频号、公众号生成差异化内容草稿。
- API 设置：在页面中配置 RedFox 和 LLM 参数，敏感值仅做掩码展示。

## 技术栈

- 前端：Vite + 原生 HTML/CSS/JavaScript
- 后端：Node.js + Express
- 数据：本地 JSON 文件持久化运行时配置和选题资产

## 快速开始

### Windows 桌面启动

先安装 Node.js LTS，然后双击项目目录中的 `start-desktop.bat`。

脚本会自动完成以下动作：

- 安装依赖
- 构建前端页面
- 启动本地服务
- 用浏览器 app 窗口打开 `http://localhost:3001`

升级时拉取最新代码后再次双击 `start-desktop.bat` 即可。

### 开发模式

```bash
npm install
cp .env.example .env
npm run start
```

访问 Vite 开发服务：

```text
http://localhost:5173
```

后端默认端口：

```text
http://localhost:3001
```

## 环境变量

复制 `.env.example` 为 `.env` 后填写以下配置：

```env
REDFOX_HOST=redfox.hk
REDFOX_API_KEY=your_redfox_api_key
LLM_BASE_URL=https://api.example.com
LLM_API_KEY=your_llm_api_key
LLM_MODEL=step-3.5-flash
```

也可以启动应用后，在页面顶部的「API 设置」中配置这些参数。运行时设置会保存到 `apiSettings.json`，该文件已被 `.gitignore` 忽略。

## 常用命令

```bash
# 启动前端和后端开发服务
npm run start

# 只启动后端
npm run server

# 只启动前端
npm run dev

# 构建前端静态资源
npm run build

# 构建并以桌面模式启动
npm run desktop
```

## 数据文件

- `apiSettings.json`：运行时 API 配置，本地生成。
- `trackerData.json`：IP 档案、选题、快照和资产库，本地生成。
- `keywordConfig.json`：关键词权重和反馈配置。

`apiSettings.json` 和 `trackerData.json` 属于本地运行数据，默认不会提交到 Git。

## 注意事项

- RedFox API Key 和 LLM API Key 请只写入 `.env` 或页面设置，避免提交到仓库。
- 小红书和视频号接口目前会在界面中明确提示未接入。
- 当前版本使用本地 JSON 文件保存运行时数据，适合个人或小团队本地使用。
