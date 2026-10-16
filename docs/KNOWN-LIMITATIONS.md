# 已知限制

- Codex 数据来自非公开只读接口，字段或认证方式可能变化。
- 当前发布包未签名、未公证；Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。
- macOS Universal 包由 GitHub Actions 的 `macos-latest` runner 构建，不能在 Windows 本机直接生成。
- Claude provider 在 v1 中未启用。
- 重置机会只读取数量和到期时间，不能在应用内兑换。
- 真实额度准确性依赖 Codex 后端返回的窗口数据；应用不会根据本地 token 消耗自行估算额度。
- 配额雷达只根据多个本地百分比快照做保守趋势估算；样本不足、额度回升或服务状态异常时不会显示耗尽预测。
- Token 活动从本机 Codex 会话文件中的专用用量记录聚合，最多展示最近 365 天；不会解析对话正文来估算，也不代表账单或额度消耗。
- CSS 毛玻璃效果在 Windows WebView2 中对桌面背景的支持有限；当前设计优先保证透明圆角悬浮球的一致外观。
- 自定义背景图片当前仅支持 PNG、JPEG、WebP，单张不超过 4 MB，并按居中 `cover` 方式裁剪。
- 公开分发前建议补齐 Windows 代码签名、macOS Developer ID 签名和 notarization。
- 随 Codex 启动：Quota Float 崩溃（非正常退出）时不会自动复活，需等 Codex 下次启动；Codex 退出后悬浮窗约 2 秒内随进程退出（双确认轮询延迟）。
