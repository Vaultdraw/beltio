//! Returning freed memory to the OS.
//!
//! macOS libmalloc keeps freed large blocks (the 20-30 MB buffers made while reading and
//! writing big drawings) in a cache that `phys_footprint` counts, and measurements show
//! `malloc_zone_pressure_relief` does not empty it. `LargeBlockAlloc` therefore keeps multi-MB
//! blocks out of libmalloc altogether (unmapped on free). The relief call remains for the
//! small/tiny magazines and for memory-pressure events; it never touches live allocations.
//! On Linux (glibc) large blocks are mmapped and unmapped by glibc itself, so only `malloc_trim` is added.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[cfg(target_os = "macos")]
extern "C" {
    fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
}

/// Release cached free memory: every malloc zone on macOS, the glibc heap on Linux (gnu).
/// No-op elsewhere (musl has no `malloc_trim`).
pub fn release_free_memory() {
    #[cfg(target_os = "macos")]
    // SAFETY: a null zone means "all zones"; a zero goal means "release as much as possible".
    unsafe {
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
    // glibc keeps freed small blocks in per-thread arenas; `malloc_trim(0)` hands the free top and
    // interior pages back to the kernel. Big blocks are already mmapped, so this only matters for
    // the long-lived growth of the small-block heap. Never touches live allocations.
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: `malloc_trim` takes no pointers and is safe to call from any thread.
    unsafe {
        libc::malloc_trim(0);
    }
}

/// Global allocator that gives big blocks (drawing files, IPC bodies, snapshot buffers,
/// vector growth) their own anonymous mapping and unmaps it on free.
///
/// libmalloc keeps freed blocks of 1 MB and more in a cache that stays in
/// `phys_footprint`, and `malloc_zone_pressure_relief` does not empty it (measured:
/// a freed 64 MB buffer stays at +64 MB after relief), so every large read or save
/// ratcheted the footprint up. Unmapping returns the pages to the kernel at once.
/// Everything below the threshold (1 MiB) goes to the system allocator unchanged.
#[cfg(target_os = "macos")]
pub struct LargeBlockAlloc;

#[cfg(target_os = "macos")]
mod large {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::ffi::c_void;

    extern "C" {
        fn mmap(addr: *mut c_void, len: usize, prot: i32, flags: i32, fd: i32, offset: i64) -> *mut c_void;
        fn munmap(addr: *mut c_void, len: usize) -> i32;
    }
    const PROT_READ_WRITE: i32 = 0x1 | 0x2;
    const MAP_PRIVATE_ANON: i32 = 0x0002 | 0x1000;
    /// Blocks at least this big (1 MiB: multi-MB file, IPC and snapshot buffers) are mapped directly.
    pub(super) const THRESHOLD: usize = 1024 * 1024;
    /// Largest page size we run on (Apple silicon); mappings are rounded up to it.
    const PAGE: usize = 16 * 1024;

    fn is_large(l: Layout) -> bool {
        // mmap is only guaranteed page aligned (4 KiB on Intel Macs).
        l.size() >= THRESHOLD && l.align() <= 4096
    }
    fn span(size: usize) -> usize {
        size.div_ceil(PAGE) * PAGE
    }
    unsafe fn map(size: usize) -> *mut u8 {
        // SAFETY: anonymous private mapping, no fixed address.
        let p = unsafe { mmap(std::ptr::null_mut(), span(size), PROT_READ_WRITE, MAP_PRIVATE_ANON, -1, 0) };
        if p as isize == -1 {
            std::ptr::null_mut()
        } else {
            p.cast()
        }
    }
    unsafe fn unmap(p: *mut u8, size: usize) {
        // SAFETY: `p` came from `map(size)`.
        unsafe { munmap(p.cast(), span(size)) };
    }

    // SAFETY: large blocks are page-aligned mappings of at least `size` bytes, released with the
    // same size; everything else is delegated to `System`.
    unsafe impl GlobalAlloc for super::LargeBlockAlloc {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            unsafe { if is_large(l) { map(l.size()) } else { System.alloc(l) } }
        }
        unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
            // Fresh anonymous pages are already zero.
            unsafe { if is_large(l) { map(l.size()) } else { System.alloc_zeroed(l) } }
        }
        unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
            unsafe { if is_large(l) { unmap(p, l.size()) } else { System.dealloc(p, l) } }
        }
        unsafe fn realloc(&self, p: *mut u8, l: Layout, new_size: usize) -> *mut u8 {
            // SAFETY: the caller guarantees `new_size` is valid for `l.align()`.
            unsafe {
                let nl = Layout::from_size_align_unchecked(new_size, l.align());
                if !is_large(l) && !is_large(nl) {
                    return System.realloc(p, l, new_size);
                }
                if is_large(l) && is_large(nl) && span(l.size()) == span(new_size) {
                    return p;
                }
                let n = self.alloc(nl);
                if !n.is_null() {
                    std::ptr::copy_nonoverlapping(p, n, l.size().min(new_size));
                    self.dealloc(p, l);
                }
                n
            }
        }
    }
}

/// The process allocator: `LargeBlockAlloc` on macOS, the system one elsewhere.
#[cfg(target_os = "macos")]
pub type ProcessAlloc = LargeBlockAlloc;
#[cfg(target_os = "macos")]
pub const PROCESS_ALLOC: ProcessAlloc = LargeBlockAlloc;
#[cfg(not(target_os = "macos"))]
pub type ProcessAlloc = std::alloc::System;
#[cfg(not(target_os = "macos"))]
pub const PROCESS_ALLOC: ProcessAlloc = std::alloc::System;

/// How long to wait so buffers freed when the IPC call finishes are already on the free list.
const RELEASE_DELAY: Duration = Duration::from_millis(250);
static RELEASE_PENDING: AtomicBool = AtomicBool::new(false);

/// Debounced, off-thread `release_free_memory`: bursts of saves share one pass, and the
/// IPC request/response buffers (freed only after the command returns) are included.
pub fn schedule_release() {
    if RELEASE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(RELEASE_DELAY);
        RELEASE_PENDING.store(false, Ordering::Release);
        release_free_memory();
    });
}

/// `phys_footprint` of this process in bytes (what Activity Monitor calls "Memory"); 0 elsewhere.
#[cfg(all(test, target_os = "macos"))]
pub(crate) fn footprint_bytes() -> u64 {
    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut u8) -> i32;
    }
    const RUSAGE_INFO_V4: i32 = 4;
    const PHYS_FOOTPRINT_OFFSET: usize = 72; // rusage_info_v0.ri_phys_footprint
    let mut buf = [0u8; 512];
    // SAFETY: the buffer is larger than rusage_info_v4 (296 bytes).
    let rc = unsafe { proc_pid_rusage(std::process::id() as i32, RUSAGE_INFO_V4, buf.as_mut_ptr()) };
    if rc != 0 {
        return 0;
    }
    u64::from_le_bytes(buf[PHYS_FOOTPRINT_OFFSET..PHYS_FOOTPRINT_OFFSET + 8].try_into().unwrap())
}

/// Resident set size of this process in bytes, from `/proc/self/statm` (test helper on Linux).
#[cfg(all(test, target_os = "linux"))]
pub(crate) fn footprint_bytes() -> u64 {
    let pages = std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|s| s.split_whitespace().nth(1).and_then(|v| v.parse::<u64>().ok()))
        .unwrap_or(0);
    pages * 4096
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Tests that allocate big buffers or read the footprint must not overlap.
    static BIG: Mutex<()> = Mutex::new(());

    /// The footprint is process-wide, so this only means something with no other test running:
    /// `cargo test freed_large_buffers -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn freed_large_buffers_leave_the_footprint_at_once() {
        let _serial = BIG.lock().unwrap_or_else(|p| p.into_inner());
        // Run serially with other footprint readers: only one test thread allocates big here.
        let mb = |b: u64| b as f64 / 1048576.0;
        let base = footprint_bytes();
        let mut peak = 0;
        for _ in 0..4 {
            let mut v: Vec<u8> = Vec::with_capacity(22 << 20);
            v.resize(22 << 20, 7);
            std::hint::black_box(&v);
            peak = peak.max(footprint_bytes());
        }
        let after = footprint_bytes();
        eprintln!("footprint MB base {:.1}, peak {:.1}, after 4 freed 22 MB buffers {:.1}", mb(base), mb(peak), mb(after));
        // Margins tolerate other test threads allocating a few MB meanwhile.
        assert!(peak >= base + (20 << 20), "buffer was not resident");
        assert!(after + (14 << 20) < peak, "freed buffers stayed in the footprint");
    }

    #[test]
    fn large_blocks_keep_contents_across_realloc_and_zeroing() {
        let _serial = BIG.lock().unwrap_or_else(|p| p.into_inner());
        let mut v: Vec<u32> = Vec::new();
        for i in 0..400_000u32 {
            v.push(i); // grows through the 1 MiB threshold by doubling
        }
        assert!(v.iter().enumerate().all(|(i, &x)| x == i as u32));
        v.truncate(10);
        v.shrink_to_fit(); // large -> small
        assert_eq!(v, (0..10).collect::<Vec<u32>>());
        let z = vec![0u8; 3 << 20];
        assert!(z.iter().all(|&b| b == 0));
        let s: String = "é".repeat(300_000);
        assert_eq!(s.clone().into_bytes().len(), 600_000);
        let aligned = std::alloc::Layout::from_size_align(1 << 20, 64 << 10).unwrap();
        // SAFETY: valid non-zero layout, freed with the same layout.
        unsafe {
            let p = std::alloc::alloc(aligned);
            assert!(!p.is_null() && p as usize % (64 << 10) == 0);
            std::alloc::dealloc(p, aligned);
        }
    }

    /// `cargo test --release time_vec_growth -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn time_vec_growth() {
        let _serial = BIG.lock().unwrap_or_else(|p| p.into_inner());
        let mut times = Vec::new();
        for _ in 0..15 {
            let t = std::time::Instant::now();
            let mut v: Vec<u8> = Vec::with_capacity(200 * 1024);
            while v.len() < 32 << 20 {
                v.extend_from_slice(&[1u8; 64 * 1024]); // doubles 200 KiB -> 32 MiB
            }
            std::hint::black_box(&v);
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        eprintln!("vec growth 200K->32MB: median {:.2} ms, max {:.2} ms", times[7], times[14]);
    }

    #[test]
    fn release_is_cheap_after_large_free() {
        let _serial = BIG.lock().unwrap_or_else(|p| p.into_inner());
        let big = vec![1u8; 22 * 1024 * 1024];
        std::hint::black_box(&big);
        drop(big);
        let start = std::time::Instant::now();
        release_free_memory();
        eprintln!("release_free_memory after 22 MB free: {:?}", start.elapsed());
    }

    #[test]
    fn schedule_is_debounced() {
        schedule_release();
        assert!(RELEASE_PENDING.load(Ordering::Acquire));
        schedule_release();
    }
}
