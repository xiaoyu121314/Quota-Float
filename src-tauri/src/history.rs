/**
 * @author MoShangHuaKai
 *
 * Local-only storage for the quota radar. The store deliberately accepts
 * ProviderSnapshot only long enough to extract percentages; no sensitive
 * authentication or raw response fields cross the persistence boundary.
 */
use std::{fs, io::Write, path::PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::models::ProviderSnapshot;

const RETENTION: Duration = Duration::days(30);
const MIN_SAMPLE_INTERVAL: Duration = Duration::seconds(60);
const MAX_HISTORY_POINTS: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaHistoryPoint {
    pub provider: String,
    pub captured_at: String,
    pub status: String,
    pub short_remaining_percent: Option<f64>,
    pub weekly_remaining_percent: Option<f64>,
}

pub struct QuotaHistoryStore {
    path: PathBuf,
    points: Vec<QuotaHistoryPoint>,
}

impl QuotaHistoryStore {
    pub fn load(path: PathBuf) -> Self {
        let points = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<QuotaHistoryPoint>>(&raw).ok())
            .unwrap_or_default();
        let mut store = Self { path, points };
        store.prune(Utc::now());
        store
    }

    pub fn points(&mut self) -> Vec<QuotaHistoryPoint> {
        self.prune(Utc::now());
        self.points.clone()
    }

    pub fn record(
        &mut self,
        snapshots: &[ProviderSnapshot],
        now: DateTime<Utc>,
    ) -> Result<(), String> {
        let mut changed = self.prune(now);
        for snapshot in snapshots {
            let Some(point) = point_from_snapshot(snapshot) else {
                continue;
            };
            let Some(timestamp) = parse_timestamp(&point.captured_at) else {
                continue;
            };
            if timestamp > now + Duration::minutes(5) {
                continue;
            }

            if let Some(index) = self
                .points
                .iter()
                .rposition(|known| known.provider == point.provider)
            {
                let Some(previous_timestamp) = parse_timestamp(&self.points[index].captured_at)
                else {
                    self.points[index] = point;
                    changed = true;
                    continue;
                };
                if timestamp < previous_timestamp {
                    continue;
                }
                if timestamp - previous_timestamp < MIN_SAMPLE_INTERVAL {
                    self.points[index] = point;
                    changed = true;
                    continue;
                }
            }
            self.points.push(point);
            changed = true;
        }

        self.sort_points();
        changed |= self.prune(now);
        if changed {
            self.persist()?;
        }
        Ok(())
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.points.clear();
        self.persist()
    }

    fn prune(&mut self, now: DateTime<Utc>) -> bool {
        let before = self.points.len();
        let cutoff = now - RETENTION;
        self.points.retain(|point| {
            let Some(timestamp) = parse_timestamp(&point.captured_at) else {
                return false;
            };
            timestamp >= cutoff
                && timestamp <= now + Duration::minutes(5)
                && (!point.provider.trim().is_empty())
                && point.status == "ok"
                && (point.short_remaining_percent.is_some()
                    || point.weekly_remaining_percent.is_some())
        });
        self.sort_points();
        if self.points.len() > MAX_HISTORY_POINTS {
            let remove_count = self.points.len() - MAX_HISTORY_POINTS;
            self.points.drain(0..remove_count);
        }
        before != self.points.len()
    }

    fn sort_points(&mut self) {
        self.points.sort_by_key(|point| {
            parse_timestamp(&point.captured_at)
                .map(|timestamp| timestamp.timestamp_millis())
                .unwrap_or(i64::MIN)
        });
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "failed to create quota history directory".to_string())?;
        }
        let serialized = serde_json::to_vec_pretty(&self.points)
            .map_err(|_| "failed to serialize quota history".to_string())?;
        let temporary = self.path.with_extension("json.tmp");
        let backup = self.path.with_extension("json.bak");
        let mut file = fs::File::create(&temporary)
            .map_err(|_| "failed to create quota history temporary file".to_string())?;
        file.write_all(&serialized)
            .and_then(|_| file.sync_all())
            .map_err(|_| "failed to write quota history".to_string())?;
        if self.path.exists() {
            let _ = fs::remove_file(&backup);
            fs::rename(&self.path, &backup)
                .map_err(|_| "failed to back up quota history".to_string())?;
        }
        if let Err(error) = fs::rename(&temporary, &self.path) {
            let _ = fs::rename(&backup, &self.path);
            return Err(format!("failed to commit quota history: {error}"));
        }
        Ok(())
    }
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

fn normalize_percent(value: f64) -> Option<f64> {
    value.is_finite().then(|| value.clamp(0.0, 100.0))
}

fn point_from_snapshot(snapshot: &ProviderSnapshot) -> Option<QuotaHistoryPoint> {
    if snapshot.status != "ok" {
        return None;
    }
    let short_remaining_percent = snapshot
        .short_window
        .as_ref()
        .and_then(|window| normalize_percent(window.remaining_percent));
    let weekly_remaining_percent = snapshot
        .weekly_window
        .as_ref()
        .and_then(|window| normalize_percent(window.remaining_percent));
    if short_remaining_percent.is_none() && weekly_remaining_percent.is_none() {
        return None;
    }
    Some(QuotaHistoryPoint {
        provider: snapshot.provider.clone(),
        captured_at: parse_timestamp(&snapshot.updated_at)?.to_rfc3339(),
        status: "ok".into(),
        short_remaining_percent,
        weekly_remaining_percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ProviderSnapshot, UsageWindow};

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "quota-float-history-{}-{}.json",
            std::process::id(),
            Utc::now().timestamp_micros()
        ))
    }

    fn snapshot(
        time: DateTime<Utc>,
        short: Option<f64>,
        weekly: Option<f64>,
        status: &str,
    ) -> ProviderSnapshot {
        ProviderSnapshot {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: Some("PRO".into()),
            short_window: short.map(|remaining_percent| UsageWindow {
                remaining_percent,
                resets_at: None,
                window_seconds: 18_000,
            }),
            weekly_window: weekly.map(|remaining_percent| UsageWindow {
                remaining_percent,
                resets_at: None,
                window_seconds: 604_800,
            }),
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            token_activity: None,
            updated_at: time.to_rfc3339(),
            status: status.into(),
            message: None,
        }
    }

    fn cleanup(path: &std::path::Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("json.bak"));
        let _ = fs::remove_file(path.with_extension("json.tmp"));
    }

    #[test]
    fn records_only_success_and_replaces_points_within_one_minute() {
        let path = test_path();
        let start = Utc::now() - Duration::hours(1);
        let mut store = QuotaHistoryStore::load(path.clone());
        store
            .record(&[snapshot(start, Some(80.0), Some(60.0), "ok")], start)
            .unwrap();
        store
            .record(
                &[snapshot(
                    start + Duration::seconds(30),
                    Some(78.0),
                    Some(59.0),
                    "ok",
                )],
                start + Duration::seconds(30),
            )
            .unwrap();
        store
            .record(
                &[snapshot(
                    start + Duration::seconds(45),
                    None,
                    None,
                    "unavailable",
                )],
                start + Duration::seconds(45),
            )
            .unwrap();
        assert_eq!(store.points().len(), 1);
        assert_eq!(store.points()[0].short_remaining_percent, Some(78.0));
        cleanup(&path);
    }

    #[test]
    fn prunes_expired_points_and_keeps_recent_points() {
        let path = test_path();
        let now = Utc::now();
        let mut store = QuotaHistoryStore {
            path: path.clone(),
            points: vec![
                QuotaHistoryPoint {
                    provider: "codex".into(),
                    captured_at: (now - Duration::days(31)).to_rfc3339(),
                    status: "ok".into(),
                    short_remaining_percent: Some(80.0),
                    weekly_remaining_percent: Some(60.0),
                },
                QuotaHistoryPoint {
                    provider: "codex".into(),
                    captured_at: (now - Duration::days(1)).to_rfc3339(),
                    status: "ok".into(),
                    short_remaining_percent: Some(70.0),
                    weekly_remaining_percent: Some(55.0),
                },
            ],
        };
        assert!(store.prune(now));
        assert_eq!(store.points.len(), 1);
        assert_eq!(store.points[0].short_remaining_percent, Some(70.0));
        cleanup(&path);
    }

    #[test]
    fn round_trips_only_the_privacy_filtered_history_shape() {
        let path = test_path();
        let now = Utc::now() - Duration::hours(1);
        let mut store = QuotaHistoryStore::load(path.clone());
        store
            .record(&[snapshot(now, Some(73.0), Some(42.0), "ok")], now)
            .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("capturedAt"));
        assert!(raw.contains("shortRemainingPercent"));
        assert!(!raw.contains("PRO"));
        assert!(!raw.contains("message"));
        let loaded = QuotaHistoryStore::load(path.clone());
        assert_eq!(loaded.points.len(), 1);
        cleanup(&path);
    }
}
