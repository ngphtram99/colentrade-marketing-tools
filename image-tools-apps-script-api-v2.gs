/**
 * IMAGE TOOLS - Apps Script Web App v2
 *
 * Cấu trúc sheet (header row 2):
 *   STT | Ngày tạo | Mã đơn hàng | Nhân viên kinh doanh | Khách hàng | Khu vực
 *   Ghi chú chung | Sản phẩm | Số lượng | ĐVT | Số xe | Trạng thái giao hàng
 *   [cột N] Link folder Drive | KD tick | Ghi chú KD | MKT check
 *   Số ảnh đã upload | Ngày hệ thống check | Kết quả check ảnh | Ghi chú hệ thống
 *
 * Logic ảnh (song song 2 luồng):
 *   1. Upload qua Drive trực tiếp  → trigger 1h / menu check → cập nhật sheet
 *   2. Upload qua App              → lưu vào folder Drive, đặt tên MAPHIEU_ts_n.jpg
 *                                  → cập nhật sheet ngay lập tức
 *
 * Deploy:
 *   Execute as: Me  |  Who has access: Anyone with the link
 *   Vercel env: APPS_SCRIPT_API_URL = URL /exec
 */

const IT_SHEETS  = ["Miền Tây", "Miền Đông", "Hồ Chí Minh", "Miền Trung"];
const IT_HDR_ROW = 2;   // header nằm ở row 2 (1-indexed)
const IT_MAX_IMG = 10;
const IT_STAFF_SHEET = "Data_Nhan_Su";

// Tên cột → danh sách alias (so sánh không dấu, không cần chính xác tuyệt đối)
const IT_COLS = {
  orderCode  : ["Mã đơn hàng","Mã phiếu","Mã đơn","Ma don hang","Ma phieu"],
  date       : ["Ngày tạo","Ngày","Ngay tao","Ngay"],
  sales      : ["Nhân viên kinh doanh","Nhan vien kinh doanh","Nhân viên","NVKD"],
  customer   : ["Khách hàng","Khach hang"],
  area       : ["Khu vực","Khu vuc","Miền","Mien"],
  product    : ["Sản phẩm","San pham","Mã hàng","Ma hang"],
  quantity   : ["Số lượng","So luong","SL"],
  folderLink : [
    // tên cột đầy đủ trong sheet thực tế (đã bị xuống dòng, tui match theo từ khoá)
    "Bấm vào Link","Link folder","Link thư mục Drive","Folder ID","Folder","Link Drive","Drive"
  ],
  mktCheck   : ["MKT check","Trạng thái hình ảnh"],
  imageCount : ["Số ảnh đã upload","Số ảnh","So anh","Image Count"],
  checkDate  : ["Ngày hệ thống check","Ngày check"],
  checkResult: ["Kết quả check ảnh","Kết quả"],
  sysNote    : ["Ghi chú hệ thống","Ghi chu he thong"]
};

/* ─── HTTP ─── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.api === "debug") return out_(debugInfo_());
    if (p.authOnly)        return out_(handleAuth_(p));
    return out_(buildDashboard_(), p.callback);
  } catch(err) { return out_({ error: err.message }); }
}

function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (b.action === "review") return out_(doReview_(b));
    return out_(doUpload_(b));
  } catch(err) { return out_({ error: err.message || "Thao tac that bai." }); }
}

/* ─── DASHBOARD ─── */

function buildDashboard_() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheets  = targetSheets_(ss);
  const fcache  = {};
  const orders  = [];

  sheets.forEach(sheet => {
    const { colIdx, dataRows } = readSheet_(sheet);
    if (colIdx.orderCode === undefined) return;
    const seen = {};

    dataRows.forEach(row => {
      const code      = cv_(row, colIdx.orderCode);
      const folderRaw = cv_(row, colIdx.folderLink);
      const folderId  = parseFolderId_(folderRaw);
      if (!code || seen[code]) return;
      seen[code] = true;

      let images = [], folderErr = "";
      if (folderId) {
        try {
          if (!fcache[folderId]) fcache[folderId] = driveImages_(folderId);
          images = fcache[folderId].filter(f => f.name.toLowerCase().includes(code.toLowerCase()));
        } catch(e) { folderErr = e.message; }
      }

      const cnt    = images.length;
      const status = folderErr ? "Lỗi folder"
                   : cnt === 0 ? "Chưa cập nhật"
                   : cnt >= IT_MAX_IMG ? "Đã đủ ảnh" : "Hợp lệ";

      orders.push({
        id             : sheet.getName() + "|" + code,
        sourceSheet    : sheet.getName(),
        orderCode      : code,
        date           : cv_(row, colIdx.date),
        sales          : cv_(row, colIdx.sales),
        customer       : cv_(row, colIdx.customer),
        area           : cv_(row, colIdx.area) || sheet.getName(),
        product        : cv_(row, colIdx.product),
        folderId       : folderId,
        folderUrl      : folderId ? "https://drive.google.com/drive/folders/" + folderId : "",
        imageCount     : cnt,
        imageLimit     : IT_MAX_IMG,
        lastImageUpdate: images[0] ? images[0].updatedAt : cv_(row, colIdx.checkDate),
        status         : cv_(row, colIdx.mktCheck) || status,
        images         : images
      });
    });
  });

  const sum = {
    total        : orders.length,
    reported     : orders.filter(o => o.imageCount > 0).length,
    missingImages: orders.filter(o => o.imageCount === 0).length,
    completed    : orders.filter(o => o.imageCount >= IT_MAX_IMG).length,
    folderErrors : orders.filter(o => o.status === "Lỗi folder").length
  };

  return { generatedAt: fmtDT_(new Date()), sheetNames: sheets.map(s => s.getName()), summary: sum, orders };
}

/* ─── UPLOAD ─── */

function doUpload_(b) {
  const code     = String(b.orderCode  || "").trim();
  const folderId = String(b.folderId   || "").trim();
  const files    = Array.isArray(b.files) ? b.files : [];
  if (!code || !folderId || !files.length)
    throw new Error("Thiếu mã đơn, folder Drive hoặc file ảnh.");

  const existing = driveImages_(folderId).filter(f => f.name.toLowerCase().includes(code.toLowerCase()));
  if (existing.length >= IT_MAX_IMG)
    throw new Error("Phiếu đã đủ " + IT_MAX_IMG + " hình ảnh, không thể upload thêm.");
  if (existing.length + files.length > IT_MAX_IMG)
    throw new Error("Chỉ còn thể thêm " + (IT_MAX_IMG - existing.length) + " ảnh nữa.");

  const folder  = DriveApp.getFolderById(folderId);
  const stamp   = Utilities.formatDate(new Date(), "GMT+7", "yyyyMMddHHmmss");
  const uploaded = [];

  files.forEach((f, i) => {
    const bytes  = Utilities.base64Decode(String(f.data || ""));
    const mime   = String(f.type || "image/jpeg");
    const fname  = safeName_(code) + "_" + stamp + "_" + String(i+1).padStart(2,"0") + "_" + safeName_(f.name || "img.jpg");
    const file   = folder.createFile(Utilities.newBlob(bytes, mime, fname));
    uploaded.push(fileObj_(file));
  });

  const newCnt = existing.length + uploaded.length;
  const status = newCnt >= IT_MAX_IMG ? "Đã đủ ảnh" : "Hợp lệ";
  const ts     = fmtDT_(new Date());
  writeSheetRow_(code, newCnt, status, ts);
  return { uploaded: uploaded.length, imageCount: newCnt, status, updatedAt: ts, files: uploaded };
}

/* ─── REVIEW ─── */

function doReview_(b) {
  const code   = String(b.orderCode    || "").trim();
  const action = String(b.reviewAction || "").trim();
  const note   = String(b.reviewNote   || "").trim();
  const name   = String(b.reviewerName || "").trim();
  if (!code || !action) throw new Error("Thiếu mã đơn hoặc hành động.");
  const status = action === "approved" ? "Đã duyệt" : "Từ chối";
  const ts     = fmtDT_(new Date());
  writeSheetRow_(code, null, status, ts, name, note);
  return { success: true, orderCode: code, status, updatedAt: ts };
}

/* ─── AUTH ─── */

function handleAuth_(p) {
  return { generatedAt: fmtDT_(new Date()), auth: checkStaff_(p.authPhone) };
}

function checkStaff_(rawPhone) {
  if (!rawPhone) return { authorized: false, message: "Vui lòng nhập số điện thoại." };
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find(s => nk_(s.getName()) === nk_(IT_STAFF_SHEET));
  if (!sheet) return { authorized: false, message: "Không tìm thấy sheet nhân sự." };

  const rows  = sheet.getDataRange().getDisplayValues();
  let hdrIdx  = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (rows[i].some(h => nk_(h).includes("DIEN THOAI") || nk_(h).includes("SDT"))) { hdrIdx = i; break; }
  }
  const hdrs   = rows[hdrIdx];
  const pCol   = hdrs.findIndex(h => nk_(h).includes("DIEN THOAI") || nk_(h).includes("SDT") || nk_(h).includes("PHONE"));
  const nCol   = hdrs.findIndex(h => nk_(h).includes("HO TEN") || nk_(h).includes("TEN") || nk_(h).includes("NAME"));
  const sCol   = hdrs.findIndex(h => nk_(h).includes("TRANG THAI") || nk_(h).includes("STATUS"));
  const rCol   = hdrs.findIndex(h => nk_(h).includes("VAI TRO") || nk_(h).includes("ROLE") || nk_(h).includes("CHUC"));
  const phone  = normPhone_(rawPhone);

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    if (normPhone_(rows[i][pCol]) !== phone) continue;
    const active = nk_(rows[i][sCol]) === "ACTIVE";
    if (!active) return { authorized: false, message: "Tài khoản không còn hoạt động." };
    return {
      authorized: true,
      user: { phone, name: String(rows[i][nCol]||"").trim(), role: String(rows[i][rCol]||"").trim(), status: String(rows[i][sCol]||"").trim() }
    };
  }
  return { authorized: false, message: "Số điện thoại không có trong hệ thống." };
}

/* ─── SHEET R/W ─── */

function targetSheets_(ss) {
  const keys = IT_SHEETS.map(nk_);
  return ss.getSheets().filter(s => keys.includes(nk_(s.getName())));
}

function readSheet_(sheet) {
  const all  = sheet.getDataRange().getDisplayValues();
  // Tìm header row: scan đến row có chứa "Mã đơn hàng" hoặc tương đương
  let hdrIdx = IT_HDR_ROW - 1;
  for (let i = 0; i < Math.min(all.length, 6); i++) {
    if (findCol_(all[i], IT_COLS.orderCode) >= 0) { hdrIdx = i; break; }
  }
  const hdrs   = all[hdrIdx] || [];
  const colIdx = {};
  Object.keys(IT_COLS).forEach(k => { const c = findCol_(hdrs, IT_COLS[k]); if (c >= 0) colIdx[k] = c; });
  return { colIdx, dataRows: all.slice(hdrIdx + 1) };
}

function writeSheetRow_(orderCode, imageCount, status, ts, reviewerName, reviewNote) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const sheet of targetSheets_(ss)) {
    const { colIdx, dataRows } = readSheet_(sheet);
    if (colIdx.orderCode === undefined) continue;
    const startRow = IT_HDR_ROW + 1;
    for (let i = 0; i < dataRows.length; i++) {
      if (cv_(dataRows[i], colIdx.orderCode) !== orderCode) continue;
      const r = startRow + i;
      const set = (field, val) => { if (colIdx[field] !== undefined) sheet.getRange(r, colIdx[field]+1).setValue(val); };
      if (imageCount !== null) set("imageCount", imageCount);
      set("checkDate",   ts);
      set("checkResult", imageCount !== null ? (imageCount > 0 ? "Đã upload" : "Chưa tìm thấy ảnh") : status);
      set("mktCheck",    status);
      if (reviewNote && reviewerName && colIdx.sysNote !== undefined) {
        const cur = sheet.getRange(r, colIdx.sysNote+1).getValue();
        set("sysNote", cur ? cur + " | " + reviewerName + ": " + reviewNote : reviewerName + ": " + reviewNote);
      }
      return;
    }
  }
}

/* ─── DRIVE ─── */

function driveImages_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const list   = [];
  const it     = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (String(f.getMimeType()).startsWith("image/")) list.push(fileObj_(f));
  }
  list.sort((a, b) => new Date(b._raw) - new Date(a._raw));
  return list;
}

function fileObj_(f) {
  const id = f.getId();
  const upd = f.getLastUpdated();
  return {
    id          : id,
    name        : f.getName(),
    updatedAt   : fmtDT_(upd),
    _raw        : upd.toISOString(),
    thumbnailUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w1000",
    imageUrl    : "https://drive.google.com/thumbnail?id=" + id + "&sz=w1600",
    webViewLink : f.getUrl()
  };
}

function parseFolderId_(raw) {
  if (!raw) return "";
  let m = String(raw).match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = String(raw).match(/[a-zA-Z0-9_-]{25,}/);
  return m ? m[0] : "";
}

/* ─── MENU / TRIGGER ─── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("MKT Tools")
    .addItem("Check hình ảnh - sheet hiện tại", "menuCheckCurrent_")
    .addItem("Check hình ảnh - tất cả miền", "menuCheckAll_")
    .addSeparator()
    .addItem("Bật tự động check mỗi 1 giờ", "createTrigger_")
    .addItem("Tắt tự động check", "deleteTrigger_")
    .addToUi();
}

function menuCheckCurrent_() {
  syncSheet_(SpreadsheetApp.getActiveSheet());
  SpreadsheetApp.getUi().alert("Đã check xong: " + SpreadsheetApp.getActiveSheet().getName());
}

function menuCheckAll_() {
  targetSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(syncSheet_);
  SpreadsheetApp.getUi().alert("Đã hoàn tất kiểm tra hình ảnh cho tất cả khu vực.");
}

function autoCheckAll_() {
  targetSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(syncSheet_);
}

function createTrigger_() {
  deleteTrigger_(false);
  ScriptApp.newTrigger("autoCheckAll_").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("Đã bật tự động check hình ảnh mỗi 1 giờ.");
}

function deleteTrigger_(showAlert) {
  ScriptApp.getProjectTriggers()
    .filter(t => ["autoCheckAll_","runAllRegionsAuto","runAllRegions"].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (showAlert !== false) SpreadsheetApp.getUi().alert("Đã tắt tự động check.");
}

/**
 * Sync từ Drive vào sheet (không cần HTTP) — chạy qua menu hoặc trigger
 */
function syncSheet_(sheet) {
  const { colIdx, dataRows } = readSheet_(sheet);
  if (colIdx.orderCode === undefined || colIdx.folderLink === undefined) return;
  const startRow = IT_HDR_ROW + 1;
  const fcache   = {};
  const seen     = {};

  dataRows.forEach((row, i) => {
    const code  = cv_(row, colIdx.orderCode);
    const raw   = cv_(row, colIdx.folderLink);
    const fid   = parseFolderId_(raw);
    if (!code || !fid || seen[code]) return;
    seen[code] = true;

    const r = startRow + i;
    let cnt = 0, result = "", note = "";
    try {
      if (!fcache[fid]) fcache[fid] = driveImages_(fid);
      const imgs = fcache[fid].filter(f => f.name.toLowerCase().includes(code.toLowerCase()));
      cnt    = imgs.length;
      result = cnt > 0 ? "Đã upload" : "Chưa tìm thấy ảnh";
      note   = cnt === 0 ? "Không thấy file có chứa mã đơn: " + code : "";
    } catch(e) { result = "Lỗi"; note = e.message; }

    const set = (field, val) => { if (colIdx[field] !== undefined) sheet.getRange(r, colIdx[field]+1).setValue(val); };
    set("imageCount",  cnt || "");
    set("checkDate",   new Date());
    set("checkResult", result);
    set("sysNote",     note);
  });
}

/* ─── UTILS ─── */

function findCol_(headers, aliases) {
  const keys = aliases.map(nk_);
  for (let i = 0; i < headers.length; i++) {
    const h = nk_(headers[i]);
    if (!h) continue;
    // exact match
    if (keys.includes(h)) return i;
    // partial match cho cột dài có xuống dòng
    if (keys.some(k => h.includes(k) || k.includes(h.slice(0, 8)))) return i;
  }
  return -1;
}

function cv_(row, idx) { return idx !== undefined ? String(row[idx]||"").trim() : ""; }

function nk_(v) {
  return String(v||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/gi,"d")
    .replace(/[_\-./\n\r]+/g," ").replace(/\s+/g," ")
    .trim().toUpperCase();
}

function normPhone_(v) { return String(v||"").replace(/\D/g,"").replace(/^0+/,""); }

function fmtDT_(d) { return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm"); }

function safeName_(v) { return String(v||"file").replace(/[\\/:*?"<>|\s]+/g,"_").slice(0,80); }

function out_(data, cb) {
  const json = JSON.stringify(data);
  if (cb) return ContentService.createTextOutput(cb+"("+json+")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function debugInfo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    spreadsheetName: ss.getName(),
    allSheets: ss.getSheets().map(s => s.getName()),
    targetSheets: targetSheets_(ss).map(s => {
      const { colIdx } = readSheet_(s);
      return { name: s.getName(), colIdx };
    })
  };
}
