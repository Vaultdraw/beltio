//! PDF import: opens PDFs and renders single pages to JPEG/PNG bytes with CoreGraphics + ImageIO
//! (macOS) or poppler-glib + cairo (Linux, `linux` module).
#![cfg_attr(test, allow(dead_code))]
//!
//! CGPDFDocument/CGPDFPage are not `Send`, so ONE owner thread ("pdf-import") holds every open
//! document; commands send it requests over an mpsc channel and wait for the reply inside
//! `spawn_blocking`. That also serialises renders (one bitmap alive at a time).
use crate::{err, Result};
use serde::Serialize;

/// Largest PDF accepted over IPC (dropped files); the bytes are copied several times.
const MAX_BYTES_IPC: usize = 128 * 1024 * 1024;
/// Largest PDF accepted at all (picked from disk, opened by URL).
const MAX_BYTES_FILE: u64 = 512 * 1024 * 1024;
/// Open documents kept at once; the oldest is evicted beyond this.
const MAX_OPEN_DOCS: usize = 4;
const MIN_SIDE: u32 = 64;
const MAX_SIDE: u32 = 8192;
/// Cap on w*h of one bitmap (about 64 MB at 4 bytes per pixel).
const MAX_PIXELS: f64 = 16_000_000.0;
/// Channel spread (0..255) up to which a pixel still counts as neutral grey.
const NEUTRAL_TOLERANCE: u8 = 2;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageInfo {
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub token: u32,
    pub name: String,
    pub page_count: usize,
    pub pages: Vec<PdfPageInfo>,
    pub byte_size: u64,
    /// Encrypted and the empty password failed: ask for a password (`pdf_unlock`); no pages yet.
    pub locked: bool,
}

/// True when every sampled RGBX pixel is neutral (r, g, b within `tol`): a monochrome page.
/// `rgbx` holds `h` rows of `stride` bytes, 4 bytes per pixel (alpha/skip byte ignored).
fn is_neutral_rgbx(rgbx: &[u8], w: usize, h: usize, stride: usize, tol: u8) -> bool {
    (0..h).all(|y| {
        rgbx[y * stride..y * stride + w * 4].chunks_exact(4).all(|p| p[0].abs_diff(p[1]) <= tol && p[1].abs_diff(p[2]) <= tol)
    })
}

/// Display size of a box after /Rotate (90 and 270 swap the sides).
fn display_size(w: f64, h: f64, rotation: i32) -> (f64, f64) {
    match rotation.rem_euclid(360) {
        90 | 270 => (h, w),
        _ => (w, h),
    }
}

/// Pixel size so the long side is `max_side` (aspect kept, each side >= 1, w*h capped).
fn target_size(w_pt: f64, h_pt: f64, max_side: u32) -> Option<(usize, usize)> {
    if !(w_pt.is_finite() && h_pt.is_finite()) || w_pt <= 0.0 || h_pt <= 0.0 {
        return None;
    }
    let mut scale = f64::from(max_side.clamp(MIN_SIDE, MAX_SIDE)) / w_pt.max(h_pt);
    let px = (w_pt * scale) * (h_pt * scale);
    if px > MAX_PIXELS {
        scale *= (MAX_PIXELS / px).sqrt();
    }
    let w = ((w_pt * scale).round() as usize).max(1);
    let h = ((h_pt * scale).round() as usize).max(1);
    Some((w, h))
}

/// Intersection of two (x, y, w, h) rects; None when they do not overlap.
fn intersect(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> Option<(f64, f64, f64, f64)> {
    let (x0, y0) = (a.0.max(b.0), a.1.max(b.1));
    let (x1, y1) = ((a.0 + a.2).min(b.0 + b.2), (a.1 + a.3).min(b.1 + b.3));
    (x1 > x0 && y1 > y0).then_some((x0, y0, x1 - x0, y1 - y0))
}

/// Affine (a, b, c, d, tx, ty) mapping the page rect `r` (x, y, w, h) with /Rotate `rotation`
/// (clockwise degrees) onto a bottom-left-origin bitmap of `w` x `h` pixels.
fn page_transform(r: (f64, f64, f64, f64), rotation: i32, w: f64, h: f64) -> [f64; 6] {
    let (rx, ry, rw, rh) = r;
    let (a, b, c, d, tx, ty) = match rotation.rem_euclid(360) {
        90 => (0.0, -h / rw, w / rh, 0.0, 0.0, h),
        180 => (-w / rw, 0.0, 0.0, -h / rh, w, h),
        270 => (0.0, h / rw, -w / rh, 0.0, w, 0.0),
        _ => (w / rw, 0.0, 0.0, h / rh, 0.0, 0.0),
    };
    // Fold the translation of the rect origin to (0, 0) into the matrix.
    [a, b, c, d, tx - a * rx - c * ry, ty - b * rx - d * ry]
}

#[cfg(target_os = "macos")]
pub(crate) mod mac {
    use super::*;
    use crate::NativeError;
    use objc2::rc::autoreleasepool;
    use objc2_core_foundation::{
        CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFType, CFURL,
    };
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGBitmapContextCreateImage, CGBitmapContextGetBytesPerRow, CGBitmapContextGetData, CGColorSpace, CGContext, CGImage,
        CGImageAlphaInfo, CGInterpolationQuality, CGPDFBox, CGPDFDocument, CGPDFPage,
    };
    use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
    use std::collections::{HashMap, VecDeque};
    use std::ffi::c_void;
    use std::path::{Path, PathBuf};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{self, Sender, SyncSender};
    use std::sync::OnceLock;

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub enum Format {
        Jpeg,
        Png,
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        static kCGImageDestinationLossyCompressionQuality: &'static CFString;
        fn CGImageDestinationCreateWithData(
            data: *const c_void,
            uti: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *mut c_void;
        fn CGImageDestinationAddImage(
            dest: *mut c_void,
            image: *const c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
    }

    /// Encodes `image` with ImageIO (JPEG quality 0..1, ignored for PNG).
    fn encode(image: &CGImage, format: Format, quality: f32) -> Result<Vec<u8>> {
        let failed = || err("PDF_PAGE_FAILED", "Could not encode the page image");
        let data = CFMutableData::new(None, 0).ok_or_else(failed)?;
        let uti = CFString::from_str(match format {
            Format::Jpeg => "public.jpeg",
            Format::Png => "public.png",
        });
        let dest = unsafe {
            CGImageDestinationCreateWithData(
                (&*data as *const CFMutableData).cast(),
                (&*uti as *const CFString).cast(),
                1,
                std::ptr::null(),
            )
        };
        // CFRetained releases the destination on every exit path.
        let dest = NonNull::new(dest.cast::<CFType>()).ok_or_else(failed)?;
        let dest = unsafe { CFRetained::from_raw(dest) };
        let dest_ptr = (&*dest as *const CFType).cast_mut().cast::<c_void>();
        let ok = if format == Format::Jpeg {
            let number = CFNumber::new_f64(f64::from(quality));
            let props = CFDictionary::<CFString, CFNumber>::from_slices(
                &[unsafe { kCGImageDestinationLossyCompressionQuality }],
                &[&*number],
            );
            unsafe {
                CGImageDestinationAddImage(
                    dest_ptr,
                    (image as *const CGImage).cast(),
                    (&*props as *const CFDictionary<CFString, CFNumber>).cast(),
                );
                CGImageDestinationFinalize(dest_ptr)
            }
        } else {
            unsafe {
                CGImageDestinationAddImage(dest_ptr, (image as *const CGImage).cast(), std::ptr::null());
                CGImageDestinationFinalize(dest_ptr)
            }
        };
        if !ok {
            return Err(failed());
        }
        let bytes = unsafe { std::slice::from_raw_parts(data.byte_ptr(), data.length() as usize) };
        Ok(bytes.to_vec())
    }

    /// Draws `page` (crop box, honouring /Rotate) scaled into a white `w` x `h` RGBA bitmap.
    pub(super) fn draw_page(page: &CGPDFPage, w: usize, h: usize) -> Option<CFRetained<CGContext>> {
        let space = CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }))?;
        let ctx = unsafe {
            CGBitmapContextCreate(
                std::ptr::null_mut(),
                w,
                h,
                8,
                0,
                Some(&space),
                CGImageAlphaInfo::NoneSkipLast.0,
            )
        }?;
        let full = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
        CGContext::set_rgb_fill_color(Some(&ctx), 1.0, 1.0, 1.0, 1.0);
        CGContext::fill_rect(Some(&ctx), full);
        CGContext::set_interpolation_quality(Some(&ctx), CGInterpolationQuality::High);
        CGContext::save_g_state(Some(&ctx));
        let r = visible_rect(page)?;
        let [a, b, c, d, tx, ty] = page_transform(r, CGPDFPage::rotation_angle(Some(page)), w as f64, h as f64);
        CGContext::concat_ctm(Some(&ctx), CGAffineTransform { a, b, c, d, tx, ty });
        // Drawing clips to the media box only; the visible area is the crop box.
        CGContext::clip_to_rect(Some(&ctx), CGRect::new(CGPoint::new(r.0, r.1), CGSize::new(r.2, r.3)));
        CGContext::draw_pdf_page(Some(&ctx), Some(page));
        CGContext::restore_g_state(Some(&ctx));
        Some(ctx)
    }

    /// A DeviceGray copy of the page when it is monochrome (smaller JPEG/PNG, one channel), else None.
    fn gray_image(ctx: &CGContext, w: usize, h: usize) -> Option<CFRetained<CGImage>> {
        let src = CGBitmapContextGetData(Some(ctx)) as *const u8;
        let stride = CGBitmapContextGetBytesPerRow(Some(ctx));
        if src.is_null() {
            return None;
        }
        let rgbx = unsafe { std::slice::from_raw_parts(src, stride * h) };
        if !is_neutral_rgbx(rgbx, w, h, stride, NEUTRAL_TOLERANCE) {
            return None;
        }
        let space = CGColorSpace::new_device_gray()?;
        let gray = unsafe { CGBitmapContextCreate(std::ptr::null_mut(), w, h, 8, 0, Some(&space), CGImageAlphaInfo::None.0) }?;
        let dst = CGBitmapContextGetData(Some(&gray)) as *mut u8;
        let dst_stride = CGBitmapContextGetBytesPerRow(Some(&gray));
        if dst.is_null() {
            return None;
        }
        for y in 0..h {
            let row = unsafe { std::slice::from_raw_parts_mut(dst.add(y * dst_stride), w) };
            for (x, px) in row.iter_mut().enumerate() {
                *px = rgbx[y * stride + x * 4];
            }
        }
        CGBitmapContextCreateImage(Some(&gray))
    }

    fn box_tuple(page: &CGPDFPage, which: CGPDFBox) -> (f64, f64, f64, f64) {
        let r = CGPDFPage::box_rect(Some(page), which);
        (r.origin.x, r.origin.y, r.size.width, r.size.height)
    }

    /// Crop box intersected with the media box (CoreGraphics does not intersect them).
    fn visible_rect(page: &CGPDFPage) -> Option<(f64, f64, f64, f64)> {
        let media = box_tuple(page, CGPDFBox::MediaBox);
        let crop = box_tuple(page, CGPDFBox::CropBox);
        if ![media, crop].iter().all(|b| b.0.is_finite() && b.1.is_finite() && b.2.is_finite() && b.3.is_finite()) {
            return None;
        }
        intersect(crop, media).or_else(|| (media.2 > 0.0 && media.3 > 0.0).then_some(media))
    }

    /// Page size in points after /Rotate; (0, 0) when the page has no usable box.
    fn page_size(page: &CGPDFPage) -> (f64, f64) {
        visible_rect(page).map_or((0.0, 0.0), |r| display_size(r.2, r.3, CGPDFPage::rotation_angle(Some(page))))
    }

    pub(super) struct Doc {
        doc: CFRetained<CGPDFDocument>,
        temp: Option<PathBuf>,
        name: String,
        byte_size: u64,
    }

    impl Drop for Doc {
        fn drop(&mut self) {
            if let Some(path) = &self.temp {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    impl Doc {
        #[cfg(test)]
        pub(super) fn for_test(doc: CFRetained<CGPDFDocument>) -> Doc {
            Doc { doc, temp: None, name: String::new(), byte_size: 0 }
        }

        /// Encrypted and still locked (the empty password was refused).
        pub(super) fn locked(&self) -> bool {
            CGPDFDocument::is_encrypted(Some(&self.doc)) && !CGPDFDocument::is_unlocked(Some(&self.doc))
        }

        /// Tries `password`; the password is never stored or logged.
        pub(super) fn unlock(&self, password: &str) -> bool {
            let Ok(c) = std::ffi::CString::new(password) else { return false };
            unsafe { CGPDFDocument::unlock_with_password(Some(&self.doc), NonNull::from(c.as_c_str()).cast()) }
        }

        /// Page sizes and counts; an unlocked document only.
        pub(super) fn describe(&self, token: u32) -> Result<PdfInfo> {
            let page_count = CGPDFDocument::number_of_pages(Some(&self.doc));
            if page_count == 0 {
                return Err(err("PDF_INVALID", "The PDF has no pages"));
            }
            let mut pages = Vec::with_capacity(page_count);
            for i in 0..page_count as u32 {
                let page = self.page(i)?;
                let (w, h) = page_size(&page);
                // Invalid sizes are reported here as a default and fail on render.
                let valid = w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0;
                pages.push(PdfPageInfo { width_pt: if valid { w } else { 612.0 }, height_pt: if valid { h } else { 792.0 } });
            }
            Ok(PdfInfo { token, name: self.name.clone(), page_count, pages, byte_size: self.byte_size, locked: false })
        }

        pub(super) fn page(&self, index: u32) -> Result<CFRetained<CGPDFPage>> {
            // CGPDFDocument pages are 1-based.
            CGPDFDocument::page(Some(&self.doc), index as usize + 1)
                .ok_or_else(|| err("PDF_PAGE_FAILED", format!("Page {} not found", index + 1)))
        }

        pub(super) fn render(&self, index: u32, max_side: u32, format: Format, quality: f32) -> Result<Vec<u8>> {
            if self.locked() {
                return Err(err("PDF_ENCRYPTED", "This PDF is password protected"));
            }
            let page = self.page(index)?;
            let (wp, hp) = page_size(&page);
            let (w, h) = target_size(wp, hp, max_side)
                .ok_or_else(|| err("PDF_PAGE_FAILED", "The page has no valid size"))?;
            // The bitmap context is dropped before encoding: one bitmap at a time.
            let (colour, gray) = {
                let ctx = draw_page(&page, w, h).ok_or_else(|| err("PDF_PAGE_FAILED", "Could not create the page bitmap"))?;
                match gray_image(&ctx, w, h) {
                    Some(gray) => (None, Some(gray)),
                    None => (Some(CGBitmapContextCreateImage(Some(&ctx)).ok_or_else(|| err("PDF_PAGE_FAILED", "Could not read the page bitmap"))?), None),
                }
            };
            if let Some(gray) = gray {
                let best = encode(&gray, format, quality)?;
                // Monochrome text/line art is far smaller (and sharper) as a gray PNG than as a JPEG.
                if format == Format::Jpeg {
                    if let Ok(png) = encode(&gray, Format::Png, 1.0) {
                        if png.len() < best.len() {
                            return Ok(png);
                        }
                    }
                }
                return Ok(best);
            }
            encode(&colour.expect("colour or gray"), format, quality)
        }
    }

    enum Req {
        Open { path: PathBuf, name: String, temp: bool, reply: SyncSender<Result<PdfInfo>> },
        Render { token: u32, index: u32, max_side: u32, format: Format, quality: f32, reply: SyncSender<Result<Vec<u8>>> },
        Unlock { token: u32, password: String, reply: SyncSender<Result<PdfInfo>> },
        Close { token: u32, reply: SyncSender<()> },
    }

    fn open_doc(path: &Path, name: String, temp: bool, token: u32) -> Result<(Doc, PdfInfo)> {
        // From here the temp file belongs to `Doc` (or is removed on error by the guard below).
        let guard = temp.then(|| path.to_path_buf());
        let result = (|| {
            let byte_size = std::fs::metadata(path).map_err(crate::ioerr)?.len();
            if byte_size > MAX_BYTES_FILE {
                return Err(err("PDF_TOO_LARGE", "The PDF is larger than 512 MiB"));
            }
            let url = CFURL::from_file_path(path).ok_or_else(|| err("PDF_INVALID", "Invalid file path"))?;
            let doc = CGPDFDocument::with_url(Some(&url)).ok_or_else(|| err("PDF_INVALID", "This is not a readable PDF"))?;
            let doc = Doc { doc, temp: guard.clone(), name, byte_size };
            if doc.locked() {
                // Many PDFs are "encrypted" with an empty user password.
                if !doc.unlock("") {
                    // Kept open and locked: the dialog asks for a password (`pdf_unlock`).
                    let info = PdfInfo { token, name: doc.name.clone(), page_count: 0, pages: vec![], byte_size, locked: true };
                    return Ok((doc, info));
                }
            }
            let info = doc.describe(token)?;
            Ok((doc, info))
        })();
        if result.is_err() {
            if let Some(g) = guard {
                let _ = std::fs::remove_file(g);
            }
        }
        result
    }

    fn owner_loop(rx: mpsc::Receiver<Req>) {
        let mut docs: HashMap<u32, Doc> = HashMap::new();
        let mut order: VecDeque<u32> = VecDeque::new();
        let mut next_token: u32 = 1;
        while let Ok(req) = rx.recv() {
            match req {
                Req::Open { path, name, temp, reply } => {
                    let token = next_token;
                    let out = autoreleasepool(|_| open_doc(&path, name, temp, token));
                    let out = out.map(|(doc, info)| {
                        next_token = next_token.wrapping_add(1).max(1);
                        docs.insert(token, doc);
                        order.push_back(token);
                        while order.len() > MAX_OPEN_DOCS {
                            if let Some(old) = order.pop_front() {
                                docs.remove(&old);
                            }
                        }
                        info
                    });
                    let _ = reply.send(out);
                }
                Req::Render { token, index, max_side, format, quality, reply } => {
                    let out = match docs.get(&token) {
                        None => Err(err("PDF_BAD_TOKEN", "The PDF is no longer open")),
                        Some(doc) => autoreleasepool(|_| doc.render(index, max_side, format, quality)),
                    };
                    let _ = reply.send(out);
                }
                Req::Unlock { token, password, reply } => {
                    let out = match docs.get(&token) {
                        None => Err(err("PDF_BAD_TOKEN", "The PDF is no longer open")),
                        Some(doc) if !doc.locked() => autoreleasepool(|_| doc.describe(token)),
                        Some(doc) if !doc.unlock(&password) => Err(err("PDF_BAD_PASSWORD", "Wrong password")),
                        Some(doc) => autoreleasepool(|_| doc.describe(token)),
                    };
                    let _ = reply.send(out);
                }
                Req::Close { token, reply } => {
                    docs.remove(&token);
                    order.retain(|t| *t != token);
                    let _ = reply.send(());
                }
            }
        }
    }

    /// Handle to the owner thread. Dropping every handle stops the thread and deletes temp files.
    pub struct Service {
        tx: Sender<Req>,
        temp_dir: PathBuf,
    }

    fn stopped() -> NativeError {
        err("PDF_PAGE_FAILED", "The PDF worker stopped")
    }

    impl Service {
        pub fn spawn(temp_dir: PathBuf) -> Service {
            let (tx, rx) = mpsc::channel();
            std::thread::Builder::new()
                .name("pdf-import".into())
                .spawn(move || owner_loop(rx))
                .expect("spawn pdf-import thread");
            Service { tx, temp_dir }
        }

        fn ask<T>(&self, make: impl FnOnce(SyncSender<T>) -> Req) -> Result<T> {
            let (reply, rx) = mpsc::sync_channel(1);
            self.tx.send(make(reply)).map_err(|_| stopped())?;
            rx.recv().map_err(|_| stopped())
        }

        pub fn open_path(&self, path: &Path, name: &str) -> Result<PdfInfo> {
            self.ask(|reply| Req::Open { path: path.to_path_buf(), name: name.into(), temp: false, reply })?
        }

        pub fn open_bytes(&self, name: &str, bytes: &[u8]) -> Result<PdfInfo> {
            if bytes.len() > MAX_BYTES_IPC {
                return Err(err("PDF_TOO_LARGE", "Dropped PDFs are limited to 128 MiB"));
            }
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            std::fs::create_dir_all(&self.temp_dir).map_err(crate::ioerr)?;
            let path = self.temp_dir.join(format!("{}.pdf", COUNTER.fetch_add(1, Ordering::Relaxed)));
            write_private(&path, bytes).map_err(|e| {
                let _ = std::fs::remove_file(&path);
                crate::ioerr(e)
            })?;
            // The owner thread now owns the temp file and deletes it on close, eviction or error.
            self.ask(|reply| Req::Open { path, name: name.into(), temp: true, reply })?
        }

        pub fn render(&self, token: u32, index: u32, max_side: u32, format: &str, quality: f32) -> Result<Vec<u8>> {
            let format = match format {
                "jpeg" | "jpg" => Format::Jpeg,
                "png" => Format::Png,
                other => return Err(err("INVALID_ARGUMENT", format!("Unknown image format {other}"))),
            };
            let max_side = max_side.clamp(MIN_SIDE, MAX_SIDE);
            let quality = if quality.is_nan() { 0.85 } else { quality.clamp(0.3, 1.0) };
            self.ask(|reply| Req::Render { token, index, max_side, format, quality, reply })?
        }

        pub fn unlock(&self, token: u32, password: String) -> Result<PdfInfo> {
            self.ask(|reply| Req::Unlock { token, password, reply })?
        }

        pub fn close(&self, token: u32) -> Result<()> {
            self.ask(|reply| Req::Close { token, reply })
        }
    }

    fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
        file.write_all(bytes)
    }

    /// `<tmp>/vaultdraw-pdf-import/<pid>`; stale folders of earlier runs (older than a day) are swept.
    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join("vaultdraw-pdf-import");
        if let Ok(entries) = std::fs::read_dir(&root) {
            let day = std::time::Duration::from_secs(24 * 3600);
            for entry in entries.flatten() {
                let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day);
                if old {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
        root.join(std::process::id().to_string())
    }

    fn service() -> &'static Service {
        static SERVICE: OnceLock<Service> = OnceLock::new();
        SERVICE.get_or_init(|| Service::spawn(temp_root()))
    }

    fn file_name(path: &Path) -> String {
        path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Runs blocking work (channel wait) off the async runtime.
    async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
        tauri::async_runtime::spawn_blocking(f)
            .await
            .map_err(|e| err("PDF_PAGE_FAILED", e.to_string()))?
    }

    pub async fn pick() -> Result<Option<PdfInfo>> {
        #[cfg(feature = "smoke-test")]
        let picked = if crate::smoke::enabled() {
            Some(crate::smoke::pdf_import_path().map_err(|e| err("SMOKE_CONFIG", e))?)
        } else {
            rfd::FileDialog::new().set_title("Import PDF").add_filter("PDF", &["pdf"]).pick_file()
        };
        #[cfg(not(feature = "smoke-test"))]
        let picked = rfd::FileDialog::new().set_title("Import PDF").add_filter("PDF", &["pdf"]).pick_file();
        let Some(path) = picked else { return Ok(None) };
        blocking(move || service().open_path(&path, &file_name(&path)).map(Some)).await
    }

    pub async fn open_bytes(name: String, bytes: Vec<u8>) -> Result<PdfInfo> {
        blocking(move || service().open_bytes(&name, &bytes)).await
    }

    pub async fn render(token: u32, index: u32, max_side: u32, format: String, quality: f32) -> Result<Vec<u8>> {
        blocking(move || service().render(token, index, max_side, &format, quality)).await
    }

    pub async fn unlock(token: u32, password: String) -> Result<PdfInfo> {
        blocking(move || service().unlock(token, password)).await
    }

    pub async fn close(token: u32) -> Result<()> {
        blocking(move || service().close(token)).await
    }

    // Test helpers shared with the tests below.
    #[cfg(test)]
    pub(super) mod fixtures {
        use super::*;
        use objc2_core_foundation::CFData;
        use objc2_core_graphics::{kCGPDFContextMediaBox, CGPDFContextBeginPage, CGPDFContextClose, CGPDFContextCreateWithURL, CGPDFContextEndPage, CGBitmapContextGetBytesPerRow, CGBitmapContextGetData};
        #[allow(deprecated)]
        use objc2_core_graphics::CGTextEncoding;
        use std::os::raw::c_char;

        /// CoreGraphics-made PDF: one page per (w, h) size, with a red square at the top-left
        /// and a few lines of text. `lines` text lines per page.
        #[allow(deprecated)]
        pub fn make_pdf(path: &Path, sizes: &[(f64, f64)], lines: usize) {
            let url = CFURL::from_file_path(path).unwrap();
            let first = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(sizes[0].0, sizes[0].1));
            let ctx = unsafe { CGPDFContextCreateWithURL(Some(&url), &first, None) }.unwrap();
            for (n, &(w, h)) in sizes.iter().enumerate() {
                let rect = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w, h));
                let bytes: Vec<u8> = [0.0f64, 0.0, w, h].iter().flat_map(|v| v.to_ne_bytes()).collect();
                let data = CFData::from_bytes(&bytes);
                let dict = CFDictionary::<CFString, CFData>::from_slices(&[unsafe { kCGPDFContextMediaBox }], &[&*data]);
                unsafe { CGPDFContextBeginPage(Some(&ctx), Some(dict.as_opaque())) };
                CGContext::set_rgb_fill_color(Some(&ctx), 1.0, 0.0, 0.0, 1.0);
                CGContext::fill_rect(Some(&ctx), CGRect::new(CGPoint::new(0.0, h - 40.0), CGSize::new(40.0, 40.0)));
                CGContext::set_rgb_fill_color(Some(&ctx), 0.0, 0.0, 0.0, 1.0);
                unsafe { CGContext::select_font(Some(&ctx), c"Helvetica".as_ptr() as *const c_char, 9.0, CGTextEncoding::EncodingMacRoman) };
                let _ = rect;
                for line in 0..lines {
                    let text = format!("Page {} line {line}: the quick brown fox jumps over the lazy dog 0123456789", n + 1);
                    unsafe { CGContext::show_text_at_point(Some(&ctx), 50.0, h - 60.0 - 11.0 * line as f64, text.as_ptr() as *const c_char, text.len()) };
                }
                CGPDFContextEndPage(Some(&ctx));
            }
            CGPDFContextClose(Some(&ctx));
        }

        /// One-page CoreGraphics PDF with a red square, encrypted: `user` opens it (empty = no
        /// prompt), `allow_copying` false marks it copy-protected.
        pub fn make_encrypted_pdf(path: &Path, user: &str, owner: &str, allow_copying: bool) {
            use objc2_core_foundation::CFBoolean;
            use objc2_core_graphics::{kCGPDFContextAllowsCopying, kCGPDFContextOwnerPassword, kCGPDFContextUserPassword};
            let url = CFURL::from_file_path(path).unwrap();
            let media = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(200.0, 100.0));
            let (u, o) = (CFString::from_str(user), CFString::from_str(owner));
            let copying = CFBoolean::new(allow_copying);
            let aux = CFDictionary::<CFString, CFType>::from_slices(
                &[unsafe { kCGPDFContextUserPassword }, unsafe { kCGPDFContextOwnerPassword }, unsafe { kCGPDFContextAllowsCopying }],
                &[u.as_ref(), o.as_ref(), copying.as_ref()],
            );
            let ctx = unsafe { CGPDFContextCreateWithURL(Some(&url), &media, Some(aux.as_opaque())) }.unwrap();
            unsafe { CGPDFContextBeginPage(Some(&ctx), None) };
            CGContext::set_rgb_fill_color(Some(&ctx), 1.0, 0.0, 0.0, 1.0);
            CGContext::fill_rect(Some(&ctx), CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(50.0, 50.0)));
            CGPDFContextEndPage(Some(&ctx));
            CGPDFContextClose(Some(&ctx));
        }

        /// Handwritten one-page PDF with a red 50x50 square at the lower-left corner.
        pub fn raw_pdf(media: &str, extra: &str) -> Vec<u8> {
            let content = "1 0 0 rg 0 0 50 50 re f";
            let objs = [
                "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
                format!("<< /Type /Page /Parent 2 0 R /MediaBox {media} {extra} /Contents 4 0 R >>"),
                format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
            ];
            let mut out = b"%PDF-1.4\n".to_vec();
            let mut offsets = vec![];
            for (i, o) in objs.iter().enumerate() {
                offsets.push(out.len());
                out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
            }
            let xref = out.len();
            out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
            for off in offsets {
                out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
            }
            out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
            out
        }

        /// Like `raw_pdf` with custom page content (no colour unless the content sets it).
        pub fn raw_pdf_with(content: &str) -> Vec<u8> {
            let objs = [
                "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_string(),
                format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            ];
            let mut out = b"%PDF-1.4\n".to_vec();
            let mut offsets = vec![];
            for (i, o) in objs.iter().enumerate() {
                offsets.push(out.len());
                out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
            }
            let xref = out.len();
            out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
            for off in offsets {
                out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
            }
            out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
            out
        }

        /// RGBA at (x, y) of the page drawn at `w` x `h` (row 0 = top).
        pub fn pixel(doc: &Doc, index: u32, w: usize, h: usize, x: usize, y: usize) -> [u8; 3] {
            let page = doc.page(index).unwrap();
            let ctx = draw_page(&page, w, h).unwrap();
            let base = CGBitmapContextGetData(Some(&ctx)) as *const u8;
            let stride = CGBitmapContextGetBytesPerRow(Some(&ctx));
            unsafe {
                let p = base.add(y * stride + x * 4);
                [*p, *p.add(1), *p.add(2)]
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) mod linux {
    //! Linux: poppler-glib renders pages into a cairo image surface; the PNG/JPEG encoders are
    //! pure Rust. libpoppler-glib is loaded with `dlopen` on first use, so the app starts and
    //! runs without it and the only cost of an unused PDF import is nothing at all.
    use super::*;
    use crate::NativeError;
    use std::collections::{HashMap, VecDeque};
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{self, Sender, SyncSender};
    use std::sync::OnceLock;

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub enum Format {
        Jpeg,
        Png,
    }

    #[repr(C)]
    struct GError {
        domain: u32,
        code: c_int,
        message: *mut c_char,
    }

    const CAIRO_FORMAT_RGB24: c_int = 1;
    const POPPLER_ERROR_ENCRYPTED: c_int = 1;
    const LIB_NAME: &CStr = c"libpoppler-glib.so.8";

    type Ptr = *mut c_void;

    /// The poppler-glib, GLib and cairo entry points used here, resolved from one `dlopen`
    /// handle (`dlsym` on a handle also searches the libraries it links).
    #[allow(non_snake_case)]
    struct Lib {
        poppler_document_new_from_file: unsafe extern "C" fn(*const c_char, *const c_char, *mut *mut GError) -> Ptr,
        poppler_document_get_n_pages: unsafe extern "C" fn(Ptr) -> c_int,
        poppler_document_get_page: unsafe extern "C" fn(Ptr, c_int) -> Ptr,
        poppler_page_get_size: unsafe extern "C" fn(Ptr, *mut f64, *mut f64),
        poppler_page_render: unsafe extern "C" fn(Ptr, Ptr),
        poppler_error_quark: unsafe extern "C" fn() -> u32,
        g_object_unref: unsafe extern "C" fn(Ptr),
        g_error_free: unsafe extern "C" fn(*mut GError),
        g_free: unsafe extern "C" fn(Ptr),
        g_filename_to_uri: unsafe extern "C" fn(*const c_char, *const c_char, *mut *mut GError) -> *mut c_char,
        cairo_image_surface_create: unsafe extern "C" fn(c_int, c_int, c_int) -> Ptr,
        cairo_surface_status: unsafe extern "C" fn(Ptr) -> c_int,
        cairo_surface_flush: unsafe extern "C" fn(Ptr),
        cairo_surface_destroy: unsafe extern "C" fn(Ptr),
        cairo_image_surface_get_data: unsafe extern "C" fn(Ptr) -> *mut u8,
        cairo_image_surface_get_stride: unsafe extern "C" fn(Ptr) -> c_int,
        cairo_create: unsafe extern "C" fn(Ptr) -> Ptr,
        cairo_status: unsafe extern "C" fn(Ptr) -> c_int,
        cairo_destroy: unsafe extern "C" fn(Ptr),
        cairo_set_source_rgb: unsafe extern "C" fn(Ptr, f64, f64, f64),
        cairo_paint: unsafe extern "C" fn(Ptr),
        cairo_scale: unsafe extern "C" fn(Ptr, f64, f64),
    }

    macro_rules! load_lib {
        ($handle:expr, { $($name:ident),* $(,)? }) => {{
            Lib {
                $($name: {
                    let sym = unsafe { libc::dlsym($handle, concat!(stringify!($name), "\0").as_ptr().cast()) };
                    if sym.is_null() {
                        return Err(format!("{} not found in {}", stringify!($name), LIB_NAME.to_string_lossy()));
                    }
                    // SAFETY: the signature matches the C declaration of this symbol.
                    unsafe { std::mem::transmute::<Ptr, _>(sym) }
                },)*
            }
        }};
    }

    fn load() -> std::result::Result<Lib, String> {
        let handle = unsafe { libc::dlopen(LIB_NAME.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
        if handle.is_null() {
            let reason = unsafe { libc::dlerror() };
            let reason = if reason.is_null() { String::new() } else { unsafe { CStr::from_ptr(reason) }.to_string_lossy().into_owned() };
            return Err(format!("could not load {} ({reason})", LIB_NAME.to_string_lossy()));
        }
        Ok(load_lib!(handle, {
            poppler_document_new_from_file, poppler_document_get_n_pages, poppler_document_get_page,
            poppler_page_get_size, poppler_page_render, poppler_error_quark,
            g_object_unref, g_error_free, g_free, g_filename_to_uri,
            cairo_image_surface_create, cairo_surface_status, cairo_surface_flush, cairo_surface_destroy,
            cairo_image_surface_get_data, cairo_image_surface_get_stride,
            cairo_create, cairo_status, cairo_destroy, cairo_set_source_rgb, cairo_paint, cairo_scale,
        }))
    }

    /// Loaded once, on the first PDF command; never at startup.
    fn lib() -> Result<&'static Lib> {
        static LIB: OnceLock<std::result::Result<Lib, String>> = OnceLock::new();
        LIB.get_or_init(load)
            .as_ref()
            .map_err(|e| err("PDF_UNAVAILABLE", format!("PDF import needs poppler (package libpoppler-glib8 or poppler-glib): {e}")))
    }

    enum OpenError {
        Encrypted,
        Other(String),
    }

    /// Opens `path` with poppler; `password` None tries the empty user password.
    fn open_file(lib: &Lib, path: &Path, password: Option<&str>) -> std::result::Result<Ptr, OpenError> {
        let c_path = CString::new(path.as_os_str().as_bytes()).map_err(|_| OpenError::Other("path contains NUL".into()))?;
        let c_pass = match password {
            Some(p) => Some(CString::new(p).map_err(|_| OpenError::Encrypted)?),
            None => None,
        };
        let mut gerr: *mut GError = std::ptr::null_mut();
        let uri = unsafe { (lib.g_filename_to_uri)(c_path.as_ptr(), std::ptr::null(), &mut gerr) };
        if uri.is_null() {
            return Err(OpenError::Other(take_error(lib, gerr)));
        }
        let doc = unsafe { (lib.poppler_document_new_from_file)(uri, c_pass.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()), &mut gerr) };
        unsafe { (lib.g_free)(uri.cast()) };
        if doc.is_null() {
            let encrypted = !gerr.is_null() && unsafe { (*gerr).domain == (lib.poppler_error_quark)() && (*gerr).code == POPPLER_ERROR_ENCRYPTED };
            let message = take_error(lib, gerr);
            return Err(if encrypted { OpenError::Encrypted } else { OpenError::Other(message) });
        }
        Ok(doc)
    }

    /// Message of a GError (freed here), or "" for null.
    fn take_error(lib: &Lib, gerr: *mut GError) -> String {
        if gerr.is_null() {
            return String::new();
        }
        let message = unsafe { (*gerr).message };
        let text = if message.is_null() { String::new() } else { unsafe { CStr::from_ptr(message) }.to_string_lossy().into_owned() };
        unsafe { (lib.g_error_free)(gerr) };
        text
    }

    /// One rendered page: `h` rows of `stride` bytes, 4 bytes per pixel (cairo RGB24: B, G, R, x).
    pub(super) struct Bitmap {
        pub w: usize,
        pub h: usize,
        pub stride: usize,
        pub bgrx: Vec<u8>,
    }

    impl Bitmap {
        pub fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
            let p = &self.bgrx[y * self.stride + x * 4..];
            [p[2], p[1], p[0]]
        }

        /// One gray byte per pixel when every pixel is neutral, else None.
        fn gray(&self) -> Option<Vec<u8>> {
            if !is_neutral_rgbx(&self.bgrx, self.w, self.h, self.stride, NEUTRAL_TOLERANCE) {
                return None;
            }
            Some((0..self.h).flat_map(|y| self.bgrx[y * self.stride..][..self.w * 4].chunks_exact(4).map(|p| p[2])).collect())
        }

        fn rgb(&self) -> Vec<u8> {
            let mut out = Vec::with_capacity(self.w * self.h * 3);
            for y in 0..self.h {
                for p in self.bgrx[y * self.stride..][..self.w * 4].chunks_exact(4) {
                    out.extend_from_slice(&[p[2], p[1], p[0]]);
                }
            }
            out
        }
    }

    /// Encodes `channels` (1 = gray, 3 = RGB) pixels; JPEG quality 0..1 is ignored for PNG.
    fn encode(data: &[u8], w: usize, h: usize, channels: u8, format: Format, quality: f32) -> Result<Vec<u8>> {
        let failed = |e: String| err("PDF_PAGE_FAILED", format!("Could not encode the page image: {e}"));
        let mut out = Vec::new();
        match format {
            Format::Png => {
                let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
                enc.set_color(if channels == 1 { png::ColorType::Grayscale } else { png::ColorType::Rgb });
                enc.set_depth(png::BitDepth::Eight);
                let mut writer = enc.write_header().map_err(|e| failed(e.to_string()))?;
                writer.write_image_data(data).map_err(|e| failed(e.to_string()))?;
                writer.finish().map_err(|e| failed(e.to_string()))?;
            }
            Format::Jpeg => {
                let (Ok(w16), Ok(h16)) = (u16::try_from(w), u16::try_from(h)) else {
                    return Err(failed("page too large for JPEG".into()));
                };
                let q = (quality * 100.0).round().clamp(1.0, 100.0) as u8;
                let colour = if channels == 1 { jpeg_encoder::ColorType::Luma } else { jpeg_encoder::ColorType::Rgb };
                jpeg_encoder::Encoder::new(&mut out, q).encode(data, w16, h16, colour).map_err(|e| failed(e.to_string()))?;
            }
        }
        Ok(out)
    }

    pub(super) struct Doc {
        /// Null while the document is locked (the empty password was refused).
        doc: Ptr,
        /// Reopened with the password on unlock.
        path: PathBuf,
        temp: bool,
        name: String,
        byte_size: u64,
    }

    impl Drop for Doc {
        fn drop(&mut self) {
            if !self.doc.is_null() {
                if let Ok(lib) = lib() {
                    unsafe { (lib.g_object_unref)(self.doc) };
                }
            }
            if self.temp {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }

    impl Doc {
        pub(super) fn locked(&self) -> bool {
            self.doc.is_null()
        }

        /// Tries `password`; the password is never stored or logged.
        pub(super) fn unlock(&mut self, password: &str) -> bool {
            let Ok(lib) = lib() else { return false };
            match open_file(lib, &self.path, Some(password)) {
                Ok(doc) => {
                    self.doc = doc;
                    true
                }
                Err(_) => false,
            }
        }

        /// Page sizes and counts; an unlocked document only.
        pub(super) fn describe(&self, token: u32) -> Result<PdfInfo> {
            let lib = lib()?;
            let page_count = unsafe { (lib.poppler_document_get_n_pages)(self.doc) }.max(0) as usize;
            if page_count == 0 {
                return Err(err("PDF_INVALID", "The PDF has no pages"));
            }
            let mut pages = Vec::with_capacity(page_count);
            for i in 0..page_count as u32 {
                let (w, h) = self.page_size(i)?;
                // Invalid sizes are reported here as a default and fail on render.
                let valid = w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0;
                pages.push(PdfPageInfo { width_pt: if valid { w } else { 612.0 }, height_pt: if valid { h } else { 792.0 } });
            }
            Ok(PdfInfo { token, name: self.name.clone(), page_count, pages, byte_size: self.byte_size, locked: false })
        }

        /// Owned reference to page `index` (0-based); released by the caller.
        fn page(&self, lib: &Lib, index: u32) -> Result<Ptr> {
            let page = c_int::try_from(index).ok().map(|i| unsafe { (lib.poppler_document_get_page)(self.doc, i) }).unwrap_or(std::ptr::null_mut());
            if page.is_null() {
                return Err(err("PDF_PAGE_FAILED", format!("Page {} not found", index + 1)));
            }
            Ok(page)
        }

        /// Size in points of the crop box (clipped to the media box) after /Rotate: poppler
        /// applies both in `poppler_page_get_size` and `poppler_page_render`.
        fn page_size(&self, index: u32) -> Result<(f64, f64)> {
            let lib = lib()?;
            let page = self.page(lib, index)?;
            let (mut w, mut h) = (0.0f64, 0.0f64);
            unsafe {
                (lib.poppler_page_get_size)(page, &mut w, &mut h);
                (lib.g_object_unref)(page);
            }
            Ok((w, h))
        }

        /// Draws page `index` scaled into a white `w` x `h` bitmap.
        pub(super) fn draw(&self, index: u32, w: usize, h: usize) -> Result<Bitmap> {
            let lib = lib()?;
            let failed = |what: &str| err("PDF_PAGE_FAILED", format!("Could not {what} the page bitmap"));
            let page = self.page(lib, index)?;
            let (mut wp, mut hp) = (0.0f64, 0.0f64);
            unsafe { (lib.poppler_page_get_size)(page, &mut wp, &mut hp) };
            let result = (|| {
                if !(wp > 0.0 && hp > 0.0) {
                    return Err(err("PDF_PAGE_FAILED", "The page has no valid size"));
                }
                let surface = unsafe { (lib.cairo_image_surface_create)(CAIRO_FORMAT_RGB24, w as c_int, h as c_int) };
                let out = (|| {
                    if unsafe { (lib.cairo_surface_status)(surface) } != 0 {
                        return Err(failed("create"));
                    }
                    let cr = unsafe { (lib.cairo_create)(surface) };
                    unsafe {
                        (lib.cairo_set_source_rgb)(cr, 1.0, 1.0, 1.0);
                        (lib.cairo_paint)(cr);
                        (lib.cairo_scale)(cr, w as f64 / wp, h as f64 / hp);
                        (lib.poppler_page_render)(page, cr);
                    }
                    let status = unsafe { (lib.cairo_status)(cr) };
                    unsafe {
                        (lib.cairo_destroy)(cr);
                        (lib.cairo_surface_flush)(surface);
                    }
                    if status != 0 {
                        return Err(failed("draw"));
                    }
                    let data = unsafe { (lib.cairo_image_surface_get_data)(surface) };
                    let stride = unsafe { (lib.cairo_image_surface_get_stride)(surface) };
                    if data.is_null() || stride <= 0 {
                        return Err(failed("read"));
                    }
                    let stride = stride as usize;
                    let bgrx = unsafe { std::slice::from_raw_parts(data, stride * h) }.to_vec();
                    Ok(Bitmap { w, h, stride, bgrx })
                })();
                unsafe { (lib.cairo_surface_destroy)(surface) };
                out
            })();
            unsafe { (lib.g_object_unref)(page) };
            result
        }

        pub(super) fn render(&self, index: u32, max_side: u32, format: Format, quality: f32) -> Result<Vec<u8>> {
            if self.locked() {
                return Err(err("PDF_ENCRYPTED", "This PDF is password protected"));
            }
            let (wp, hp) = self.page_size(index)?;
            let (w, h) = target_size(wp, hp, max_side).ok_or_else(|| err("PDF_PAGE_FAILED", "The page has no valid size"))?;
            // The bitmap is dropped before encoding: one bitmap at a time.
            let (gray, rgb) = {
                let bitmap = self.draw(index, w, h)?;
                match bitmap.gray() {
                    Some(gray) => (Some(gray), None),
                    None => (None, Some(bitmap.rgb())),
                }
            };
            if let Some(gray) = gray {
                let best = encode(&gray, w, h, 1, format, quality)?;
                // Monochrome text/line art is far smaller (and sharper) as a gray PNG than as a JPEG.
                if format == Format::Jpeg {
                    if let Ok(png) = encode(&gray, w, h, 1, Format::Png, 1.0) {
                        if png.len() < best.len() {
                            return Ok(png);
                        }
                    }
                }
                return Ok(best);
            }
            encode(&rgb.expect("colour or gray"), w, h, 3, format, quality)
        }
    }

    enum Req {
        Open { path: PathBuf, name: String, temp: bool, reply: SyncSender<Result<PdfInfo>> },
        Render { token: u32, index: u32, max_side: u32, format: Format, quality: f32, reply: SyncSender<Result<Vec<u8>>> },
        Unlock { token: u32, password: String, reply: SyncSender<Result<PdfInfo>> },
        Close { token: u32, reply: SyncSender<()> },
    }

    fn open_doc(path: &Path, name: String, temp: bool, token: u32) -> Result<(Doc, PdfInfo)> {
        // From here the temp file belongs to `Doc` (or is removed on error by the guard below).
        let result = (|| {
            let byte_size = std::fs::metadata(path).map_err(crate::ioerr)?.len();
            if byte_size > MAX_BYTES_FILE {
                return Err(err("PDF_TOO_LARGE", "The PDF is larger than 512 MiB"));
            }
            let lib = lib()?;
            let doc = match open_file(lib, path, None) {
                Ok(doc) => doc,
                // Kept open and locked: the dialog asks for a password (`pdf_unlock`).
                Err(OpenError::Encrypted) => std::ptr::null_mut(),
                Err(OpenError::Other(_)) => return Err(err("PDF_INVALID", "This is not a readable PDF")),
            };
            let doc = Doc { doc, path: path.to_path_buf(), temp, name, byte_size };
            if doc.locked() {
                let info = PdfInfo { token, name: doc.name.clone(), page_count: 0, pages: vec![], byte_size, locked: true };
                return Ok((doc, info));
            }
            let info = doc.describe(token)?;
            Ok((doc, info))
        })();
        if result.is_err() && temp {
            let _ = std::fs::remove_file(path);
        }
        result
    }

    fn owner_loop(rx: mpsc::Receiver<Req>) {
        let mut docs: HashMap<u32, Doc> = HashMap::new();
        let mut order: VecDeque<u32> = VecDeque::new();
        let mut next_token: u32 = 1;
        while let Ok(req) = rx.recv() {
            match req {
                Req::Open { path, name, temp, reply } => {
                    let token = next_token;
                    let out = open_doc(&path, name, temp, token).map(|(doc, info)| {
                        next_token = next_token.wrapping_add(1).max(1);
                        docs.insert(token, doc);
                        order.push_back(token);
                        while order.len() > MAX_OPEN_DOCS {
                            if let Some(old) = order.pop_front() {
                                docs.remove(&old);
                            }
                        }
                        info
                    });
                    let _ = reply.send(out);
                }
                Req::Render { token, index, max_side, format, quality, reply } => {
                    let out = match docs.get(&token) {
                        None => Err(err("PDF_BAD_TOKEN", "The PDF is no longer open")),
                        Some(doc) => doc.render(index, max_side, format, quality),
                    };
                    let _ = reply.send(out);
                }
                Req::Unlock { token, password, reply } => {
                    let out = match docs.get_mut(&token) {
                        None => Err(err("PDF_BAD_TOKEN", "The PDF is no longer open")),
                        Some(doc) => {
                            if doc.locked() && !doc.unlock(&password) {
                                Err(err("PDF_BAD_PASSWORD", "Wrong password"))
                            } else {
                                doc.describe(token)
                            }
                        }
                    };
                    let _ = reply.send(out);
                }
                Req::Close { token, reply } => {
                    docs.remove(&token);
                    order.retain(|t| *t != token);
                    let _ = reply.send(());
                }
            }
        }
    }

    /// Handle to the owner thread. Dropping every handle stops the thread and deletes temp files.
    pub struct Service {
        tx: Sender<Req>,
        temp_dir: PathBuf,
    }

    fn stopped() -> NativeError {
        err("PDF_PAGE_FAILED", "The PDF worker stopped")
    }

    impl Service {
        pub fn spawn(temp_dir: PathBuf) -> Service {
            let (tx, rx) = mpsc::channel();
            std::thread::Builder::new()
                .name("pdf-import".into())
                .spawn(move || owner_loop(rx))
                .expect("spawn pdf-import thread");
            Service { tx, temp_dir }
        }

        fn ask<T>(&self, make: impl FnOnce(SyncSender<T>) -> Req) -> Result<T> {
            let (reply, rx) = mpsc::sync_channel(1);
            self.tx.send(make(reply)).map_err(|_| stopped())?;
            rx.recv().map_err(|_| stopped())
        }

        pub fn open_path(&self, path: &Path, name: &str) -> Result<PdfInfo> {
            self.ask(|reply| Req::Open { path: path.to_path_buf(), name: name.into(), temp: false, reply })?
        }

        pub fn open_bytes(&self, name: &str, bytes: &[u8]) -> Result<PdfInfo> {
            if bytes.len() > MAX_BYTES_IPC {
                return Err(err("PDF_TOO_LARGE", "Dropped PDFs are limited to 128 MiB"));
            }
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            std::fs::create_dir_all(&self.temp_dir).map_err(crate::ioerr)?;
            let path = self.temp_dir.join(format!("{}.pdf", COUNTER.fetch_add(1, Ordering::Relaxed)));
            write_private(&path, bytes).map_err(|e| {
                let _ = std::fs::remove_file(&path);
                crate::ioerr(e)
            })?;
            // The owner thread now owns the temp file and deletes it on close, eviction or error.
            self.ask(|reply| Req::Open { path, name: name.into(), temp: true, reply })?
        }

        pub fn render(&self, token: u32, index: u32, max_side: u32, format: &str, quality: f32) -> Result<Vec<u8>> {
            let format = match format {
                "jpeg" | "jpg" => Format::Jpeg,
                "png" => Format::Png,
                other => return Err(err("INVALID_ARGUMENT", format!("Unknown image format {other}"))),
            };
            let max_side = max_side.clamp(MIN_SIDE, MAX_SIDE);
            let quality = if quality.is_nan() { 0.85 } else { quality.clamp(0.3, 1.0) };
            self.ask(|reply| Req::Render { token, index, max_side, format, quality, reply })?
        }

        pub fn unlock(&self, token: u32, password: String) -> Result<PdfInfo> {
            self.ask(|reply| Req::Unlock { token, password, reply })?
        }

        pub fn close(&self, token: u32) -> Result<()> {
            self.ask(|reply| Req::Close { token, reply })
        }
    }

    fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
        file.write_all(bytes)
    }

    /// `<tmp>/vaultdraw-pdf-import/<pid>`; stale folders of earlier runs (older than a day) are swept.
    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join("vaultdraw-pdf-import");
        if let Ok(entries) = std::fs::read_dir(&root) {
            let day = std::time::Duration::from_secs(24 * 3600);
            for entry in entries.flatten() {
                let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day);
                if old {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
        root.join(std::process::id().to_string())
    }

    fn service() -> &'static Service {
        static SERVICE: OnceLock<Service> = OnceLock::new();
        SERVICE.get_or_init(|| Service::spawn(temp_root()))
    }

    fn file_name(path: &Path) -> String {
        path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Runs blocking work (channel wait) off the async runtime.
    async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
        tauri::async_runtime::spawn_blocking(f)
            .await
            .map_err(|e| err("PDF_PAGE_FAILED", e.to_string()))?
    }

    pub async fn pick() -> Result<Option<PdfInfo>> {
        #[cfg(feature = "smoke-test")]
        let picked = if crate::smoke::enabled() {
            Some(crate::smoke::pdf_import_path().map_err(|e| err("SMOKE_CONFIG", e))?)
        } else {
            rfd::FileDialog::new().set_title("Import PDF").add_filter("PDF", &["pdf"]).pick_file()
        };
        #[cfg(not(feature = "smoke-test"))]
        let picked = rfd::FileDialog::new().set_title("Import PDF").add_filter("PDF", &["pdf"]).pick_file();
        let Some(path) = picked else { return Ok(None) };
        blocking(move || service().open_path(&path, &file_name(&path)).map(Some)).await
    }

    pub async fn open_bytes(name: String, bytes: Vec<u8>) -> Result<PdfInfo> {
        blocking(move || service().open_bytes(&name, &bytes)).await
    }

    pub async fn render(token: u32, index: u32, max_side: u32, format: String, quality: f32) -> Result<Vec<u8>> {
        blocking(move || service().render(token, index, max_side, &format, quality)).await
    }

    pub async fn unlock(token: u32, password: String) -> Result<PdfInfo> {
        blocking(move || service().unlock(token, password)).await
    }

    pub async fn close(token: u32) -> Result<()> {
        blocking(move || service().close(token)).await
    }

    #[cfg(test)]
    pub(super) fn open_for_test(path: &Path) -> Doc {
        let doc = open_file(lib().unwrap(), path, None).ok().unwrap_or(std::ptr::null_mut());
        Doc { doc, path: path.to_path_buf(), temp: false, name: String::new(), byte_size: 0 }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod native {
    use super::*;

    fn unsupported<T>() -> Result<T> {
        Err(err("PDF_UNAVAILABLE", "PDF import is only available on macOS and Linux"))
    }
    pub async fn pick() -> Result<Option<PdfInfo>> {
        unsupported()
    }
    pub async fn open_bytes(_name: String, _bytes: Vec<u8>) -> Result<PdfInfo> {
        unsupported()
    }
    pub async fn render(_token: u32, _index: u32, _max_side: u32, _format: String, _quality: f32) -> Result<Vec<u8>> {
        unsupported()
    }
    pub async fn unlock(_token: u32, _password: String) -> Result<PdfInfo> {
        unsupported()
    }
    pub async fn close(_token: u32) -> Result<()> {
        unsupported()
    }
}

#[cfg(target_os = "macos")]
use mac as native;

#[cfg(target_os = "linux")]
use linux as native;

#[tauri::command]
pub async fn pdf_pick() -> Result<Option<PdfInfo>> {
    native::pick().await
}

#[tauri::command]
pub async fn pdf_open_bytes(request: tauri::ipc::Request<'_>) -> Result<PdfInfo> {
    let name = crate::clipboard::percent_decode(&crate::clipboard::header(&request, "x-file-name")?)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() => bytes,
        _ => return Err(err("INVALID_ARGUMENT", "Expected a non-empty raw binary body")),
    };
    if bytes.len() > MAX_BYTES_IPC {
        return Err(err("PDF_TOO_LARGE", "Dropped PDFs are limited to 128 MiB"));
    }
    native::open_bytes(name, bytes.clone()).await
}

#[tauri::command]
pub async fn pdf_render_page(token: u32, index: u32, max_side: u32, format: String, quality: f32) -> Result<tauri::ipc::Response> {
    native::render(token, index, max_side, format, quality).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn pdf_unlock(token: u32, password: String) -> Result<PdfInfo> {
    native::unlock(token, password).await
}

#[tauri::command]
pub async fn pdf_close(token: u32) -> Result<()> {
    native::close(token).await
}

/// The plugin gateway's `pdf.*` rows (permission `pdf`, `plugin_call_raw`): the same native calls as
/// the `pdf_*` commands. Bodies: `pdf.pick` empty; `pdf.open` a u32 big-endian name length, the
/// name, then the PDF bytes; `pdf.render`, `pdf.unlock`, `pdf.close` a JSON object. Replies: the
/// document info as JSON (`null` when the pick is cancelled), image bytes for `pdf.render`, empty
/// for `pdf.close`. Runs on a blocking thread, so it waits on the async natives.
pub(crate) fn gateway_call(method: &str, body: &[u8]) -> Result<Vec<u8>> {
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RenderArgs {
        token: u32,
        index: u32,
        max_side: u32,
        format: String,
        quality: f32,
    }
    #[derive(Deserialize)]
    struct UnlockArgs {
        token: u32,
        password: String,
    }
    #[derive(Deserialize)]
    struct CloseArgs {
        token: u32,
    }
    fn args<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T> {
        serde_json::from_slice(body).map_err(|e| err("INVALID_ARGUMENT", e.to_string()))
    }
    fn json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
        serde_json::to_vec(value).map_err(|e| err("INTERNAL", e.to_string()))
    }
    use tauri::async_runtime::block_on;
    match method {
        "pdf.pick" => json(&block_on(native::pick())?),
        "pdf.open" => {
            let bad = || err("INVALID_ARGUMENT", "Expected a name length, the name and the PDF bytes");
            let len = body.get(..4).ok_or_else(bad)?;
            let len = u32::from_be_bytes([len[0], len[1], len[2], len[3]]) as usize;
            let name = body.get(4..4 + len).ok_or_else(bad)?;
            let bytes = &body[4 + len..];
            if bytes.is_empty() {
                return Err(bad());
            }
            if bytes.len() > MAX_BYTES_IPC {
                return Err(err("PDF_TOO_LARGE", "Dropped PDFs are limited to 128 MiB"));
            }
            json(&block_on(native::open_bytes(String::from_utf8_lossy(name).into_owned(), bytes.to_vec()))?)
        }
        "pdf.render" => {
            let a: RenderArgs = args(body)?;
            block_on(native::render(a.token, a.index, a.max_side, a.format, a.quality))
        }
        "pdf.unlock" => {
            let a: UnlockArgs = args(body)?;
            json(&block_on(native::unlock(a.token, a.password))?)
        }
        "pdf.close" => {
            let a: CloseArgs = args(body)?;
            block_on(native::close(a.token))?;
            Ok(Vec::new())
        }
        _ => Err(err("NOT_FOUND", format!("Plugins cannot call \"{method}\""))),
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::mac::fixtures::*;
    use super::mac::*;
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    fn code<T: std::fmt::Debug>(r: Result<T>) -> String {
        r.expect_err("expected an error").code
    }

    fn svc(dir: &Path) -> Service {
        Service::spawn(dir.join("tmp"))
    }

    const A4: (f64, f64) = (595.0, 842.0);
    const LAND: (f64, f64) = (842.0, 595.0);
    const LETTER: (f64, f64) = (612.0, 792.0);

    #[test]
    fn pure_math() {
        assert_eq!(display_size(100.0, 200.0, 90), (200.0, 100.0));
        assert_eq!(display_size(100.0, 200.0, 270), (200.0, 100.0));
        assert_eq!(display_size(100.0, 200.0, 180), (100.0, 200.0));
        assert_eq!(display_size(100.0, 200.0, -90), (200.0, 100.0));
        assert_eq!(target_size(595.0, 842.0, 1440), Some((1018, 1440)));
        assert_eq!(target_size(842.0, 595.0, 1440), Some((1440, 1018)));
        assert_eq!(target_size(1.0, 10000.0, 1440), Some((1, 1440)));
        assert_eq!(target_size(0.0, 10.0, 1440), None);
        assert_eq!(target_size(f64::NAN, 10.0, 1440), None);
        let (w, h) = target_size(100.0, 100.0, 8192).unwrap();
        assert!(w * h <= 16_000_000);
        assert_eq!(intersect((0.0, 0.0, 10.0, 10.0), (5.0, 5.0, 10.0, 10.0)), Some((5.0, 5.0, 5.0, 5.0)));
        assert_eq!(intersect((0.0, 0.0, 10.0, 10.0), (20.0, 0.0, 5.0, 5.0)), None);
        // 200x100 page, 90 clockwise: lower-left (0,0) lands at the top-left (0, h) of a 100x200 bitmap.
        let m = page_transform((0.0, 0.0, 200.0, 100.0), 90, 100.0, 200.0);
        let map = |x: f64, y: f64| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        assert_eq!(map(0.0, 0.0), (0.0, 200.0));
        assert_eq!(map(200.0, 100.0), (100.0, 0.0));
        let m = page_transform((10.0, 20.0, 200.0, 100.0), 270, 100.0, 200.0);
        let map = |x: f64, y: f64| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        assert_eq!(map(10.0, 20.0), (100.0, 0.0));
        assert_eq!(map(210.0, 120.0), (0.0, 200.0));
    }

    #[test]
    fn info_sizes_and_render_formats() {
        let dir = tempdir().unwrap();
        let pdf = dir.path().join("mixed.pdf");
        make_pdf(&pdf, &[A4, LAND, LETTER], 3);
        let s = svc(dir.path());
        let info = s.open_path(&pdf, "mixed.pdf").unwrap();
        assert_eq!((info.page_count, info.name.as_str()), (3, "mixed.pdf"));
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 595.0, height_pt: 842.0 });
        assert_eq!(info.pages[1], PdfPageInfo { width_pt: 842.0, height_pt: 595.0 });
        assert!(info.byte_size > 100);
        let json = serde_json::to_value(&info).unwrap();
        assert!(json["pageCount"] == 3 && json["pages"][0]["widthPt"] == 595.0 && json["byteSize"].is_number());

        let jpeg = s.render(info.token, 0, 800, "jpeg", 0.85).unwrap();
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        let png = s.render(info.token, 1, 600, "png", 1.0).unwrap();
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        // PNG IHDR holds the pixel size: long side == max_side, landscape keeps aspect.
        let (w, h) = (u32::from_be_bytes(png[16..20].try_into().unwrap()), u32::from_be_bytes(png[20..24].try_into().unwrap()));
        assert_eq!((w, h), (600, 424));
        // Out-of-range max_side/quality are clamped, not rejected.
        assert!(s.render(info.token, 2, 1, "jpeg", 9.0).is_ok());
        assert_eq!(code(s.render(info.token, 3, 800, "jpeg", 0.8)), "PDF_PAGE_FAILED");
        assert_eq!(code(s.render(info.token, 0, 800, "gif", 0.8)), "INVALID_ARGUMENT");
    }

    #[test]
    fn orientation_red_square_is_top_left() {
        let dir = tempdir().unwrap();
        let pdf = dir.path().join("p.pdf");
        make_pdf(&pdf, &[A4], 0);
        let s = svc(dir.path());
        s.open_path(&pdf, "p.pdf").unwrap();
        // Drive the Doc directly on this thread (no Send needed).
        let url = objc2_core_foundation::CFURL::from_file_path(&pdf).unwrap();
        let doc = objc2_core_graphics::CGPDFDocument::with_url(Some(&url)).unwrap();
        let doc = Doc::for_test(doc);
        let (w, h) = (298, 421);
        assert_eq!(pixel(&doc, 0, w, h, 5, 5), [255, 0, 0]);
        assert_eq!(pixel(&doc, 0, w, h, w - 5, h - 5), [255, 255, 255]);
        assert_eq!(pixel(&doc, 0, w, h, w - 5, 5), [255, 255, 255]);
    }

    #[test]
    fn rotate_and_cropbox_are_honoured() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let rotated = dir.path().join("rot.pdf");
        std::fs::write(&rotated, raw_pdf("[0 0 200 100]", "/Rotate 90")).unwrap();
        let info = s.open_path(&rotated, "rot.pdf").unwrap();
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 100.0, height_pt: 200.0 });
        let url = objc2_core_foundation::CFURL::from_file_path(&rotated).unwrap();
        let doc = Doc::for_test(objc2_core_graphics::CGPDFDocument::with_url(Some(&url)).unwrap());
        // Lower-left square turns into the top-left one under a 90 degree clockwise rotation.
        assert_eq!(pixel(&doc, 0, 100, 200, 10, 10), [255, 0, 0]);
        assert_eq!(pixel(&doc, 0, 100, 200, 90, 190), [255, 255, 255]);

        let cropped = dir.path().join("crop.pdf");
        std::fs::write(&cropped, raw_pdf("[0 0 200 200]", "/CropBox [50 50 150 150]")).unwrap();
        let info = s.open_path(&cropped, "crop.pdf").unwrap();
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 100.0, height_pt: 100.0 });
        // CropBox beyond the MediaBox is intersected with it.
        let wide = dir.path().join("wide.pdf");
        std::fs::write(&wide, raw_pdf("[0 0 200 200]", "/CropBox [100 100 400 400]")).unwrap();
        let info = s.open_path(&wide, "wide.pdf").unwrap();
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 100.0, height_pt: 100.0 });
    }

    #[test]
    fn invalid_files_and_tokens() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let bad = dir.path().join("bad.pdf");
        std::fs::write(&bad, b"this is not a pdf").unwrap();
        assert_eq!(code(s.open_path(&bad, "bad.pdf")), "PDF_INVALID");
        assert_eq!(code(s.open_path(&dir.path().join("missing.pdf"), "m")), "NOT_FOUND");
        assert_eq!(code(s.render(42, 0, 800, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        s.close(42).unwrap();
        assert_eq!(code(s.open_bytes("x.pdf", b"garbage")), "PDF_INVALID");
        // A failed open from bytes leaves no temp file behind.
        let left = std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0);
        assert_eq!(left, 0);
    }

    #[test]
    fn eviction_close_and_temp_files() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let bytes = raw_pdf("[0 0 200 100]", "");
        let temp_count = || std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0);
        let infos: Vec<_> = (0..5).map(|i| s.open_bytes(&format!("d{i}.pdf"), &bytes).unwrap()).collect();
        // The 5th open evicted the 1st (max 4 open) and deleted its temp file.
        assert_eq!(code(s.render(infos[0].token, 0, 200, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        assert!(s.render(infos[1].token, 0, 200, "jpeg", 0.8).is_ok());
        assert_eq!(temp_count(), 4);
        s.close(infos[4].token).unwrap();
        assert_eq!(temp_count(), 3);
        assert_eq!(code(s.render(infos[4].token, 0, 200, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        // Tokens never repeat.
        let tokens: std::collections::HashSet<_> = infos.iter().map(|i| i.token).collect();
        assert_eq!(tokens.len(), 5);
        drop(s);
        // Dropping the service stops the thread, which deletes the rest.
        for _ in 0..50 {
            if temp_count() == 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("temp files were not removed");
    }

    #[test]
    fn dropped_pdf_over_the_cap_is_rejected() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let big = vec![0u8; 128 * 1024 * 1024 + 1];
        assert_eq!(code(s.open_bytes("big.pdf", &big)), "PDF_TOO_LARGE");
    }

    #[test]
    fn neutral_detection() {
        // 3x2 pixels, stride 16 (4 bytes of row padding).
        let mut buf = vec![255u8; 16 * 2];
        assert!(is_neutral_rgbx(&buf, 3, 2, 16, 2));
        buf[16 + 4] = 250; // r of pixel (1, 1) differs by 5 from g
        assert!(!is_neutral_rgbx(&buf, 3, 2, 16, 2));
        assert!(is_neutral_rgbx(&buf, 3, 2, 16, 5));
        // padding bytes are not read as pixels
        let mut pad = vec![255u8; 16 * 2];
        pad[12] = 0;
        assert!(is_neutral_rgbx(&pad, 3, 2, 16, 2));
    }

    /// Component count of a baseline JPEG (SOF0/SOF2 marker).
    fn jpeg_components(j: &[u8]) -> u8 {
        let mut i = 2;
        while i + 9 < j.len() {
            assert_eq!(j[i], 0xFF);
            let marker = j[i + 1];
            if marker == 0xC0 || marker == 0xC2 {
                return j[i + 9];
            }
            i += 2 + usize::from(u16::from_be_bytes([j[i + 2], j[i + 3]]));
        }
        panic!("no SOF marker");
    }

    #[test]
    fn monochrome_pages_encode_as_gray_and_colour_pages_stay_rgb() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let mono = dir.path().join("mono.pdf");
        // text only: no red square (make_pdf always draws one), so build from raw content
        std::fs::write(&mono, raw_pdf_with("0 g 20 20 100 40 re f 0.5 g 20 80 100 10 re f")).unwrap();
        let info = s.open_path(&mono, "mono.pdf").unwrap();
        let gray = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        // A JPEG request returns whichever gray encoding is smaller (a PNG for line art).
        if gray[0] == 0xFF {
            assert_eq!(jpeg_components(&gray), 1);
        } else {
            assert_eq!(gray[25], 0, "gray PNG");
        }
        let png = s.render(info.token, 0, 400, "png", 1.0).unwrap();
        assert_eq!(png[25], 0, "PNG colour type 0 = grayscale");
        let colour = dir.path().join("colour.pdf");
        std::fs::write(&colour, raw_pdf("[0 0 200 100]", "")).unwrap();
        let info = s.open_path(&colour, "colour.pdf").unwrap();
        let rgb = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        assert_eq!(jpeg_components(&rgb), 3);
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        fn CGImageSourceCreateWithData(data: *const std::ffi::c_void, options: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGImageSourceCreateImageAtIndex(src: *mut std::ffi::c_void, index: usize, options: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    /// Decodes with ImageIO (the decoder WebKit uses) into sRGB and returns pixel (x, y).
    fn decode_pixel(bytes: &[u8], x: usize, y: usize) -> [u8; 3] {
        use objc2_core_foundation::{CFData, CFRetained, CGPoint, CGRect, CGSize};
        use objc2_core_graphics::{CGBitmapContextCreate, CGBitmapContextGetBytesPerRow, CGBitmapContextGetData, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo};
        use std::ptr::NonNull;
        let data = CFData::from_bytes(bytes);
        let image = unsafe {
            let src = CGImageSourceCreateWithData((&*data as *const CFData).cast(), std::ptr::null());
            assert!(!src.is_null(), "ImageIO could not open the image");
            let raw = CGImageSourceCreateImageAtIndex(src, 0, std::ptr::null());
            assert!(!raw.is_null(), "ImageIO could not decode the image");
            CFRetained::from_raw(NonNull::new(raw.cast::<CGImage>()).unwrap())
        };
        let (w, h) = (CGImage::width(Some(&image)), CGImage::height(Some(&image)));
        let space = CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB })).unwrap();
        let ctx = unsafe { CGBitmapContextCreate(std::ptr::null_mut(), w, h, 8, 0, Some(&space), CGImageAlphaInfo::NoneSkipLast.0) }.unwrap();
        CGContext::draw_image(Some(&ctx), CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64)), Some(&image));
        let base = CGBitmapContextGetData(Some(&ctx)) as *const u8;
        let stride = CGBitmapContextGetBytesPerRow(Some(&ctx));
        unsafe {
            let p = base.add(y * stride + x * 4);
            [*p, *p.add(1), *p.add(2)]
        }
    }

    #[test]
    fn gray_output_decodes_with_correct_tones() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        // 200x100 page: black block at the bottom-left, mid-gray strip above, white elsewhere.
        let pdf = dir.path().join("tones.pdf");
        std::fs::write(&pdf, raw_pdf_with("0 g 0 0 100 50 re f 0.5 g 100 50 100 50 re f")).unwrap();
        let info = s.open_path(&pdf, "tones.pdf").unwrap();
        // bitmap is 400x200 (row 0 = top); black block covers x<200, y>=100.
        for format in ["jpeg", "png"] {
            let bytes = s.render(info.token, 0, 400, format, 0.95).unwrap();
            let near = |p: [u8; 3], v: i32| p.iter().all(|c| (i32::from(*c) - v).abs() <= 6) ;
            assert!(near(decode_pixel(&bytes, 100, 150), 0), "{format}: black stays black");
            assert!(near(decode_pixel(&bytes, 300, 50), 128), "{format}: mid gray stays mid gray (got {:?})", decode_pixel(&bytes, 300, 50));
            assert!(near(decode_pixel(&bytes, 350, 150), 255), "{format}: white stays white");
        }
        // The text-like page is smallest as the gray PNG: the JPEG request returns a PNG here.
        let png = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn password_flow_and_restricted_pdfs() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let locked = dir.path().join("locked.pdf");
        make_encrypted_pdf(&locked, "secret", "owner", true);
        let info = s.open_path(&locked, "locked.pdf").unwrap();
        assert!(info.locked && info.page_count == 0 && info.pages.is_empty());
        assert!(serde_json::to_value(&info).unwrap()["locked"] == true);
        assert_eq!(code(s.render(info.token, 0, 200, "jpeg", 0.8)), "PDF_ENCRYPTED");
        assert_eq!(code(s.unlock(info.token, "nope".into())), "PDF_BAD_PASSWORD");
        assert_eq!(code(s.unlock(info.token, "bad\0nul".into())), "PDF_BAD_PASSWORD");
        let open = s.unlock(info.token, "secret".into()).unwrap();
        assert!(!open.locked && open.page_count == 1 && open.token == info.token);
        assert_eq!(&s.render(info.token, 0, 200, "jpeg", 0.8).unwrap()[..3], &[0xFF, 0xD8, 0xFF]);
        // Unlocking twice is harmless; the owner password also opens it.
        assert!(s.unlock(info.token, "".into()).is_ok());
        assert_eq!(code(s.unlock(999, "x".into())), "PDF_BAD_TOKEN");
        // Copy-protected with an empty user password: opens without a prompt and renders.
        let restricted = dir.path().join("restricted.pdf");
        make_encrypted_pdf(&restricted, "", "owner", false);
        let info = s.open_path(&restricted, "restricted.pdf").unwrap();
        assert!(!info.locked && info.page_count == 1);
        assert!(s.render(info.token, 0, 200, "png", 1.0).is_ok());
        // A locked drop from bytes keeps (and later removes) its temp file.
        let bytes = std::fs::read(&locked).unwrap();
        let info = s.open_bytes("l.pdf", &bytes).unwrap();
        assert!(info.locked);
        s.close(info.token).unwrap();
        assert_eq!(std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0), 0);
    }

    /// Peak resident set size of this process in MiB (macOS `ru_maxrss` is in bytes).
    fn peak_rss_mib() -> f64 {
        // struct rusage: two timevals (4 x i64) then 14 longs; ru_maxrss is the first long.
        extern "C" {
            fn getrusage(who: i32, usage: *mut [i64; 18]) -> i32;
        }
        let mut u = [0i64; 18];
        assert_eq!(unsafe { getrusage(0, &mut u) }, 0);
        u[4] as f64 / 1_048_576.0
    }

    /// Size of a dense text page (A4, 1440 px, JPEG 0.85) as gray vs forced colour.
    #[test]
    #[ignore]
    fn bench_gray_vs_colour_size() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let text: String = (0..70).map(|i| format!("BT /F1 9 Tf 50 {} Td (Line {i}: the quick brown fox jumps over the lazy dog 0123456789) Tj ET\n", 780 - 11 * i)).collect();
        let big = |content: &str| raw_pdf_with(content).iter().copied().collect::<Vec<u8>>();
        let mut gray = String::from(&text);
        let mut colour = String::from("1 0 0 rg 0 0 1 1 re f 0 g\n");
        colour.push_str(&text);
        gray.insert_str(0, "0 g\n");
        let sizes: Vec<usize> = [gray, colour]
            .iter()
            .enumerate()
            .map(|(n, c)| {
                let path = dir.path().join(format!("t{n}.pdf"));
                let mut bytes = big(c);
                // A4 media box instead of 200x100.
                let find = b"[0 0 200 100]";
                let at = bytes.windows(find.len()).position(|w| w == find).unwrap();
                bytes.splice(at..at + find.len(), b"[0 0 595 842]".iter().copied());
                // offsets shift the xref; CoreGraphics rebuilds a broken xref.
                std::fs::write(&path, bytes).unwrap();
                let info = s.open_path(&path, "t.pdf").unwrap();
                { let png = s.render(info.token, 0, 1440, "png", 1.0).unwrap().len(); println!("png {n}: {png}"); let t = std::time::Instant::now(); let n_bytes = s.render(info.token, 0, 1440, "jpeg", 0.85).unwrap().len(); println!("jpeg request {n}: {n_bytes} bytes in {:.1} ms", t.elapsed().as_secs_f64() * 1000.0); n_bytes }
            })
            .collect();
        println!("BENCH text page 1440 jpeg 0.85: gray {} bytes, colour {} bytes ({:.0}%)", sizes[0], sizes[1], 100.0 * sizes[0] as f64 / sizes[1] as f64);
    }

    #[test]
    #[ignore]
    fn bench_100_pages() {
        let dir = tempdir().unwrap();
        let pdf = dir.path().join("book.pdf");
        make_pdf(&pdf, &vec![A4; 100], 70);
        let s = svc(dir.path());
        let info = s.open_path(&pdf, "book.pdf").unwrap();
        let rss_before = peak_rss_mib();
        let total = std::time::Instant::now();
        let mut times = vec![];
        let mut sizes = vec![];
        for i in 0..100 {
            let t = std::time::Instant::now();
            let bytes = s.render(info.token, i, 1440, "jpeg", 0.85).unwrap();
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            sizes.push(bytes.len());
        }
        let total_ms = total.elapsed().as_secs_f64() * 1000.0;
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        sizes.sort();
        println!(
            "BENCH 100 pages @1440 jpeg 0.85: p50 {:.1} ms, p95 {:.1} ms, total {:.0} ms, bytes/page p50 {}, peak RSS {:.1} MiB (before {:.1})",
            times[49], times[94], total_ms, sizes[49], peak_rss_mib(), rss_before
        );
    }
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    //! The macOS tests, with handwritten PDFs instead of CoreGraphics-made ones. The encrypted
    //! fixtures were made once with `qpdf --encrypt` (see `fixtures/pdf/README`).
    use super::linux::*;
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    /// A `user` password of "secret", owner "owner" (unlock prompt).
    const LOCKED_PDF: &[u8] = include_bytes!("fixtures/pdf/locked.pdf");
    /// Empty user password, owner "owner", copying not allowed (no prompt).
    const RESTRICTED_PDF: &[u8] = include_bytes!("fixtures/pdf/restricted.pdf");

    fn code<T: std::fmt::Debug>(r: Result<T>) -> String {
        r.expect_err("expected an error").code
    }

    fn svc(dir: &Path) -> Service {
        Service::spawn(dir.join("tmp"))
    }

    /// Handwritten PDF: one page per (w, h) with a red 50x50 square at the lower-left corner.
    fn raw_pdf_pages(sizes: &[(f64, f64)], extra: &str) -> Vec<u8> {
        let content = "1 0 0 rg 0 0 50 50 re f";
        let mut objs = vec!["<< /Type /Catalog /Pages 2 0 R >>".to_string()];
        let kids: Vec<String> = (0..sizes.len()).map(|i| format!("{} 0 R", 3 + 2 * i)).collect();
        objs.push(format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), sizes.len()));
        for (i, (w, h)) in sizes.iter().enumerate() {
            objs.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] {extra} /Contents {} 0 R >>", 4 + 2 * i));
            objs.push(format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()));
        }
        assemble(&objs)
    }

    /// One 200x100 page with a red square at the lower-left; `media` and `extra` go in the page dict.
    fn raw_pdf(media: &str, extra: &str) -> Vec<u8> {
        let content = "1 0 0 rg 0 0 50 50 re f";
        assemble(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox {media} {extra} /Contents 4 0 R >>"),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        ])
    }

    /// Like `raw_pdf` with custom page content (no colour unless the content sets it).
    fn raw_pdf_with(content: &str) -> Vec<u8> {
        assemble(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_string(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ])
    }

    fn assemble(objs: &[String]) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![];
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        let xref = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
        for off in offsets {
            out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
        out
    }

    /// RGB at (x, y) of the page drawn at `w` x `h` (row 0 = top).
    fn pixel(doc: &Doc, index: u32, w: usize, h: usize, x: usize, y: usize) -> [u8; 3] {
        doc.draw(index, w, h).unwrap().pixel(x, y)
    }

    const A4: (f64, f64) = (595.0, 842.0);
    const LAND: (f64, f64) = (842.0, 595.0);
    const LETTER: (f64, f64) = (612.0, 792.0);

    #[test]
    fn pure_math() {
        assert_eq!(display_size(100.0, 200.0, 90), (200.0, 100.0));
        assert_eq!(display_size(100.0, 200.0, -90), (200.0, 100.0));
        assert_eq!(target_size(595.0, 842.0, 1440), Some((1018, 1440)));
        assert_eq!(target_size(842.0, 595.0, 1440), Some((1440, 1018)));
        assert_eq!(target_size(1.0, 10000.0, 1440), Some((1, 1440)));
        assert_eq!(target_size(0.0, 10.0, 1440), None);
        assert_eq!(target_size(f64::NAN, 10.0, 1440), None);
        let (w, h) = target_size(100.0, 100.0, 8192).unwrap();
        assert!(w * h <= 16_000_000);
        assert_eq!(intersect((0.0, 0.0, 10.0, 10.0), (5.0, 5.0, 10.0, 10.0)), Some((5.0, 5.0, 5.0, 5.0)));
        let m = page_transform((0.0, 0.0, 200.0, 100.0), 90, 100.0, 200.0);
        let map = |x: f64, y: f64| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        assert_eq!(map(0.0, 0.0), (0.0, 200.0));
    }

    #[test]
    fn info_sizes_and_render_formats() {
        let dir = tempdir().unwrap();
        let pdf = dir.path().join("mixed.pdf");
        std::fs::write(&pdf, raw_pdf_pages(&[A4, LAND, LETTER], "")).unwrap();
        let s = svc(dir.path());
        let info = s.open_path(&pdf, "mixed.pdf").unwrap();
        assert_eq!((info.page_count, info.name.as_str()), (3, "mixed.pdf"));
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 595.0, height_pt: 842.0 });
        assert_eq!(info.pages[1], PdfPageInfo { width_pt: 842.0, height_pt: 595.0 });
        assert!(info.byte_size > 100);
        let json = serde_json::to_value(&info).unwrap();
        assert!(json["pageCount"] == 3 && json["pages"][0]["widthPt"] == 595.0 && json["byteSize"].is_number());

        let jpeg = s.render(info.token, 0, 800, "jpeg", 0.85).unwrap();
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        let png = s.render(info.token, 1, 600, "png", 1.0).unwrap();
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        // PNG IHDR holds the pixel size: long side == max_side, landscape keeps aspect.
        let (w, h) = (u32::from_be_bytes(png[16..20].try_into().unwrap()), u32::from_be_bytes(png[20..24].try_into().unwrap()));
        assert_eq!((w, h), (600, 424));
        // Out-of-range max_side/quality are clamped, not rejected.
        assert!(s.render(info.token, 2, 1, "jpeg", 9.0).is_ok());
        assert_eq!(code(s.render(info.token, 3, 800, "jpeg", 0.8)), "PDF_PAGE_FAILED");
        assert_eq!(code(s.render(info.token, 0, 800, "gif", 0.8)), "INVALID_ARGUMENT");
    }

    #[test]
    fn orientation_red_square_is_bottom_left() {
        let dir = tempdir().unwrap();
        let pdf = dir.path().join("p.pdf");
        std::fs::write(&pdf, raw_pdf_pages(&[A4], "")).unwrap();
        let doc = open_for_test(&pdf);
        let (w, h) = (298, 421);
        // PDF origin is the lower-left corner; row 0 of the bitmap is the top.
        assert_eq!(pixel(&doc, 0, w, h, 5, h - 5), [255, 0, 0]);
        assert_eq!(pixel(&doc, 0, w, h, 5, 5), [255, 255, 255]);
        assert_eq!(pixel(&doc, 0, w, h, w - 5, h - 5), [255, 255, 255]);
    }

    #[test]
    fn rotate_and_cropbox_are_honoured() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let rotated = dir.path().join("rot.pdf");
        std::fs::write(&rotated, raw_pdf("[0 0 200 100]", "/Rotate 90")).unwrap();
        let info = s.open_path(&rotated, "rot.pdf").unwrap();
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 100.0, height_pt: 200.0 });
        let doc = open_for_test(&rotated);
        // Lower-left square turns into the top-left one under a 90 degree clockwise rotation.
        assert_eq!(pixel(&doc, 0, 100, 200, 10, 10), [255, 0, 0]);
        assert_eq!(pixel(&doc, 0, 100, 200, 90, 190), [255, 255, 255]);

        let cropped = dir.path().join("crop.pdf");
        std::fs::write(&cropped, raw_pdf("[0 0 200 200]", "/CropBox [50 50 150 150]")).unwrap();
        let info = s.open_path(&cropped, "crop.pdf").unwrap();
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 100.0, height_pt: 100.0 });
        // The square (0..50) lies outside the crop box: all white.
        let doc = open_for_test(&cropped);
        assert_eq!(pixel(&doc, 0, 100, 100, 5, 95), [255, 255, 255]);
        // CropBox beyond the MediaBox is intersected with it.
        let wide = dir.path().join("wide.pdf");
        std::fs::write(&wide, raw_pdf("[0 0 200 200]", "/CropBox [100 100 400 400]")).unwrap();
        let info = s.open_path(&wide, "wide.pdf").unwrap();
        // macOS (CoreGraphics) intersects the two boxes (100x100); poppler ignores a crop box that
        // leaves the media box and shows the whole page (200x200). Either is a usable import.
        assert_eq!(info.pages[0], PdfPageInfo { width_pt: 200.0, height_pt: 200.0 });
    }

    #[test]
    fn invalid_files_and_tokens() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let bad = dir.path().join("bad.pdf");
        std::fs::write(&bad, b"this is not a pdf").unwrap();
        assert_eq!(code(s.open_path(&bad, "bad.pdf")), "PDF_INVALID");
        assert_eq!(code(s.open_path(&dir.path().join("missing.pdf"), "m")), "NOT_FOUND");
        assert_eq!(code(s.render(42, 0, 800, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        s.close(42).unwrap();
        assert_eq!(code(s.open_bytes("x.pdf", b"garbage")), "PDF_INVALID");
        // A failed open from bytes leaves no temp file behind.
        let left = std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0);
        assert_eq!(left, 0);
    }

    #[test]
    fn eviction_close_and_temp_files() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let bytes = raw_pdf("[0 0 200 100]", "");
        let temp_count = || std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0);
        let infos: Vec<_> = (0..5).map(|i| s.open_bytes(&format!("d{i}.pdf"), &bytes).unwrap()).collect();
        // The 5th open evicted the 1st (max 4 open) and deleted its temp file.
        assert_eq!(code(s.render(infos[0].token, 0, 200, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        assert!(s.render(infos[1].token, 0, 200, "jpeg", 0.8).is_ok());
        assert_eq!(temp_count(), 4);
        s.close(infos[4].token).unwrap();
        assert_eq!(temp_count(), 3);
        assert_eq!(code(s.render(infos[4].token, 0, 200, "jpeg", 0.8)), "PDF_BAD_TOKEN");
        // Tokens never repeat.
        let tokens: std::collections::HashSet<_> = infos.iter().map(|i| i.token).collect();
        assert_eq!(tokens.len(), 5);
        drop(s);
        // Dropping the service stops the thread, which deletes the rest.
        for _ in 0..50 {
            if temp_count() == 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("temp files were not removed");
    }

    #[test]
    fn dropped_pdf_over_the_cap_is_rejected() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let big = vec![0u8; 128 * 1024 * 1024 + 1];
        assert_eq!(code(s.open_bytes("big.pdf", &big)), "PDF_TOO_LARGE");
    }

    #[test]
    fn neutral_detection() {
        // 3x2 pixels, stride 16 (4 bytes of row padding).
        let mut buf = vec![255u8; 16 * 2];
        assert!(is_neutral_rgbx(&buf, 3, 2, 16, 2));
        buf[16 + 4] = 250;
        assert!(!is_neutral_rgbx(&buf, 3, 2, 16, 2));
        assert!(is_neutral_rgbx(&buf, 3, 2, 16, 5));
        let mut pad = vec![255u8; 16 * 2];
        pad[12] = 0;
        assert!(is_neutral_rgbx(&pad, 3, 2, 16, 2));
    }

    /// Component count of a baseline JPEG (SOF0/SOF2 marker).
    fn jpeg_components(j: &[u8]) -> u8 {
        let mut i = 2;
        while i + 9 < j.len() {
            assert_eq!(j[i], 0xFF);
            let marker = j[i + 1];
            if marker == 0xC0 || marker == 0xC2 {
                return j[i + 9];
            }
            i += 2 + usize::from(u16::from_be_bytes([j[i + 2], j[i + 3]]));
        }
        panic!("no SOF marker");
    }

    #[test]
    fn monochrome_pages_encode_as_gray_and_colour_pages_stay_rgb() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let mono = dir.path().join("mono.pdf");
        std::fs::write(&mono, raw_pdf_with("0 g 20 20 100 40 re f 0.5 g 20 80 100 10 re f")).unwrap();
        let info = s.open_path(&mono, "mono.pdf").unwrap();
        let gray = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        // A JPEG request returns whichever gray encoding is smaller (a PNG for line art).
        if gray[0] == 0xFF {
            assert_eq!(jpeg_components(&gray), 1);
        } else {
            assert_eq!(gray[25], 0, "gray PNG");
        }
        let png = s.render(info.token, 0, 400, "png", 1.0).unwrap();
        assert_eq!(png[25], 0, "PNG colour type 0 = grayscale");
        let colour = dir.path().join("colour.pdf");
        std::fs::write(&colour, raw_pdf("[0 0 200 100]", "")).unwrap();
        let info = s.open_path(&colour, "colour.pdf").unwrap();
        let rgb = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        assert_eq!(jpeg_components(&rgb), 3);
        let rgb_png = s.render(info.token, 0, 400, "png", 1.0).unwrap();
        assert_eq!(rgb_png[25], 2, "PNG colour type 2 = RGB");
    }

    /// Decodes a PNG and returns the gray value of pixel (x, y) (grayscale output only).
    fn decode_gray_png(bytes: &[u8], x: usize, y: usize) -> u8 {
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut buf).unwrap();
        assert_eq!(info.color_type, png::ColorType::Grayscale);
        buf[y * info.line_size + x]
    }

    #[test]
    fn gray_output_decodes_with_correct_tones() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        // 200x100 page: black block at the bottom-left, mid-gray strip at the top-right.
        let pdf = dir.path().join("tones.pdf");
        std::fs::write(&pdf, raw_pdf_with("0 g 0 0 100 50 re f 0.5 g 100 50 100 50 re f")).unwrap();
        let info = s.open_path(&pdf, "tones.pdf").unwrap();
        // bitmap is 400x200 (row 0 = top); black block covers x<200, y>=100.
        let bytes = s.render(info.token, 0, 400, "png", 1.0).unwrap();
        let near = |v: u8, want: i32| (i32::from(v) - want).abs() <= 6;
        assert!(near(decode_gray_png(&bytes, 100, 150), 0), "black stays black");
        assert!(near(decode_gray_png(&bytes, 300, 50), 128), "mid gray stays mid gray");
        assert!(near(decode_gray_png(&bytes, 350, 150), 255), "white stays white");
        // The line-art page is smallest as the gray PNG: the JPEG request returns a PNG here.
        let png = s.render(info.token, 0, 400, "jpeg", 0.85).unwrap();
        assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn password_flow_and_restricted_pdfs() {
        let dir = tempdir().unwrap();
        let s = svc(dir.path());
        let locked = dir.path().join("locked.pdf");
        std::fs::write(&locked, LOCKED_PDF).unwrap();
        let info = s.open_path(&locked, "locked.pdf").unwrap();
        assert!(info.locked && info.page_count == 0 && info.pages.is_empty());
        assert!(serde_json::to_value(&info).unwrap()["locked"] == true);
        assert_eq!(code(s.render(info.token, 0, 200, "jpeg", 0.8)), "PDF_ENCRYPTED");
        assert_eq!(code(s.unlock(info.token, "nope".into())), "PDF_BAD_PASSWORD");
        assert_eq!(code(s.unlock(info.token, "bad\0nul".into())), "PDF_BAD_PASSWORD");
        let open = s.unlock(info.token, "secret".into()).unwrap();
        assert!(!open.locked && open.page_count == 1 && open.token == info.token);
        assert_eq!(&s.render(info.token, 0, 200, "jpeg", 0.8).unwrap()[..3], &[0xFF, 0xD8, 0xFF]);
        // Unlocking twice is harmless.
        assert!(s.unlock(info.token, "".into()).is_ok());
        assert_eq!(code(s.unlock(999, "x".into())), "PDF_BAD_TOKEN");
        // Copy-protected with an empty user password: opens without a prompt and renders.
        let restricted = dir.path().join("restricted.pdf");
        std::fs::write(&restricted, RESTRICTED_PDF).unwrap();
        let info = s.open_path(&restricted, "restricted.pdf").unwrap();
        assert!(!info.locked && info.page_count == 1);
        assert!(s.render(info.token, 0, 200, "png", 1.0).is_ok());
        // A locked drop from bytes keeps (and later removes) its temp file.
        let info = s.open_bytes("l.pdf", LOCKED_PDF).unwrap();
        assert!(info.locked);
        assert_eq!(std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0), 1);
        s.close(info.token).unwrap();
        assert_eq!(std::fs::read_dir(dir.path().join("tmp")).map(|d| d.count()).unwrap_or(0), 0);
    }
}

#[cfg(test)]
mod gateway_tests {
    use super::gateway_call;

    #[test]
    fn rows_refuse_bad_bodies_and_unknown_methods() {
        assert_eq!(gateway_call("pdf.open", &[]).unwrap_err().code, "INVALID_ARGUMENT");
        // A name length that runs past the body, and a name with no PDF bytes.
        assert_eq!(gateway_call("pdf.open", &[0, 0, 0, 9, b'a']).unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(gateway_call("pdf.open", &[0, 0, 0, 1, b'a']).unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(gateway_call("pdf.render", b"{}").unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(gateway_call("pdf.close", b"nope").unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(gateway_call("pdf.delete", b"").unwrap_err().code, "NOT_FOUND");
    }
}
