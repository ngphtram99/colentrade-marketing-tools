/**
 * SCRIPT RIENG CHO MODULE "CAP NHAT HINH ANH".
 * Khong dan file nay vao Apps Script cua DSM dinh muc cap mau.
 *
 * Web App:
 * - Execute as: Me
 * - Who has access: Anyone with the link
 *
 * Vercel env:
 * APPS_SCRIPT_API_URL = URL /exec cua Web App nay
 */

const IMAGE_SHEET_NAMES = ["Ho Chi Minh", "Mien Dong", "Mien Tay", "Mien Trung"];
const IMAGE_SHEET_NAME_ALIASES = ["Hồ Chí Minh", "Miền Đông", "Miền Tây", "Miền Trung"];
const IMAGE_HEADER_SCAN_LIMIT = 12;
const IMAGE_MAX_FILES = 10;

const IMAGE_FIELD_ALIASES = {
  orderCode: ["Mã phiếu", "Ma phieu", "Mã đơn", "Ma don", "Mã đơn hàng", "Ma don hang", "Order Code"],
  date: ["Ngày hiệu lực", "Ngay hieu luc", "Ngày tạo", "Ngay tao", "Ngày", "Ngay", "Ngày chứng từ", "Ngay chung tu"],
  sales: ["Nhân viên kinh doanh", "Nhan vien kinh doanh", "Nhân viên", "Nhan vien", "Sales", "Sale"],
  customer: ["Khách hàng", "Khach hang", "Tên khách hàng", "Ten khach hang", "Customer"],
  area: ["Khu vực", "Khu vuc", "Miền/Khu vực", "Mien/Khu vuc", "Miền", "Mien", "Region"],
  product: ["Sản phẩm", "San pham", "Mã hàng", "Ma hang", "Tên hàng", "Ten hang"],
  quantity: ["Số lượng", "So luong", "SL"],
  note: ["Ghi chú chung", "Ghi chu chung", "Ghi chú", "Ghi chu", "Nội dung", "Noi dung", "Note"],
  imageStatus: ["Trạng thái hình ảnh", "Trang thai hinh anh", "MKT check", "Trạng thái", "Trang thai"],
  folderId: ["Link thư mục Drive", "Link thu muc Drive", "Folder ID", "Folder", "Drive Folder", "Link Drive"],
  lastUpdated: ["Ngày cập nhật cuối", "Ngay cap nhat cuoi", "Cập nhật cuối", "Cap nhat cuoi", "Thời gian upload", "Thoi gian upload", "Ngày cập nhật", "Ngay cap nhat"],
  imageCount: ["Số lượng ảnh", "So luong anh", "Số ảnh", "So anh", "Image Count", "Ảnh", "Anh"]
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.api === "debug") {
    return outputJson_({
      generatedAt: formatDateTime_(new Date()),
      spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
      sheets: SpreadsheetApp.getActiveSpreadsheet().getSheets().map(sheet => sheet.getName())
    }, params.callback);
  }

  return outputJson_(buildImageDashboard_(), params.callback);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    return outputJson_(uploadImages_(body));
  } catch (err) {
    return outputJson_({ error: err.message || "Upload khong thanh cong." }, null, 500);
  }
}

function buildImageDashboard_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existingSheets = findImageSheets_(ss);
  const folderCache = {};
  const orders = [];

  existingSheets.forEach(sheet => {
    const rows = sheet.getDataRange().getDisplayValues();
    const headerInfo = detectHeaderRow_(rows);
    if (headerInfo.index < 0) return;

    const seen = {};
    for (let i = headerInfo.index + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const orderCode = getCell_(row, headerInfo.indexes.orderCode);
      const folderId = extractFolderId_(getCell_(row, headerInfo.indexes.folderId));
      const customer = getCell_(row, headerInfo.indexes.customer);
      if (!orderCode || !folderId || shouldSkipRow_(row, headerInfo.indexes)) continue;

      const key = sheet.getName() + "|" + orderCode + "|" + folderId;
      if (seen[key]) continue;
      seen[key] = true;

      let images = [];
      let note = "";
      try {
        if (!folderCache[folderId]) folderCache[folderId] = listDriveImages_(folderId);
        images = folderCache[folderId];
      } catch (err) {
        note = err.message || "Khong doc duoc folder Drive.";
      }

      const imageCount = images.length;
      const status = statusFromCount_(imageCount, Boolean(note));
      const area = getCell_(row, headerInfo.indexes.area) || sheet.getName();

      orders.push({
        id: sheet.getName() + "-" + (i + 1) + "-" + orderCode,
        sheet: area,
        sourceSheet: sheet.getName(),
        rowNumber: i + 1,
        orderCode: orderCode,
        date: getCell_(row, headerInfo.indexes.date),
        sales: getCell_(row, headerInfo.indexes.sales),
        customer: customer,
        area: area,
        product: getCell_(row, headerInfo.indexes.product),
        quantity: getCell_(row, headerInfo.indexes.quantity),
        folderId: folderId,
        imageCount: imageCount,
        imageLimit: IMAGE_MAX_FILES,
        lastImageUpdate: latestImageDate_(images, getCell_(row, headerInfo.indexes.lastUpdated)),
        approved: imageCount > 0,
        status: status,
        note: note || (imageCount > 0 ? "" : "Chua co hinh cho ma phieu: " + orderCode),
        images: images
      });
    }
  });

  const sheetNames = existingSheets.map(sheet => sheet.getName());
  const summary = {
    total: orders.length,
    reported: orders.filter(order => order.imageCount > 0).length,
    notReported: orders.filter(order => order.imageCount === 0 && order.status !== "Lỗi folder").length,
    missingImages: orders.filter(order => order.imageCount === 0).length,
    pendingReview: orders.filter(order => order.imageCount > 0 && order.imageCount < IMAGE_MAX_FILES).length,
    folderErrors: orders.filter(order => order.status === "Lỗi folder").length,
    completed: orders.filter(order => order.imageCount >= IMAGE_MAX_FILES).length
  };

  const byRegion = sheetNames.map(name => {
    const regionOrders = orders.filter(order => order.sourceSheet === name || order.sheet === name);
    return {
      region: name,
      total: regionOrders.length,
      reported: regionOrders.filter(order => order.imageCount > 0).length,
      missing: regionOrders.filter(order => order.imageCount === 0).length
    };
  });

  return {
    generatedAt: formatDateTime_(new Date()),
    sheetNames: sheetNames,
    summary: summary,
    byRegion: byRegion,
    orders: orders
  };
}

function uploadImages_(body) {
  const orderCode = String(body.orderCode || "").trim();
  const folderId = String(body.folderId || "").trim();
  const files = Array.isArray(body.files) ? body.files : [];
  if (!orderCode || !folderId || !files.length) throw new Error("Thieu ma phieu, folder Drive hoac file anh.");

  const currentImages = listDriveImages_(folderId);
  if (currentImages.length + files.length > IMAGE_MAX_FILES) {
    throw new Error("Phiếu đã đạt giới hạn tối đa 10 hình ảnh.");
  }

  const folder = DriveApp.getFolderById(folderId);
  const stamp = Utilities.formatDate(new Date(), "GMT+7", "yyyyMMddHHmmss");
  const uploaded = [];

  files.forEach(file => {
    const bytes = Utilities.base64Decode(String(file.data || ""));
    const mimeType = String(file.type || "image/jpeg");
    const name = safeFileName_(orderCode) + "-" + stamp + "-" + safeFileName_(file.name || "image.jpg");
    const created = folder.createFile(Utilities.newBlob(bytes, mimeType, name));
    uploaded.push(fileToJson_(created));
  });

  const imageCount = currentImages.length + uploaded.length;
  const status = statusFromCount_(imageCount, false);
  const updatedAt = formatDateTime_(new Date());
  updateImageRow_(body, imageCount, status, updatedAt);

  return {
    uploaded: uploaded.length,
    imageCount: imageCount,
    status: status,
    updatedAt: updatedAt,
    files: uploaded
  };
}

function updateImageRow_(body, imageCount, status, updatedAt) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = String(body.sourceSheet || "").trim();
  const orderCode = String(body.orderCode || "").trim();
  let sheet = sourceSheet ? ss.getSheetByName(sourceSheet) : null;
  let rowNumber = Number(body.rowNumber || 0);
  let headerInfo = null;

  if (sheet) {
    headerInfo = detectHeaderRow_(sheet.getDataRange().getDisplayValues());
  }

  if (!sheet || !rowNumber || !headerInfo || headerInfo.index < 0) {
    const found = findOrderRow_(ss, orderCode);
    if (!found) return;
    sheet = found.sheet;
    rowNumber = found.rowNumber;
    headerInfo = found.headerInfo;
  }

  if (headerInfo.indexes.imageStatus >= 0) sheet.getRange(rowNumber, headerInfo.indexes.imageStatus + 1).setValue(status);
  if (headerInfo.indexes.lastUpdated >= 0) sheet.getRange(rowNumber, headerInfo.indexes.lastUpdated + 1).setValue(updatedAt);
  if (headerInfo.indexes.imageCount >= 0) sheet.getRange(rowNumber, headerInfo.indexes.imageCount + 1).setValue(imageCount);
}

function findOrderRow_(ss, orderCode) {
  const sheets = findImageSheets_(ss);
  for (let s = 0; s < sheets.length; s += 1) {
    const sheet = sheets[s];
    const rows = sheet.getDataRange().getDisplayValues();
    const headerInfo = detectHeaderRow_(rows);
    if (headerInfo.index < 0 || headerInfo.indexes.orderCode < 0) continue;

    for (let i = headerInfo.index + 1; i < rows.length; i += 1) {
      if (String(rows[i][headerInfo.indexes.orderCode] || "").trim() === orderCode) {
        return { sheet: sheet, rowNumber: i + 1, headerInfo: headerInfo };
      }
    }
  }
  return null;
}

function findImageSheets_(ss) {
  const wanted = IMAGE_SHEET_NAMES.concat(IMAGE_SHEET_NAME_ALIASES).map(normalizeKey_);
  return ss.getSheets().filter(sheet => wanted.indexOf(normalizeKey_(sheet.getName())) >= 0);
}

function detectHeaderRow_(rows) {
  const limit = Math.min(rows.length, IMAGE_HEADER_SCAN_LIMIT);
  let best = { index: -1, score: 0, indexes: {} };
  for (let i = 0; i < limit; i += 1) {
    const headers = rows[i] || [];
    const indexes = {};
    Object.keys(IMAGE_FIELD_ALIASES).forEach(field => {
      indexes[field] = findColumn_(headers, IMAGE_FIELD_ALIASES[field]);
    });
    const score = [indexes.orderCode, indexes.customer, indexes.folderId, indexes.date, indexes.sales, indexes.area]
      .filter(index => index >= 0).length;
    if (score > best.score) best = { index: i, score: score, indexes: indexes };
  }
  return best.score >= 3 ? best : { index: -1, score: 0, indexes: {} };
}

function findColumn_(headers, aliases) {
  const keys = aliases.map(normalizeKey_);
  for (let i = 0; i < headers.length; i += 1) {
    if (keys.indexOf(normalizeKey_(headers[i])) >= 0) return i;
  }
  return -1;
}

function normalizeKey_(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function getCell_(row, index) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function shouldSkipRow_(row, indexes) {
  const note = normalizeKey_(getCell_(row, indexes.note));
  const status = normalizeKey_(getCell_(row, indexes.imageStatus));
  return note.indexOf("DSM") >= 0 || status.indexOf("DSM") >= 0;
}

function extractFolderId_(value) {
  const match = String(value || "").match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function listDriveImages_(folderId) {
  const files = [];
  const iterator = DriveApp.getFolderById(folderId).getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (String(file.getMimeType() || "").indexOf("image/") === 0) files.push(fileToJson_(file));
  }
  files.sort((a, b) => new Date(b.updatedAtRaw || b.createdAtRaw) - new Date(a.updatedAtRaw || a.createdAtRaw));
  return files;
}

function fileToJson_(file) {
  const id = file.getId();
  const created = file.getDateCreated();
  const updated = file.getLastUpdated();
  return {
    id: id,
    name: file.getName(),
    mimeType: file.getMimeType(),
    createdAt: formatDateTime_(created),
    updatedAt: formatDateTime_(updated),
    createdAtRaw: created.toISOString(),
    updatedAtRaw: updated.toISOString(),
    thumbnailUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w1000",
    imageUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w1600",
    webViewLink: file.getUrl()
  };
}

function latestImageDate_(images, fallback) {
  return images && images.length ? images[0].updatedAt : String(fallback || "").trim();
}

function statusFromCount_(count, folderError) {
  if (folderError) return "Lỗi folder";
  if (count <= 0) return "Chưa cập nhật";
  if (count > IMAGE_MAX_FILES) return "Vượt giới hạn";
  if (count === IMAGE_MAX_FILES) return "Đã đủ ảnh";
  return "Hợp lệ";
}

function safeFileName_(value) {
  return String(value || "image").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, "GMT+7", "dd/MM/yyyy HH:mm");
}

function outputJson_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
