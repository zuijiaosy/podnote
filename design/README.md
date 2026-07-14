# design/ — 设计真源与历史快照

| 文件 | 状态 | 说明 |
|---|---|---|
| `Podnote-standalone.html` | **现行设计真源** | 仪器风设计系统的权威版本,`app/src/tokens.css` 与 `app/src/components/` 从这里原样移植 |
| `Podnote-v2.html` | 历史快照 | 第二版设计探索 |
| `Podnote-v1.html` | 历史快照 | 最初的整页设计稿 |

这些是自包含的 HTML 导出物(内嵌脚本与样式),直接用浏览器打开即可查看。
其中的 `@font-face` 指向导出时的占位引用,缺失时会回落到系统字体,不影响评审。

改设计系统的规则:先改真源,再同步 `tokens.css`,禁止只改代码侧(见根目录 CLAUDE.md 的设计系统章节)。
