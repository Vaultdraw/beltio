//! Retention against clocks and time zones (Q3): tiers across DST and UTC offsets, ULID times in
//! the future, and clock jumps on this Mac (planner tables on injected clocks, plus real files).
use super::{
    support::*,
    sync_h3_tests::{exact, off0, Dev},
};
use crate::history::{
    gc::{self, Sweep},
    names::Reason,
    retention::{self, Env, Kind, Policy, DAY_MS, HOUR_MS, V},
    HistorySettings,
};
use std::{collections::BTreeSet, time::Duration};

const ME: &str = "meeeeeee";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/// UTC milliseconds of a civil date (Howard Hinnant's days_from_civil).
fn utc(y: i64, m: i64, d: i64, h: u64, mi: u64) -> u64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    days as u64 * DAY_MS + h * HOUR_MS + mi * 60_000
}

/// US Eastern time in 2027: EST (-5 h), EDT (-4 h) between 2027-03-14 07:00 and 2027-11-07 06:00 UTC.
fn eastern(t: u64) -> i32 {
    if (utc(2027, 3, 14, 7, 0)..utc(2027, 11, 7, 6, 0)).contains(&t) {
        -4 * 3600
    } else {
        -5 * 3600
    }
}

fn id_of(t: u64) -> String {
    format!("{t:016}0000")
}

/// Own keyframes at `ts` (all deletable when not kept). Returns the ids kept by `plan`.
fn kept(ts: &[u64], now: u64, off: &dyn Fn(u64) -> i32, pol: &Policy) -> BTreeSet<u64> {
    let ids: Vec<String> = ts.iter().map(|t| id_of(*t)).collect();
    let view: Vec<V> = ts.iter().zip(&ids).map(|(t, id)| V { id, dev: ME, t: *t, kind: Kind::Keyframe, reason: Reason::Auto, size: 1, path: None }).collect();
    let ls = |_: &str| None;
    let nw = |_: &str| 0u64;
    let env = Env { now, me: ME, offset_secs: off, last_seen: &ls, newest_of: &nw };
    let gone: BTreeSet<usize> = retention::plan(&view, pol, &env).into_iter().map(|d| d.idx).collect();
    ts.iter().enumerate().filter(|(i, _)| !gone.contains(i)).map(|(_, t)| *t).collect()
}

fn defaults() -> Policy {
    Policy::from_settings(&HistorySettings::default())
}

fn every(from: u64, to: u64, step: u64) -> Vec<u64> {
    (0..).map(|i| from + i * step).take_while(|t| *t < to).collect()
}

// ---------------------------------------------------------------------------------------------
// DST
// ---------------------------------------------------------------------------------------------

#[test]
fn daily_buckets_follow_local_midnight_across_the_spring_forward_day() {
    let ts = every(utc(2027, 3, 10, 0, 0), utc(2027, 3, 20, 0, 0), 30 * 60_000);
    let k = kept(&ts, utc(2027, 3, 19, 12, 0), &eastern, &defaults());
    // Mar 13 (EST) ends at Mar 14 05:00 UTC; Mar 14 is 23 h long and ends at Mar 15 04:00 UTC (EDT)
    assert!(k.contains(&utc(2027, 3, 14, 4, 30)), "newest of local Mar 13");
    assert!(k.contains(&utc(2027, 3, 15, 3, 30)), "newest of local Mar 14 (a fixed -5 h offset would pick 04:30)");
    assert!(!k.contains(&utc(2027, 3, 15, 4, 30)) && !k.contains(&utc(2027, 3, 14, 5, 30)), "everything else of those days is thinned");
    assert!(k.contains(&utc(2027, 3, 16, 3, 30)), "newest of local Mar 15 (EDT)");
}

#[test]
fn daily_buckets_follow_local_midnight_across_the_fall_back_day() {
    let ts = every(utc(2027, 11, 3, 0, 0), utc(2027, 11, 13, 0, 0), 30 * 60_000);
    let k = kept(&ts, utc(2027, 11, 12, 12, 0), &eastern, &defaults());
    // Nov 6 (EDT) ends at Nov 7 04:00 UTC; Nov 7 is 25 h long and ends at Nov 8 05:00 UTC (EST)
    assert!(k.contains(&utc(2027, 11, 7, 3, 30)), "newest of local Nov 6");
    assert!(k.contains(&utc(2027, 11, 8, 4, 30)), "newest of local Nov 7 (a fixed -4 h offset would pick 03:30)");
    assert!(!k.contains(&utc(2027, 11, 8, 3, 30)) && !k.contains(&utc(2027, 11, 7, 4, 30)));
    assert!(k.contains(&utc(2027, 11, 9, 4, 30)), "newest of local Nov 8 (EST)");
}

#[test]
fn hourly_tier_keeps_the_newest_of_each_local_hour_even_when_a_local_hour_repeats() {
    // now = Nov 7 12:00 UTC; local 01:00-02:00 happens twice (05:00 and 06:00 UTC hours)
    let now = utc(2027, 11, 7, 12, 0);
    let ts = every(now - 23 * HOUR_MS, now - 2 * HOUR_MS, 15 * 60_000);
    let k = kept(&ts, now, &eastern, &defaults());
    let repeated: Vec<u64> = k.iter().copied().filter(|t| (utc(2027, 11, 7, 5, 0)..utc(2027, 11, 7, 7, 0)).contains(t)).collect();
    assert_eq!(repeated, vec![utc(2027, 11, 7, 6, 45)], "one version for the repeated local hour: the newest");
    // all other hours: exactly one kept per UTC hour (no repeats elsewhere)
    for h in 0..21u64 {
        let from = now - 23 * HOUR_MS + h * HOUR_MS;
        if (utc(2027, 11, 7, 5, 0)..utc(2027, 11, 7, 7, 0)).contains(&from) {
            continue;
        }
        let n = k.iter().filter(|t| (from..from + HOUR_MS).contains(*t)).count();
        assert_eq!(n, 1, "hour starting {from}");
    }
}

// ---------------------------------------------------------------------------------------------
// UTC offsets
// ---------------------------------------------------------------------------------------------

/// Offsets: -12 h .. +14 h including the half and quarter hour zones.
const OFFSETS: [i32; 9] = [-12 * 3600, -9 * 3600 - 1800, -5 * 3600, 0, 5 * 3600 + 1800, 5 * 3600 + 2700, 8 * 3600, 13 * 3600, 14 * 3600];

fn local_day(t: u64, off: i32) -> i64 {
    (t as i64 + i64::from(off) * 1000).div_euclid(DAY_MS as i64)
}
fn local_week(t: u64, off: i32) -> i64 {
    (local_day(t, off) + 3).div_euclid(7)
}

#[test]
fn every_offset_keeps_exactly_one_version_per_local_day_and_per_local_week() {
    let now = utc(2027, 3, 1, 9, 17);
    let pol = defaults();
    let ts = every(now - 200 * DAY_MS, now, 3 * HOUR_MS + 7 * 60_000);
    for off in OFFSETS {
        let f = move |_: u64| off;
        let k = kept(&ts, now, &f, &pol);
        assert!(k.contains(ts.last().unwrap()), "offset {off}: the newest is kept");
        let age = |t: u64| now - t;
        // daily tier: buckets entirely between the hourly and the daily window
        let daily: Vec<u64> = ts.iter().copied().filter(|t| age(*t) > pol.hourly_end_ms && age(*t) <= pol.daily_end_ms).collect();
        let mut days: std::collections::BTreeMap<i64, Vec<u64>> = Default::default();
        for t in &ts {
            days.entry(local_day(*t, off)).or_default().push(*t);
        }
        let mut checked = 0;
        for members in days.values() {
            if members.iter().all(|t| daily.contains(t)) {
                let kept_here: Vec<u64> = members.iter().copied().filter(|t| k.contains(t)).collect();
                assert_eq!(kept_here, vec![*members.last().unwrap()], "offset {off}: one per local day, the newest");
                checked += 1;
            }
        }
        assert!(checked >= 25, "offset {off}: {checked} days checked");
        // weekly tier (forever): buckets entirely older than the daily window
        let mut weeks: std::collections::BTreeMap<i64, Vec<u64>> = Default::default();
        for t in &ts {
            weeks.entry(local_week(*t, off)).or_default().push(*t);
        }
        let mut wchecked = 0;
        for members in weeks.values() {
            if members.iter().all(|t| age(*t) > pol.daily_end_ms) {
                let kept_here: Vec<u64> = members.iter().copied().filter(|t| k.contains(t)).collect();
                assert_eq!(kept_here, vec![*members.last().unwrap()], "offset {off}: one per local week, the newest");
                wchecked += 1;
            }
        }
        assert!(wchecked >= 12, "offset {off}: {wchecked} weeks checked");
    }
}

#[test]
fn local_monday_midnight_splits_weeks_in_every_offset() {
    // Sunday 23:30 and Monday 00:30 local, 90 days old: different weeks, both kept; Tue and Wed noon: one
    let now = utc(2027, 6, 1, 0, 0);
    let monday_local = utc(2027, 3, 8, 0, 0); // local-midnight of a Monday expressed as if offset 0
    for off in OFFSETS {
        let at = |dh: i64, dm: i64| (monday_local as i64 + dh * HOUR_MS as i64 + dm * 60_000 - i64::from(off) * 1000) as u64;
        let ts = vec![at(-1, -30 + 60), at(0, 30), at(24 + 12, 0), at(48 + 12, 0)];
        let f = move |_: u64| off;
        let k = kept(&ts, now, &f, &defaults());
        assert!(k.contains(&ts[0]), "offset {off}: Sunday 23:30 local is the newest of its week");
        assert!(!k.contains(&ts[2]) && k.contains(&ts[3]), "offset {off}: Tuesday and Wednesday share a week: the newest stays");
        assert!(!k.contains(&ts[1]), "offset {off}: Monday 00:30, Tuesday, Wednesday: one week, newest only");
    }
}

// ---------------------------------------------------------------------------------------------
// ULID times and clock jumps
// ---------------------------------------------------------------------------------------------

const ULID_MAX_MS: u64 = (1 << 48) - 1;

#[test]
fn future_ulids_never_look_old_and_extreme_times_do_not_overflow() {
    let now = utc(2027, 3, 1, 12, 0);
    let pol = defaults();
    // 40 d in the future: a dense run in one hour, all kept (age counts as 0), never thinned
    let ts = every(now + 40 * DAY_MS, now + 40 * DAY_MS + 3 * HOUR_MS, 60_000);
    assert_eq!(kept(&ts, now, &|_| 0, &pol).len(), ts.len(), "future versions are kept in full");
    // the largest ULID time and the epoch itself: no panic, and the sane results
    let ts = vec![0, 1, utc(2027, 3, 1, 0, 0), ULID_MAX_MS - 1, ULID_MAX_MS];
    let k = kept(&ts, now, &retention::local_offset_secs, &pol);
    assert!(k.contains(&ULID_MAX_MS), "the newest is always kept");
    for t in [0u64, 1, ULID_MAX_MS, u64::MAX / 2000] {
        let o = retention::local_offset_secs(t);
        assert!(o.abs() <= 15 * 3600, "offset {o} at {t}");
    }
    // a takeover candidate with an extreme ULID time cannot overflow `t + 7 d`
    let ls = |_: &str| Some(0u64);
    let nw = |_: &str| ULID_MAX_MS;
    let id = id_of(ULID_MAX_MS);
    let other = "b2c3d4e5";
    let view = [V { id: &id, dev: other, t: ULID_MAX_MS, kind: Kind::Keyframe, reason: Reason::Auto, size: 1, path: None }];
    let env = Env { now: u64::MAX / 4, me: ME, offset_secs: &|_| 0, last_seen: &ls, newest_of: &nw };
    let _ = retention::plan(&view, &pol, &env);
}

#[test]
fn clock_jumped_back_before_every_version_deletes_nothing_and_idempotence_holds_at_any_clock() {
    let now = utc(2027, 3, 1, 9, 0);
    let pol = defaults();
    let ts = every(now - 90 * DAY_MS, now, 47 * 60_000);
    let first = kept(&ts, now, &eastern, &pol);
    assert!(first.len() < ts.len() / 4, "something to thin");
    // the clock goes back to 1970, or to before the oldest version: age 0 for everything
    for back in [0u64, ts[0] - 1, ts[0]] {
        assert_eq!(kept(&ts, back, &eastern, &pol).len(), ts.len(), "now={back}: nothing is deleted");
    }
    // idempotent at the same clock; a sweep after the jump back never touches the survivors
    let survivors: Vec<u64> = ts.iter().copied().filter(|t| first.contains(t)).collect();
    assert_eq!(kept(&survivors, now, &eastern, &pol).len(), survivors.len(), "applying a plan twice changes nothing");
    for back_days in [1u64, 2, 10, 40] {
        let k = kept(&survivors, now - back_days * DAY_MS, &eastern, &pol);
        assert!(k.contains(survivors.last().unwrap()), "the newest always stays");
        assert!(survivors.len() - k.len() <= 4, "a jump back of {back_days} d may only re-bucket a tier boundary ({} -> {})", survivors.len(), k.len());
    }
}

#[test]
fn clock_jumped_forward_ten_years_keeps_the_newest_checkpoints_and_the_weekly_window_only() {
    let now = utc(2027, 3, 1, 9, 0);
    let pol = Policy::from_settings(&HistorySettings { keep_weekly_weeks: 4, ..Default::default() });
    let ts = every(now - 90 * DAY_MS, now, 47 * 60_000);
    let later = now + 3650 * DAY_MS;
    let k = kept(&ts, later, &|_| 0, &pol);
    assert_eq!(k, BTreeSet::from([*ts.last().unwrap()]), "everything older than the retained window goes; the lineage's newest stays");
    // with weekly = forever the weekly representatives stay however far the clock jumps
    let forever = kept(&ts, later, &|_| 0, &defaults());
    let weeks: BTreeSet<i64> = ts.iter().map(|t| local_week(*t, 0)).collect();
    assert_eq!(forever.len(), weeks.len(), "one per week, forever");
}

// ---------------------------------------------------------------------------------------------
// Real files and the sweep
// ---------------------------------------------------------------------------------------------

fn history(d: &mut Dev, n: usize, from: u64, step: u64) -> String {
    let mut sc = scene(5, 30, 1, 2000);
    let mut lin = String::new();
    for i in 0..n {
        sc.edit();
        d.at(from + i as u64 * step);
        lin = d.put("a.excalidraw", &sc.json(), Reason::Auto).lineage;
    }
    lin
}

#[test]
fn sweeps_with_the_clock_before_every_version_delete_nothing_and_a_later_forward_jump_thins_safely() {
    let mut d = Dev::new(T0);
    let lin = history(&mut d, 80, T0, 25 * 60_000);
    let before = d.version_ids().len();
    assert_eq!(before, 80);
    for now in [1u64, T0 - 40 * DAY_MS, T0 - 1] {
        d.at(now);
        d.rescan();
        assert_eq!(gc::retain_with(&d.ctx(), &lin, &off0, usize::MAX), 0, "now={now}");
        d.sweep();
        assert_eq!(d.version_ids().len(), before, "now={now}: the sweep deleted nothing");
    }
    // a ten-year forward jump: thinned to weekly representatives, and everything still decodes
    d.at(T0 + 3650 * DAY_MS);
    d.sweep();
    let left = d.version_ids().len();
    assert!(left < before, "{left}");
    assert_eq!(verify_all_versions(d.root()), left);
    let newest = d.vh.list("a.excalidraw").unwrap().versions[0].id.clone();
    assert!(!exact(&d, &newest).is_empty());
}

#[test]
fn own_blob_grace_uses_this_macs_clock_a_jump_back_never_deletes_early() {
    let mut d = Dev::new(T0);
    let lin = d.put("img.excalidraw", &scene(3, 5, 1, 2000).json(), Reason::Auto).lineage;
    gc::delete_lineages(&d.ctx(), &[lin]).unwrap();
    assert_eq!(d.blobs().len(), 1);
    d.at(T0 + 10 * HOUR_MS);
    d.sweep(); // noted at +10 h
    // the clock jumps back 3 hours: "unreferenced for >= 1 h" must not be satisfied by a negative age
    d.at(T0 + 7 * HOUR_MS);
    d.sweep();
    d.sweep();
    assert_eq!(d.blobs().len(), 1, "a jump back never makes the blob look old");
    // time moves on normally
    d.at(T0 + 12 * HOUR_MS);
    d.sweep();
    assert!(d.blobs().is_empty(), "an hour after the note, the blob goes");
}

#[test]
fn a_sweep_in_zero_budget_steps_survives_the_clock_changing_between_steps() {
    let mut d = Dev::new(T0);
    history(&mut d, 60, T0, 20 * 60_000);
    let before = d.version_ids().len();
    d.at(T0 + 40 * DAY_MS);
    d.rescan();
    let mut s = Sweep::new(&d.ctx());
    let mut i = 0;
    loop {
        // the clock wobbles +-2 days between steps (a Mac coming out of sleep, NTP corrections)
        d.at(T0 + 40 * DAY_MS + if i % 2 == 0 { 2 * DAY_MS } else { 0 });
        i += 1;
        if s.step_with(&d.ctx(), Duration::ZERO, &off0) {
            break;
        }
        assert!(i < 100_000);
        verify_all_versions(d.root());
    }
    assert!(d.version_ids().len() < before);
    assert_eq!(verify_all_versions(d.root()), d.version_ids().len());
}

#[test]
fn clock_tests_utc_helper_is_right() {
    assert_eq!(utc(1970, 1, 1, 0, 0), 0);
    assert_eq!(utc(2027, 1, 15, 8, 0), T0, "the suite's T0");
    assert_eq!(utc(1970, 1, 5, 0, 0) / DAY_MS % 7, 4, "1970-01-05 is a Monday (day 4 since the epoch)");
}
