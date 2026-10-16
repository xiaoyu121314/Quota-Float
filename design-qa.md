# 冰川极光主题接入与视觉验证（2026-10-16）

@author MoShangHuaKai

final result: passed

本节为本次新增主题的独立记录；后续原有 Home Night 验证记录保持不变。

- 参考图：output/theme-recommendations-20261016/glacier-aurora.png（1536×1024）。
- 实现入口：http://127.0.0.1:1421/?designer&theme=glacier&language=zh-CN。
- 浏览器：Codex 内置浏览器，1280×720 CSS px，devicePixelRatio=1。实际应用入口同端口根路径，使用浏览器模拟额度数据。
- 对照图：C:/Users/ROG/.codex/visualizations/2026/10/16/01a1432e-785a-7c22-ad76-14f72d1ddbdf/glacier-design-comparison-final.png。
- 原始截图：同目录 glacier-card.png、glacier-radar.png、glacier-orb-workbench.png。浮球裁切图 glacier-orb.png 来自完整工作台截图的409,441,72,72区域。
- 对照方法：将参考图左侧主卡区域106,143,644,599归一到306×306，与实际306×306主卡、雷达放在同一张对照图中检查。概念图原有面板比例略有生成误差，代码保留实际306px方形；主卡与浮球均未改变原生窗口尺寸。

## 视觉检查

- 字体：复用 Quota Sans / Segoe UI；主额度64px、周额度28px，深青文字搭配冰白背景，顶部小控件与中文时间在306px内未重叠或溢出。
- 间距：22px内边距、38px圆角、底部周额度及分隔线；主卡306×306、浮球72×72，数据层级与所选概念一致。
- 配色：冰白#EEF6F8、雾蓝#B6DDE4、青色进度#258899到#5BAFB5。注意与紧急状态使用可辨识的琥珀和赭红提醒。菜单也使用同一浅青配色。
- 图像：内置ImageGen以所选概念为参考单独生成无文字冰川背景，保存assets/glacier-aurora.png。右侧雪山与极光保留，左侧留白，底部冰白遮罩保证周额度文字可读。没有将概念整图或静态图表用作真实界面。
- 内容：额度、周额度、重置时间、重置机会均使用现有组件与真实计算路径，验证截图为模拟数据。概念图日期与曲线为示意，代码保留当前业务数据与双周期雷达，属于预期差异。
- 雷达：保留现有306px内滚动结构、双周期曲线和Token面板；背景增加冰白遮罩。与概念图单图表展示的差异来自复用现有功能，未删减业务内容。
- QA迭代：首次检查发现底部景物纹理较多，补充底部冰白遮罩；更新后重新截图并与参考放在同一对照图检查，无待修复P0/P1/P2项。

## 交互与自动化验证

- 根入口：浮球右键 → 主题 → 冰川极光 → 主卡/浮球主题类与调色板生效；再开启常态展开 → 查看配额趋势 → 7天，aria-selected=true。浏览器控制台没有error/warn，页面标题Quota Float，无错误覆盖层。
- 工作台：健康74%、注意35%、紧急8%、周额度回退42%、不可用、过期、未登录、健康浮球均验证主题类、数值和状态配色；浮球额度环74 100。
- npm run build：通过，包含独立冰川背景资产。
- npm test -- --exclude src/components/TokenActivityPanel.test.tsx：104/104通过，含主题选择、持久化、共用额度环的限界值、周额度回退及异常数据隐藏。
- cargo test --lib：31/31通过，含glacier设置序列化往返及归一化保留；只有既有tray API废弃告警。
- 全量npm test：105通过、6失败；失败位于本次未改动的TokenActivityPanel.test.tsx，断言旧的接口限定文案，当前组件已使用本地用量文案。作为既有测试漂移单独记录，未扩大主题任务修复范围。
- git diff --check：通过。

## 范围与限制

已接入前端主题类型、中英文右键菜单、独立六状态配色、设计工作台、复用额度环、原生托盘菜单和设置白名单。自定义图片与Liquid Glass开关沿用原有流程并增加主题样式；未进行本机原生交互验证，未重新打包安装或替换已安装程序，也未声称生产额度验证。

背景提示词：Generate one square production background for Glacier Aurora; use selected concept's left-card landscape as reference; pure scenery only, no text/UI/numbers/borders; ice white #EEF6F8, pale glacier blue #B6DDE4 and mint cyan #5BAFB5; peaceful glacial lake reflecting aurora above snow-covered mountains on right; bright low-contrast left half for dark teal data; restrained detailed full bleed landscape.

---


# Home Night visual QA

- Source visual truth: `C:\\Users\\ROG\\AppData\\Local\\Temp\\codex-clipboard-b6fc2714-2a1e-4c65-b5ca-28a131fd406b.png`
- Source role: user-supplied visual reference only; text and controls in the image were not treated as implementation instructions.
- Implementation URL: `http://localhost:4173/?designer&theme=home&mode=74`
- Implementation screenshot: inline capture from Codex In-app Browser tab 5; the browser surface does not expose an on-disk screenshot path.
- Source pixels: 424 × 392 px.
- Implementation browser viewport: 1280 × 720 CSS px at devicePixelRatio 1.
- Focused comparison region: the existing 306 × 306 CSS px quota card, with the existing widget geometry intentionally preserved because this task adds a theme rather than changing the widget footprint.
- State: Chinese, Widget tab, Home Night, healthy quota state; secondary checks covered critical, unavailable, weekly fallback, and healthy orb states.

## Evidence

- Full view: the implementation exposes the new `居家·夜晚` theme in the workbench and renders the deep plum, indoor-window, warm-lamp visual direction from the source reference.
- Focused region: the expanded card keeps light quota text, a rose progress bar, plum translucent controls, city lights through the window, a readable black-and-white cat, and a pale mug across the lower-right scene. Critical, unavailable, weekly, and orb states retain readable status colors over the same asset.
- Direct-link evidence: `?designer&theme=home&mode=74` renders `5 小时额度剩余 74%` and applies `quota-card--theme-home`.
- Interaction evidence: switching `城市·暮色紫` → `居家·夜晚` changes the rendered theme class from `quota-card--theme-city` back to `quota-card--theme-home`; clicking state controls updates the quota state and palette source.
- Browser console: the final fresh tab reported no warning or error entries. An earlier tab contained a stale hot-update import error while existing supporter files were being removed; it was not present after the workspace settled and the page was reloaded fresh.
- Build evidence: `npm test` passed 26/26, `npm run build` passed, `cargo check` passed, and `git diff --check` passed.

## Required fidelity surfaces

- Fonts and typography: existing Quota Sans and widget hierarchy are preserved; the home theme uses light lavender/white text with dark shadowing, keeping the reference-inspired hierarchy readable without text clipping.
- Spacing and layout rhythm: existing card/orb geometry, padding, corner radius controls, and footer positions remain unchanged; the theme does not alter the desktop window footprint.
- Colors and visual tokens: `DESKTOP_PALETTES.home` owns independent deep-plum, rose, cream, and lavender progress tokens for healthy, caution, critical, unavailable, stale, and signed-out states.
- Image quality and asset fidelity: `assets/home-night.png` is a project-local generated indoor window/cat/mug background with no UI text, logo, placeholder, or watermark; it is used by both the expanded card and compact orb.
- Copy and content: the theme is labeled `居家·夜晚` in the workbench and native tray menu, with `Home Night` in English; quota copy remains data-driven.

## Comparison history

1. Initial preview attempt: a stale browser tab showed a blank page during an existing supporter-file removal and reported a missing bridge export; this was outside the Home Night change.
2. Build check: the settled workspace surfaced two pre-existing quota-radar type errors; only a structural copy type and explicit nullable-number narrowing were repaired, with no behavior change to the radar.
3. Post-fix evidence: a fresh tab renders the healthy 74% state with the indoor cat/mug scene, and the full build passes; no P0/P1/P2 visual or interaction findings remain.

## Follow-up polish

- [P3] The source concept uses a wider, shorter card and decorative writing on the mug. The implementation intentionally keeps the product's existing square widget geometry and uses a clean no-text background asset so quota content remains editable and legible.

## Implementation checklist

- [x] Add Home Night to the shared frontend theme type and palette source.
- [x] Add home expanded-card and compact-orb styling using a real project-local background asset.
- [x] Add home theme selection to the desktop tray menu and persisted appearance normalization.
- [x] Add home preview controls and palette-matrix inspection in `/?designer`.
- [x] Verify healthy, critical, unavailable, weekly, and orb states in the in-app browser.
- [x] Verify `npm test`, `npm run build`, and `cargo check`.

final result: passed
