# Luke 的小工具

个人工具源码，2026-09-30 整理。

| 目录 | 用途 |
|---|---|
| `longform-reader/` | 长文伴读：PDF 阅读、划线、摘要、翻译和 OCR |
| `stay-aware/` | 别刷忘了 v1.2.1：YouTube、B 站、小红书浏览时长提醒 |
| `lifetools/Buffet_Letters/` | 伯克希尔股东信、案例资料和站点构建脚本 |
| `lifetools/` | PDF 下载、合并等个人脚本 |
| `archive/stay-aware-v1.0.0/` | 浏览时长插件旧版源码 |

## 使用

长文伴读：进入 `longform-reader`，运行 `npm ci`，参考 `.env.example` 配置，再运行 `npm start`。本地运行说明和产品文档保留在子目录。

浏览时长提醒：在 Chrome 的扩展管理页面启用开发者模式，加载 `stay-aware` 文件夹。

股东信工具：使用 `lifetools/Buffet_Letters/README.md` 中的安装和构建步骤。

密钥、用户上传文件、阅读数据、依赖和运行缓存保存在本地，不进入仓库。各工具分别运行，不共享安装依赖。历史部署配置作为项目资料保存。
