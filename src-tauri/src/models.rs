use base64::Engine;
use serde::{Deserialize, Serialize};

/// Keep persisted image data bounded so a malformed local preference cannot
/// turn every startup or IPC update into an unbounded allocation.
pub(crate) const MAX_CUSTOM_BACKGROUND_IMAGE_LENGTH: usize = 8 * 1024 * 1024;

/// Only raster data URLs are accepted. SVG is intentionally excluded because
/// an image selected for a CSS background should not carry executable markup.
pub(crate) fn is_valid_custom_background_image(value: &str) -> bool {
    if value.len() > MAX_CUSTOM_BACKGROUND_IMAGE_LENGTH {
        return false;
    }
    let payload = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .find_map(|prefix| value.strip_prefix(prefix));
    payload
        .filter(|value| !value.is_empty())
        .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
        .is_some()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenActivityBucket {
    pub start_at: String,
    pub token_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenActivity {
    pub daily: Vec<TokenActivityBucket>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub short_window: Option<UsageWindow>,
    pub weekly_window: Option<UsageWindow>,
    pub reset_credits: Option<u64>,
    pub reset_credit_expires_at: Vec<String>,
    pub token_activity: Option<TokenActivity>,
    pub updated_at: String,
    pub status: String,
    pub message: Option<String>,
}

impl ProviderSnapshot {
    pub fn failure(status: &str, message: &str) -> Self {
        Self {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            short_window: None,
            weekly_window: None,
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            token_activity: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
            status: status.into(),
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPreferences {
    pub locked: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default)]
    pub stay_expanded: bool,
    pub auto_rotate_seconds: u64,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_appearance")]
    pub appearance: String,
    #[serde(default = "default_opacity")]
    pub opacity: u8,
    #[serde(default)]
    pub liquid_glass_enabled: bool,
    #[serde(default)]
    pub custom_background_image: Option<String>,
}

fn default_always_on_top() -> bool {
    true
}
fn default_language() -> String {
    "zh-CN".into()
}
fn default_appearance() -> String {
    "light".into()
}
fn default_opacity() -> u8 {
    100
}

impl Default for WidgetPreferences {
    fn default() -> Self {
        Self {
            locked: false,
            always_on_top: true,
            stay_expanded: false,
            auto_rotate_seconds: 12,
            language: default_language(),
            appearance: default_appearance(),
            opacity: default_opacity(),
            liquid_glass_enabled: false,
            custom_background_image: None,
        }
    }
}

impl WidgetPreferences {
    pub fn normalized(mut self) -> Self {
        self.auto_rotate_seconds = self.auto_rotate_seconds.clamp(5, 300);
        if self.language != "en" && self.language != "zh-CN" {
            self.language = default_language();
        }
        // 新主题必须通过原生设置校验，否则保存或重启时会被回退成浅色主题。
        if self.appearance != "system" && self.appearance != "light" && self.appearance != "dark" && self.appearance != "sakura" && self.appearance != "warm" && self.appearance != "city" && self.appearance != "home" && self.appearance != "naruto" && self.appearance != "yone" && self.appearance != "glacier" && self.appearance != "yunlin" {
            self.appearance = default_appearance();
        }
        self.opacity = self.opacity.clamp(0, 100);
        if self
            .custom_background_image
            .as_deref()
            .map(|value| !is_valid_custom_background_image(value))
            .unwrap_or(false)
        {
            // Invalid persisted image data is discarded during normalization;
            // the rest of the user's preferences remains usable.
            self.custom_background_image = None;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_custom_background_image, WidgetPreferences, MAX_CUSTOM_BACKGROUND_IMAGE_LENGTH,
    };

    #[test]
    fn normalization_preserves_naruto_after_serde_round_trip() {
        let preferences = WidgetPreferences {
            appearance: "naruto".into(),
            ..WidgetPreferences::default()
        };
        let serialized = serde_json::to_string(&preferences).unwrap();
        let deserialized: WidgetPreferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.appearance, "naruto");
        assert_eq!(deserialized.normalized().appearance, "naruto");
    }

    #[test]
    fn normalization_preserves_yone_after_serde_round_trip() {
        let preferences = WidgetPreferences {
            appearance: "yone".into(),
            ..WidgetPreferences::default()
        };
        let serialized = serde_json::to_string(&preferences).unwrap();
        let deserialized: WidgetPreferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.appearance, "yone");
        assert_eq!(deserialized.normalized().appearance, "yone");
    }

    #[test]
    fn normalization_preserves_glacier_after_serde_round_trip() {
        let preferences = WidgetPreferences {
            appearance: "glacier".into(),
            ..WidgetPreferences::default()
        };
        let serialized = serde_json::to_string(&preferences).unwrap();
        let deserialized: WidgetPreferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.normalized().appearance, "glacier");
    }

    #[test]
    fn normalization_preserves_yunlin_after_serde_round_trip() {
        let preferences = WidgetPreferences {
            appearance: "yunlin".into(),
            ..WidgetPreferences::default()
        };
        let serialized = serde_json::to_string(&preferences).unwrap();
        let deserialized: WidgetPreferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.normalized().appearance, "yunlin");
    }

    #[test]
    fn normalization_falls_back_for_unknown_appearance() {
        let preferences = WidgetPreferences {
            appearance: "unknown-theme".into(),
            ..WidgetPreferences::default()
        };
        assert_eq!(preferences.normalized().appearance, "light");
    }

    #[test]
    fn accepts_supported_raster_data_urls() {
        for prefix in [
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
        ] {
            assert!(is_valid_custom_background_image(&format!(
                "{prefix}aGVsbG8="
            )));
        }
    }

    #[test]
    fn rejects_svg_invalid_base64_and_oversized_values() {
        assert!(!is_valid_custom_background_image(
            "data:image/svg+xml;base64,PHN2Zz4="
        ));
        assert!(!is_valid_custom_background_image(
            "data:image/png;base64,not-base64!"
        ));
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_CUSTOM_BACKGROUND_IMAGE_LENGTH)
        );
        assert!(!is_valid_custom_background_image(&oversized));
    }

    #[test]
    fn normalization_discards_invalid_image_without_discarding_other_preferences() {
        let preferences = WidgetPreferences {
            language: "en".into(),
            custom_background_image: Some("data:image/png;base64,not-base64!".into()),
            ..WidgetPreferences::default()
        }
        .normalized();
        assert_eq!(preferences.language, "en");
        assert_eq!(preferences.custom_background_image, None);
    }
}
