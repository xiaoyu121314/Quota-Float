/**
 * @author MoShangHuaKai
 *
 * Builds daily Token activity from Codex's local usage records. Only the
 * dedicated token-usage record type, its timestamp, and cumulative totals are
 * parsed; conversation text and tool output are neither retained nor sent.
 */
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{self, BufRead, BufReader},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration as StdDuration, SystemTime},
};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::Value;

use crate::models::{TokenActivity, TokenActivityBucket};

const ACTIVITY_DAYS: i64 = 365;
const MAX_DAILY_TOKEN_COUNT: u64 = 9_000_000_000;
const TOKEN_USAGE_RECORD_TYPE: &str = "token_usage_record";

static SESSION_ACTIVITY_CACHE: OnceLock<Mutex<SessionActivityCache>> = OnceLock::new();

#[derive(Default)]
struct SessionActivityCache {
    root: Option<PathBuf>,
    files: HashMap<PathBuf, CachedSessionFile>,
}

struct CachedSessionFile {
    signature: FileSignature,
    daily: BTreeMap<NaiveDate, u64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileSignature {
    length: u64,
    modified: Option<SystemTime>,
}

struct SessionFile {
    path: PathBuf,
    signature: FileSignature,
}

/// Returns the most recent year of locally recorded Codex token usage.
///
/// Session files are indexed by size and modification time. An unchanged file
/// reuses its in-memory daily totals, while a newly written or appended file is
/// parsed again so a normal quota refresh also updates the activity chart.
pub(crate) fn read_local_activity() -> Option<TokenActivity> {
    let root = codex_home()?.join("sessions");
    if !root.is_dir() {
        return None;
    }

    let now = Utc::now();
    let first_day = now.date_naive() - Duration::days(ACTIVITY_DAYS - 1);
    let oldest_file_time = SystemTime::now()
        .checked_sub(StdDuration::from_secs((ACTIVITY_DAYS as u64 + 2) * 24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let cache = SESSION_ACTIVITY_CACHE.get_or_init(|| Mutex::new(SessionActivityCache::default()));
    let mut cache = cache.lock().ok()?;

    // CODEX_HOME can be changed while the app is running. Keep records from
    // separate Codex homes isolated instead of mixing their activity.
    if cache.root.as_deref() != Some(root.as_path()) {
        *cache = SessionActivityCache {
            root: Some(root.clone()),
            files: HashMap::new(),
        };
    }

    let mut files = Vec::new();
    collect_session_files(&root, oldest_file_time, &mut files).ok()?;
    let current_paths: HashSet<PathBuf> = files.iter().map(|file| file.path.clone()).collect();

    for file in files {
        let needs_refresh = cache
            .files
            .get(&file.path)
            .map(|cached| cached.signature != file.signature)
            .unwrap_or(true);
        if !needs_refresh {
            continue;
        }

        // Keep the previous successful result if a file is temporarily locked
        // or incomplete while Codex is appending a new usage record.
        if let Ok(daily) = parse_session_file(&file.path, first_day, now.date_naive()) {
            cache.files.insert(
                file.path,
                CachedSessionFile {
                    signature: file.signature,
                    daily,
                },
            );
        }
    }

    cache.files.retain(|path, _| current_paths.contains(path));
    cache.aggregate(first_day)
}

fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
}

fn collect_session_files(
    directory: &Path,
    oldest_file_time: SystemTime,
    files: &mut Vec<SessionFile>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            // A partially unavailable dated folder should not prevent usable
            // records in neighboring session folders from being collected.
            let _ = collect_session_files(&path, oldest_file_time, files);
            continue;
        }
        if !file_type.is_file()
            || path.extension().and_then(|extension| extension.to_str()) != Some("jsonl")
            || !path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("rollout-"))
                .unwrap_or(false)
        {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata.modified().ok();
        if modified.map(|time| time < oldest_file_time).unwrap_or(false) {
            continue;
        }
        files.push(SessionFile {
            path,
            signature: FileSignature {
                length: metadata.len(),
                modified,
            },
        });
    }
    Ok(())
}

fn parse_session_file(
    path: &Path,
    first_day: NaiveDate,
    last_day: NaiveDate,
) -> io::Result<BTreeMap<NaiveDate, u64>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut previous_total = 0_u64;
    let mut daily = BTreeMap::new();

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        // Codex places the top-level record type in the JSON header. Searching
        // only that header avoids deserializing lines that contain prompts or
        // tool output, even if their text mentions this record type.
        let header = &line.as_bytes()[..line.len().min(256)];
        let compact_marker: &[u8] = b"\"type\":\"token_usage_record\"";
        let spaced_marker: &[u8] = b"\"type\": \"token_usage_record\"";
        let has_usage_type = [compact_marker, spaced_marker].iter().any(|marker| {
            header
                .windows(marker.len())
                .any(|window| window == *marker)
        });
        if !has_usage_type {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if record.get("type").and_then(Value::as_str) != Some(TOKEN_USAGE_RECORD_TYPE) {
            continue;
        }

        let Some(payload) = record.get("payload") else {
            continue;
        };
        let usage = payload
            .get("thread_token_usage")
            .or_else(|| payload.get("turn_token_usage"))
            .or_else(|| payload.get("usage"));
        let Some(total) = usage.and_then(|value| integer(value, &["total_tokens", "totalTokens"]))
        else {
            continue;
        };

        // The record stores a cumulative thread total, not a per-request
        // amount. Subtracting the preceding value counts each request once;
        // if a log starts a fresh counter, its new total becomes that delta.
        let increment = total.checked_sub(previous_total).unwrap_or(total);
        previous_total = total;
        if increment == 0 {
            continue;
        }

        let Some(day) = record
            .get("timestamp")
            .and_then(parse_timestamp)
            .map(|timestamp| timestamp.date_naive())
        else {
            continue;
        };
        if day < first_day || day > last_day {
            continue;
        }

        let total_for_day = daily.entry(day).or_insert(0_u64);
        *total_for_day = total_for_day
            .saturating_add(increment)
            .min(MAX_DAILY_TOKEN_COUNT);
    }

    Ok(daily)
}

fn parse_timestamp(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(text) = value.as_str() {
        return DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|timestamp| timestamp.with_timezone(&Utc));
    }
    value
        .as_i64()
        .and_then(|seconds| DateTime::<Utc>::from_timestamp(seconds, 0))
}

fn integer(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        value
            .as_u64()
            .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
    })
}

impl SessionActivityCache {
    fn aggregate(&self, first_day: NaiveDate) -> Option<TokenActivity> {
        let mut daily = BTreeMap::<NaiveDate, u64>::new();
        for cached_file in self.files.values() {
            for (day, count) in &cached_file.daily {
                if *day < first_day {
                    continue;
                }
                let total_for_day = daily.entry(*day).or_insert(0_u64);
                *total_for_day = total_for_day
                    .saturating_add(*count)
                    .min(MAX_DAILY_TOKEN_COUNT);
            }
        }
        if daily.is_empty() {
            return None;
        }

        let mut total_tokens = 0_u64;
        let daily = daily
            .into_iter()
            .map(|(day, token_count)| {
                total_tokens = total_tokens.saturating_add(token_count);
                TokenActivityBucket {
                    start_at: format!("{}T00:00:00Z", day.format("%Y-%m-%d")),
                    token_count,
                }
            })
            .collect();
        Some(TokenActivity {
            daily,
            total_tokens: Some(total_tokens),
        })
    }
}
