# Podnote 设计宪法 v4 —「双皮肤仪器」

> v4 修宪(2026-07):视觉语言从「编辑部纸面」(v3)换成**双皮肤仪器**。
> 信息架构、交互流程、快捷键与 v3 完全一致,只换视觉层。
> 真源 = 本文件 + `app/src/tokens.css` + `design/explorations/09-dual-theme.html`(交互原型)。
> v3 文档已删除;衬线字体族退役。

## 1. 核心机制:皮肤 × 外观

四种组合,同一份 DOM 与组件,零组件级分支:

| 维度 | 取值 | 载体 |
|---|---|---|
| 皮肤 skin | `cassette`(磁带机)/ `glass`(玻璃) | `<html data-skin>` |
| 外观 mode | `light` / `dark`(设置里可选「跟随系统」) | `<html data-mode>` |

- 组件**只消费语义 token**(色彩、圆角、阴影、字体全是变量),不感知皮肤。
- 少数结构性差异(播放器形态、选中态)走 `tokens.css` 里的皮肤作用域类(`.pn-player`、`.pn-item-active`)。
- 偏好存 localStorage(`pn-skin`/`pn-mode`),纯前端,不经 Rust;`index.html` 前置内联脚本在首帧前落属性防闪烁;URL 参数 `?skin=&mode=` 可覆盖(测试直达)。
- 运行期切换 API 在 `app/src/lib/theme.js`;设置页「外观」区是唯一入口。

## 2. 两张皮的气质

**磁带机 cassette(默认)** — Teenage Engineering / Braun 血统。浅灰/深灰机壳,实体按键(内阴影键程),
凹槽输入,LCD 荧光屏,TE 橙 `#FF4D00` 主动作。「磁带架」在这张皮里是字面意义。

**玻璃 glass** — Apple Liquid Glass 2025 血统。柔和渐变底上悬浮半透明毛玻璃面板(`backdrop-filter: blur(40px)`),
胶囊控件,悬浮播放器,系统蓝 `#0071E3` 主动作。与 macOS 原生气质无缝。

暗色不是反色:磁带机暗色 = 黑色特别版机壳(LCD 荧光绿不变、橙更亮);玻璃暗色 = 深蓝紫渐变上的暗玻璃。

## 3. Token 结构(详见 tokens.css,此处只列语义)

- **表面四层**:`--bg-app`(窗口底/渐变)→ `--surface-1`(面板)→ `--surface-2`(卡片)→ `--surface-well`(凹槽);
  另有 `--surface-hover`、`--border-unit`。
- **文字三档**:`--txt` / `--dim` / `--faint`。中文正文标签最低 13px;机壳小件(LCD 内)允许 12px;`--text-xs`(11px)仅限纯 ASCII 与数字。
- **语义色**:`--accent`(唯一强调 = 主动作/花钱/激活/错误)+ `--on-accent`;`--ok`(就绪,极小面积);`--warn`(运转中的机器提示)。
- **物理**:`--shadow-unit`(面板浮起)/ `--shadow-key`(按键)/ `--shadow-key-down`(按下)/ `--shadow-well`(凹陷)/ `--shadow-pop`(浮层,最大档);
  `--radius-unit/item/ctl/field/chip`(磁带机方,玻璃圆到胶囊);`--blur`(磁带机 0 / 玻璃 40px)。
- **字体两族**:`--font-ui`(磁带机 IBM Plex Sans / 玻璃系统 SF)+ `--font-data`(磁带机 IBM Plex Mono / 玻璃 JetBrains Mono)。
  等宽只给机器数据(时间戳/日期/时长/key/URL/用量);**中文禁入等宽**;数字一律 `tabular-nums`。字体本地打包(@fontsource),零外联。
- **v3 兼容别名层**:`--paper→surface-2`、`--panel→surface-1`、`--ink→txt`、`--scale→dim`、`--signal→accent`、`--ready→ok`、
  `--font-serif→font-ui`(衬线退役)。旧屏代码无需改写即换装;**新代码一律直接写 v4 token**。

## 4. 组件语言

- **机壳布局**:窗口是底座(`--bg-app` + `--frame-pad` 外框),侧栏与主区是两块 `.pn-unit` 浮起面板;
  设置/订阅整屏包在一块 unit 里,导航范式全局一致。
- **Button**:knob = accent 实底(只给「要花钱/要启动」的动作:添加、归档、立即检查);secondary = 实体按键(`--shadow-key`);ghost = 纯文字。
- **Segmented / Tab**:凹槽轨道(`--surface-well` + `--shadow-well`)+ 浮起的选中键(`--surface-2` + `--shadow-key`)。
  侧栏视图切换、阅读井 tab、设置协议选择、外观选择同语言。
- **Input / Select**:凹槽(`--surface-well` + `--shadow-well` + `--radius-field`),聚焦描 accent 边;下拉面板 = 卡片 + `--shadow-pop`。
- **EpisodeItem**:一盘磁带 = 一块 `.pn-card`。选中:磁带机 = 左缘 3px accent 墨条(inset shadow,不位移);玻璃 = accent 描边圈。
- **LCD 机读屏**(`.pn-lcd`):主区抬头,节目/日期/时长/状态一屏机读;磁带机 = 深底荧光绿,玻璃 = 半透明胶囊。状态在屏内呼吸。
- **Timestamp**:可按的机读小芯片(凹槽底 + 等宽数字),悬停转 accent,激活 = accent 实底,点击 `pn-flash` 一次。
- **IndicatorLight**(产品之魂,不变):灰待命 / 呼吸运转 / 绿常亮完成 / accent 常亮需要人。
- **Waveform**(产品之魂,不变):真峰值刻度条;只有播放位置所在章节锚点用 accent。
- **播放器**(`.pn-player`):磁带机 = 面板底部通栏走带台;玻璃 = 底部悬浮胶囊。播放键 = accent 实底圆钮。
- **节标题**:accent 小芯片序号(01/02…)+ 无衬线粗标题 + 虚线延伸。
- **引语**:卡片承载(`.pn-card`),无衬线 medium,15px,行高 1.8。
- **抽屉**(问答/核查,`.pn-drawer`):主区 unit 内的右侧第三栏,**永远左中右并排、永不覆盖正文**(v3 的窄窗覆盖式浮层已废止);
  `--surface-1` 底 + 左发丝线,玻璃皮加 backdrop blur;正文可以被压窄,但不许被盖住。
- **浮层**(菜单/划词浮层/AddFlow/下拉):`--surface-2` + `--border-unit` + `--shadow-pop`;玻璃皮加 `backdrop-filter`。仅这些真浮层允许悬浮。

## 5. Do / Don't

- ✅ 一切颜色/圆角/阴影/字体走 token;写死一个十六进制色 = 违宪。
- ✅ accent 是稀缺资源:一屏同时可见 ≤3 处;它只表达「注意力该在这里」(主动作/花钱/激活/错误)。
- ✅ 新界面必须在 4 种组合(`?skin=cassette|glass&mode=light|dark`)下自测再交付。
- ✅ 中文界面一律全角标点。
- ❌ 组件里写 `data-skin` 条件分支(结构性差异只许进 tokens.css 的皮肤作用域类)。
- ❌ 衬线字体回潮;uppercase 丝印风(机壳徽标 `TAPE ARCHIVE` 是唯一豁免)。
- ❌ `--shadow-pop` 之外新增阴影档;平面文字元素加投影。
- ❌ 循环动画(仅指示灯呼吸豁免);一次性动效 >200ms。

## 6. 动效(继承 v2/v3 + v4 新增)

120ms 急停 `cubic-bezier(0.2,0,0,1)`,一次性动效 ≤200ms;所有按钮按压下沉 1px;`prefers-reduced-motion` 全关。
v4 唯一新增:**换装动效** — 切换皮肤/外观时,新主题从屏幕中心圆形扩散铺开(View Transitions,480ms,一次性;引擎不支持时瞬时切换)。

## 7. Agent 提示词速查

- 面板:`className="pn-unit"`,内容自己排;卡片:`className="pn-card"`。
- 主动作按钮:`<Button variant="knob">`(accent 实底);普通按键 `secondary`;文字键 `ghost`。
- 分段/tab:`<Segmented options value onChange>`。
- 机读屏:`className="pn-lcd"`,里面等宽机器数据 + 12px UI 字体中文名。
- 新颜色需求先问:能不能用 `--accent/--ok/--warn/--dim` 表达?不能 = 大概率不该做。
