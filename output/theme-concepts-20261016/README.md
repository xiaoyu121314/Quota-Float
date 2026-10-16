# Quota Float 主题示例套图

@author MoShangHuaKai

日期：2026-10-16（Asia/Shanghai）

用途：在现有主题基础上比较三套视觉方向，每套包含主卡、悬浮球和额度雷达。均为 AI 概念预览，数值为模拟数据，尚未应用到程序。

## 原图

- [月下竹影](jade-moon.png)
- [深海星航](abyssal-orbit.png)
- [赤月剑影](crimson-eclipse.png)

三张图片均为 1536 × 1024 PNG。图片用于选定视觉方向；坐标、时间与图线为生成式示意，实际接入时复用现有组件的数据计算与准确排版。

## 设计依据

- 当前主卡与雷达可见区域为 306 × 306，圆角 38；浮球 72 × 72，永恩主题为圆形。
- 保留主额度、周额度、重置时间和顶部工具的现有层级。
- 示例：5 小时剩余 74%，本周剩余 42%。
- 字体参考现有 Segoe UI / SF Pro；雷达降低背景对比度，保证曲线和小字可读。
- 生成工具：内置 ImageGen；使用实际项目卡片、雷达和浮球截图作为参考。

## 推荐方向

| 方向 | 配色 | 适合偏好 |
| --- | --- | --- |
| 月下竹影 | 玉白、松绿、薄雾 | 长时间桌面常驻、安静浅色主题 |
| 深海星航 | 深蓝、冰青、星轨 | 深色桌面、科技感、强调数据 |
| 赤月剑影 | 炭黑、绯红、银白 | 延续动漫人物主题、强调视觉个性 |

建议优先考虑月下竹影，补充当前主题中较少的浅绿色方向。

## 完整生成提示词

### 月下竹影

```text
Use case: ui-mockup. Create realistic, production-quality UI designs with clear hierarchy, strong typography, intentional imagery, and purposeful spacing.
Product: Quota Float, a compact desktop widget for glancing at remaining Codex quota. This is one proposed visual theme, presented as ONE coherent matched sample suite, NOT several theme ideas. Target canvas 1536 x 1024 landscape. Current date 2026-10-16 in Asia/Shanghai. All displayed numbers are mock remaining values, not used values.
Input references: images 1 and 2 are actual current expanded card and quota radar with the pink Yone theme; image 3 is actual orb; image 4 is another existing black-gold character skin. Use as shape/layout/component reference. Completely replace their artwork and palette with the new named theme, not copy their characters or pink/gold colors.
Layout: professional editorial design presentation on a quiet theme-colored studio background. Top-left title and one short subtitle. Two equal large SQUARE rounded widgets side by side: left expanded quota card; right quota radar card. Separate matching circular orb below between them or lower right. A small restrained palette strip near bottom. Keep widget square aspect ratio and same logical 306 x 306 shape with 38 radius as source (enlarge proportionally for presentation, about 550 x 550 physical pixels each). Orb same underlying 72 x 72 shape, shown at about 144 x 144 pixels. Ample breathing room. Neither screen is a web page or mobile app. No browser chrome, device frames, long dashboard, extra features, or fake navigation. Only one theme in the image.
Expanded card information hierarchy and positions must closely follow reference: small top-left "CODEX · PRO"; top-right four small circular controls (status dot, chart, expand, pin). Under header "5 小时剩余". Main very large number "74%" in left half. One fine progress line filled to 74 percent. Under it "1 小时 17 分钟后重置". Lower section "本周剩余", number "42%", fine footer "1 次重置机会  查看", small provider terminal mark lower right. Darken or lighten artwork behind text as necessary to keep readable. No text behind figure face.
Radar uses same exact square outer shape and skin at much reduced background contrast: same top header, heading "配额雷达", remaining 74%, progress line, time selector "24 小时   7 天   30 天", and ONE neat quota trend chart declining from 95% to 74%, ending in a dot. Axis simple "00:00", "12:00", "24:00". Label "约消耗 4.2% / 小时". No extra invented metrics/cards. Preserve grouped sections, subtle dividers, no unnecessary nested containers.
Orb: match theme artwork crop; large centered 74% with circular arc around edge filled to 74 percent. The number remains unmistakably legible at compact size.
Typography: clean Segoe UI / modern sans, accurate simplified Chinese, crisp readable text, no more than two fonts. Source UI logical small type 10-14px scaled cleanly in presentation, hero number strong. No distortion, clipped text or clutter. Presentation heading includes exact named theme and "QUOTA FLOAT" plus short palette names or hexes. Small footer "概念预览 · 模拟数据". This is a polished full theme sample set, not finished software. Soft material details, excellent restrained composition. Byline if any must be "@author MoShangHuaKai".
THEME: "月下竹影" / "JADE MOON".
Art direction: serene premium Chinese landscape atmosphere with a jade-white luminous mist background. Delicate painterly bamboo leaves, a pale moon, tiny far-off mountains, and soft reflections; no character. Palette porcelain #F0F4E9, pale celadon #CBDDD0, pine ink #244C43, muted jade #67A790. Main card uses ink-green numbers on pale porcelain with bamboo concentrated on right edge, most negative space on left. Rounded panel looks like frosted pale jade glass with a very fine light rim, no heavy glow. Orb shows moon and one bamboo silhouette behind dark ink percentage, jade ring. Radar is almost-white translucent mist with restrained pine curve. The set feels peaceful, refined, and actually usable daily. Title exact "月下竹影"; subtitle "玉白 · 松绿 · 薄雾". Quiet warm-white presentation board with tiny bamboo shadow in far corner, elegant typography and generous spacing.
```

### 深海星航

```text
undefined
```

### 赤月剑影

```text
undefined
```

