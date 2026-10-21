# LifeTools

个人工具合集。每个工具独立存放，目录内保留当前维护版本；旧版本通过 Git 提交历史查找。

| 目录 | 工具 | 使用说明 |
|---|---|---|
| `longform-reader/` | 长文伴读：PDF 阅读、划线、摘要、翻译和 OCR | [本地运行](longform-reader/本地运行.md) |
| `stay-aware/` | 别刷忘了 v1.6.3：B 站、小红书和 YouTube 浏览时长提醒 | [使用说明](stay-aware/使用说明.md) |
| `buffett-letters/` | 伯克希尔股东信、投资案例资料和站点构建脚本 | [项目说明](buffett-letters/README.md) |
| `pdf-tools/` | 下载、合并 PDF | [使用说明](pdf-tools/README.md) |

各工具分别运行，不共享安装依赖。长文伴读可双击 `longform-reader/启动长文伴读.command`；浏览器插件在 Chrome 扩展管理页加载 `stay-aware/` 文件夹。

## 本地目录

本机主目录为 `/Users/lukecao/Desktop/lifetools`。旧路径 `/Users/lukecao/Desktop/Luke的小工具` 保留为兼容链接，指向同一份文件，供现有启动入口使用。

本地另有 `apple-checkout-helper/`，本次保留原状，未纳入 GitHub 同步。历史安装包、验证截图和调试材料集中保存在本机 `.runtime/local-artifacts/`。

## 数据和版本

密钥、用户上传内容、阅读数据、依赖、OCR 环境和运行缓存保留在本地，不进入仓库。历史版本保存在 Git 提交记录中，不再另建版本存档目录。
