//! Retention planning (pure: no IO, no clock, no index access). `gc.rs` builds the plain view of a
//! lineage from the index, asks for a plan and executes it.
//!
//! Algorithms: borg/restic "newest per bucket" thinning with Time Machine tiers (all / hourly /
//! daily / weekly), reference closure for deltas, and an oldest-first cap planner. One pass per
//! lineage (versions arrive in ULID order), so O(n) per lineage and O(n log n) for the
//! vault-wide cap plan. Rules: PLAN-H3 section 4.1 to 4.3.
//!
//! Tier semantics (all ages are measured back from `now`):
//! - age <= keep_all: everything stays;
//! - up to keep_hourly: newest version per local hour;
//! - up to keep_daily: newest version per local day;
//! - beyond, for `keep_weekly_weeks` weeks past the daily window (0 = forever): newest per local week.
//!
//! Windows never shrink below the tier before them. A bucket that straddles two tiers can keep
//! one version per tier (the conservative side).
use super::{names::Reason, HistorySettings};
use std::collections::HashSet;

pub const HOUR_MS: u64 = 3_600_000;
pub const DAY_MS: u64 = 24 * HOUR_MS;
pub const WEEK_MS: u64 = 7 * DAY_MS;
/// A device unseen this long may have its files taken over (M8).
pub const UNSEEN_MS: u64 = 30 * DAY_MS;
/// A device unseen this long is considered dead.
pub const DEAD_MS: u64 = 180 * DAY_MS;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind<'a> {
    Keyframe,
    /// Delta against the keyframe with this id.
    Delta(&'a str),
    /// Path record.
    Path,
}

/// One version file as retention sees it. View slices are sorted by `id` (= by time).
#[derive(Clone, Copy, Debug)]
pub struct V<'a> {
    pub id: &'a str,
    pub dev: &'a str,
    /// Milliseconds from the ULID.
    pub t: u64,
    pub kind: Kind<'a>,
    pub reason: Reason,
    pub size: u64,
    /// Header path, when the header is loaded.
    pub path: Option<&'a str>,
}

impl V<'_> {
    fn is_version(&self) -> bool {
        !matches!(self.kind, Kind::Path)
    }
    /// Checkpoints and codes this app doesn't know are never deleted automatically.
    pub fn pinned_reason(&self) -> bool {
        matches!(self.reason, Reason::Checkpoint | Reason::Unknown(_))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub keep_all_ms: u64,
    pub hourly_end_ms: u64,
    pub daily_end_ms: u64,
    /// `None` = weekly forever.
    pub weekly_end_ms: Option<u64>,
    /// 0 = no cap.
    pub cap_bytes: u64,
}

impl Policy {
    pub fn from_settings(s: &HistorySettings) -> Policy {
        let all = u64::from(s.keep_all_hours) * HOUR_MS;
        let hourly = all.max(u64::from(s.keep_hourly_hours) * HOUR_MS);
        let daily = hourly.max(u64::from(s.keep_daily_days) * DAY_MS);
        let weekly_end_ms = (s.keep_weekly_weeks != 0).then(|| daily + u64::from(s.keep_weekly_weeks) * WEEK_MS);
        Policy { keep_all_ms: all, hourly_end_ms: hourly, daily_end_ms: daily, weekly_end_ms, cap_bytes: u64::from(s.size_cap_mb) * 1024 * 1024 }
    }
}

/// Everything `plan` needs besides the view: time, identity, local time zone and liveness of the
/// other devices (all injected, so tests control them).
pub struct Env<'a> {
    pub now: u64,
    /// This device's id.
    pub me: &'a str,
    /// UTC offset in seconds at the given UTC millisecond (DST aware).
    pub offset_secs: &'a dyn Fn(u64) -> i32,
    /// Local time this Mac last observed a new file of the device (`None` = never seen: treated as seen now).
    pub last_seen: &'a dyn Fn(&str) -> Option<u64>,
    /// Newest ULID time of any file of the device this Mac has seen (vault-wide). Called only for
    /// takeover candidates.
    pub newest_of: &'a dyn Fn(&str) -> u64,
}

impl Env<'_> {
    fn unseen_ms(&self, dev: &str) -> u64 {
        (self.last_seen)(dev).map_or(0, |t| self.now.saturating_sub(t))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Delete {
    /// Index into the view.
    pub idx: usize,
    pub keyframe: bool,
}

const KEEP: u8 = 1;
const DEL: u8 = 2;

/// Caches the UTC offset for a whole UTC day when it is the same at both ends of it (nearly
/// always), so a 500-version plan calls `localtime_r` about twice per day of history, not twice
/// per hour. DST stays exact: a day holding a transition falls back to one call per version (no
/// real zone changes its offset twice within 24 hours).
struct OffsetMemo<'a> {
    f: &'a dyn Fn(u64) -> i32,
    span: u64,
    val: Option<i32>,
}

impl OffsetMemo<'_> {
    fn at(&mut self, t: u64) -> i32 {
        let span = t / DAY_MS;
        if span == self.span {
            if let Some(v) = self.val {
                return v;
            }
        }
        let start = (self.f)(span * DAY_MS);
        let end = (self.f)(span * DAY_MS + DAY_MS - 1);
        self.span = span;
        if start == end {
            self.val = Some(start);
            start
        } else {
            self.val = None;
            (self.f)(t)
        }
    }
}

/// What may go from one lineage. `thin = None` keeps only the pinned set (orphan sweep: automatic
/// versions go, checkpoints and unknown codes stay); `pin_newest` protects the lineage's newest
/// version (always on, except for orphans that have no live path).
pub fn plan_with(view: &[V], thin: Option<&Policy>, pin_newest: bool, env: &Env) -> Vec<Delete> {
    let n = view.len();
    if n == 0 {
        return Vec::new();
    }
    let mut flags = vec![0u8; n];
    // 1. keep set
    if pin_newest {
        if let Some(i) = view.iter().rposition(V::is_version) {
            flags[i] |= KEEP;
        }
    }
    for (i, v) in view.iter().enumerate() {
        if v.pinned_reason() && v.is_version() {
            flags[i] |= KEEP;
        }
    }
    if let Some(p) = thin {
        let mut memo = OffsetMemo { f: env.offset_secs, span: u64::MAX, val: None };
        let mut last = [i64::MIN; 3];
        for i in (0..n).rev() {
            let v = &view[i];
            if !v.is_version() {
                continue;
            }
            // A future ULID (clock skew) counts as "now".
            let age = env.now.saturating_sub(v.t);
            let tier = if age <= p.keep_all_ms {
                flags[i] |= KEEP;
                continue;
            } else if age <= p.hourly_end_ms {
                0
            } else if age <= p.daily_end_ms {
                1
            } else if p.weekly_end_ms.is_none_or(|e| age <= e) {
                2
            } else {
                continue;
            };
            let local = v.t as i64 + i64::from(memo.at(v.t)) * 1000;
            let b = match tier {
                0 => local.div_euclid(HOUR_MS as i64),
                1 => local.div_euclid(DAY_MS as i64),
                // Weeks start on Monday; day 4 since the epoch (1970-01-05) is a Monday.
                _ => (local.div_euclid(DAY_MS as i64) + 3).div_euclid(7),
            };
            if b != last[tier] {
                last[tier] = b;
                flags[i] |= KEEP;
            }
        }
    }
    // 2. every keyframe a kept delta needs
    for i in (0..n).rev() {
        if flags[i] & KEEP != 0 {
            if let Kind::Delta(k) = view[i].kind {
                if let Ok(j) = view[..i].binary_search_by(|v| v.id.cmp(k)) {
                    flags[j] |= KEEP;
                }
            }
        }
    }
    // 3. what may go: any device's deltas (leaves), then keyframes by ownership
    for i in 0..n {
        if flags[i] & KEEP != 0 {
            continue;
        }
        match view[i].kind {
            Kind::Delta(_) => flags[i] |= DEL,
            Kind::Keyframe => {
                if view[i].dev == env.me || takeover_keyframe(&view[i], env) {
                    flags[i] |= DEL;
                }
            }
            Kind::Path => {}
        }
    }
    // 4. path records: only when a retained newer entry already carries a path
    let mut covered = false;
    for i in (0..n).rev() {
        if matches!(view[i].kind, Kind::Path) && covered {
            flags[i] |= DEL;
            continue;
        }
        if flags[i] & DEL == 0 && view[i].path.is_some() {
            covered = true;
        }
    }
    // 5. leaves first, then keyframes
    let mut out = Vec::new();
    for (i, v) in view.iter().enumerate() {
        if flags[i] & DEL != 0 && !matches!(v.kind, Kind::Keyframe) {
            out.push(Delete { idx: i, keyframe: false });
        }
    }
    for (i, v) in view.iter().enumerate() {
        if flags[i] & DEL != 0 && matches!(v.kind, Kind::Keyframe) {
            out.push(Delete { idx: i, keyframe: true });
        }
    }
    out
}

/// Retention of one lineage (PLAN-H3 4.1).
pub fn plan(view: &[V], policy: &Policy, env: &Env) -> Vec<Delete> {
    plan_with(view, Some(policy), true, env)
}

/// Orphan sweep (M7): automatic versions and what only they need go; checkpoints stay.
pub fn plan_orphan(view: &[V], env: &Env) -> Vec<Delete> {
    plan_with(view, None, false, env)
}

/// Foreign keyframe takeover (PLAN-H3 4.3, D-H3-2). The caller has established that the keyframe
/// is not kept; every delta that could reference it is either gone or kept (and then it is kept too).
fn takeover_keyframe(kf: &V, env: &Env) -> bool {
    let unseen = env.unseen_ms(kf.dev);
    if unseen < UNSEEN_MS || env.now.saturating_sub(kf.t) < UNSEEN_MS {
        return false;
    }
    unseen >= DEAD_MS || (env.newest_of)(kf.dev) >= kf.t + WEEK_MS
}

/// One deletion chosen by the cap planner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapDelete {
    /// Index of the lineage in the slice given to `plan_cap`.
    pub lineage: usize,
    pub idx: usize,
    pub keyframe: bool,
}

/// Size cap across lineages (PLAN-H3 4.2): the oldest automatic deltas vault-wide (never a
/// lineage's newest version), then this device's unreferenced, non-newest, non-checkpoint
/// keyframes, oldest first, until `excess` bytes are freed. Deltas come before keyframes.
/// Returns the plan and the bytes it frees.
pub fn plan_cap(lineages: &[&[V]], excess: u64, me: &str) -> (Vec<CapDelete>, u64) {
    let newest: Vec<Option<usize>> = lineages.iter().map(|l| l.iter().rposition(V::is_version)).collect();
    let mut cands: Vec<(u64, usize, usize)> = Vec::new();
    for (l, view) in lineages.iter().enumerate() {
        for (i, v) in view.iter().enumerate() {
            if matches!(v.kind, Kind::Delta(_)) && !v.pinned_reason() && newest[l] != Some(i) {
                cands.push((v.t, l, i));
            }
        }
    }
    cands.sort_unstable();
    let mut out: Vec<CapDelete> = Vec::new();
    let mut freed = 0u64;
    let mut gone: HashSet<(usize, usize)> = HashSet::new();
    for (_, l, i) in cands {
        if freed >= excess {
            break;
        }
        freed += lineages[l][i].size;
        gone.insert((l, i));
        out.push(CapDelete { lineage: l, idx: i, keyframe: false });
    }
    if freed < excess {
        let mut referenced: HashSet<&str> = HashSet::new();
        for (l, view) in lineages.iter().enumerate() {
            for (i, v) in view.iter().enumerate() {
                if let Kind::Delta(k) = v.kind {
                    if !gone.contains(&(l, i)) {
                        referenced.insert(k);
                    }
                }
            }
        }
        let mut kfs: Vec<(u64, usize, usize)> = Vec::new();
        for (l, view) in lineages.iter().enumerate() {
            for (i, v) in view.iter().enumerate() {
                if matches!(v.kind, Kind::Keyframe) && v.dev == me && !v.pinned_reason() && newest[l] != Some(i) && !referenced.contains(v.id) {
                    kfs.push((v.t, l, i));
                }
            }
        }
        kfs.sort_unstable();
        for (_, l, i) in kfs {
            if freed >= excess {
                break;
            }
            freed += lineages[l][i].size;
            out.push(CapDelete { lineage: l, idx: i, keyframe: true });
        }
    }
    (out, freed)
}

// ---------------------------------------------------------------------------------------------
// Local time zone
// ---------------------------------------------------------------------------------------------

#[cfg(unix)]
mod sys {
    use std::ffi::{c_char, c_int, c_long};
    #[repr(C)]
    pub struct Tm {
        pub ints: [c_int; 9],
        pub gmtoff: c_long,
        pub zone: *const c_char,
    }
    extern "C" {
        pub fn localtime_r(t: *const i64, out: *mut Tm) -> *mut Tm;
    }
}

/// Windows: the current offset from `GetTimeZoneInformation` (bias is minutes WEST of UTC; the
/// standard or daylight bias applies on top). Not DST aware for a past or future instant.
#[cfg(windows)]
fn win_offset_secs() -> i32 {
    #[repr(C)]
    struct SystemTime([u16; 8]);
    #[repr(C)]
    struct Tzi {
        bias: i32,
        standard_name: [u16; 32],
        standard_date: SystemTime,
        standard_bias: i32,
        daylight_name: [u16; 32],
        daylight_date: SystemTime,
        daylight_bias: i32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTimeZoneInformation(tzi: *mut Tzi) -> u32;
    }
    // SAFETY: all-zero is a valid `Tzi`; the call writes only into it.
    let mut tzi: Tzi = unsafe { std::mem::zeroed() };
    let kind = unsafe { GetTimeZoneInformation(&mut tzi) };
    let extra = match kind {
        1 => tzi.standard_bias,
        2 => tzi.daylight_bias,
        _ => 0,
    };
    -(tzi.bias + extra) * 60
}

/// The machine's UTC offset in seconds at `utc_ms` (DST aware; 0 when unknown). Declared by hand
/// like the other platform calls (no libc crate).
pub fn local_offset_secs(utc_ms: u64) -> i32 {
    #[cfg(unix)]
    {
        let t = (utc_ms / 1000) as i64;
        let mut tm = sys::Tm { ints: [0; 9], gmtoff: 0, zone: std::ptr::null() };
        // SAFETY: `t` and `tm` are valid for the call; `localtime_r` writes only into `tm`.
        let r = unsafe { sys::localtime_r(&t, &mut tm) };
        if r.is_null() {
            return 0;
        }
        tm.gmtoff as i32
    }
    #[cfg(windows)]
    {
        let _ = utc_ms;
        win_offset_secs()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = utc_ms;
        0
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    #[test]
    fn the_windows_utc_offset_is_a_real_zone_offset() {
        let s = super::local_offset_secs(1_700_000_000_000);
        assert!((-12 * 3600..=14 * 3600).contains(&s), "{s}");
        assert_eq!(s % 900, 0, "zone offsets are whole quarter hours: {s}");
    }
}
