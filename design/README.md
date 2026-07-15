# design/ — 设计真源

| 文件 | 状态 | 说明 |
|---|---|---|
| `DESIGN-v4.md` | **现行设计真源(v4「双皮肤仪器」)** | 与 `app/src/tokens.css` 共同构成 v4 宪法;皮肤机制、token 结构、组件语言、Do/Don't 都在这里 |
| `explorations/09-dual-theme.html` | **v4 交互原型** | 双皮肤 × 亮暗四种组合的可切换原型,浏览器直接打开;右上角切换器,支持 `?skin=&mode=` 直达 |
| `explorations/07-teenage-cassette.html` | 历史探索 | v4 磁带机皮肤的单皮肤前身 |
| `explorations/08-liquid-glass.html` | 历史探索 | v4 玻璃皮肤的单皮肤前身 |

v1(整页设计稿)、v2(仪器风 standalone)、v3(编辑部纸面)及 2026-07 设计方向探索的其余方案已删除,如需追溯走 git 历史。

改设计系统的规则:先改 `DESIGN-v4.md` 真源,再同步 `tokens.css` 与组件,禁止只改代码侧(见根目录 CLAUDE.md 的设计系统章节)。新界面交付前必须在四种组合(`?skin=cassette|glass&mode=light|dark`)下自测。
