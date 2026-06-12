const DEFAULT_SHEETS = ["Miền Tây", "Miền Đông", "Hồ Chí Minh", "Miền Trung"];
const HEADER_SCAN_LIMIT = 12;
const MAX_IMAGES_PER_ORDER = 10;

const FIELD_ALIASES = {
  orderCode: ["Mã phiếu", "Mã đơn", "Mã đơn hàng", "Mã đơn hàng/phiếu", "Order Code"],
  date: ["Ngày hiệu lực", "Ngày tạo", "Ngày", "Ngày chứng từ"],
  sales: ["Nhân viên kinh doanh", "Nhân viên", "Sales", "Sale"],
  customer: ["Khách hàng", "Tên khách hàng", "Customer"],
  area: ["Khu vực", "Miền/Khu vực", "Miền", "Region"],
  product: ["Sản phẩm", "Mã hàng", "Tên hàng"],
  quantity: ["Số lượng", "SL"],
  note: ["Ghi chú chung", "Ghi chú", "Nội dung", "Note"],
  imageStatus: ["Trạng thái hình ảnh", "MKT check", "Trạng thái"],
  folderId: ["Link thư mục Drive", "Folder ID", "Folder", "Drive Folder", "Link Drive"],
  lastUpdated: ["Ngày cập nhật cuối", "Cập nhật cuối", "Thời gian upload", "Ngày cập nhật"]
};

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function extractFolderId(value) {
  const match = normalize(value).match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function col(headers, aliases) {
  const keys = new Set(aliases.map(normalizeKey));
  return headers.findIndex(header => keys.has(normalizeKey(header)));
}

function detectHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  let best = { index: -1, score: 0, indexes: {} };

  for (let i = 0; i < limit; i += 1) {
    const headers = rows[i] || [];
    const indexes = {};
    Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
      indexes[field] = col(headers, aliases);
    });

    const score = [
      indexes.orderCode,
      indexes.customer,
      indexes.folderId,
      indexes.date,
      indexes.sales,
      indexes.area
    ].filter(index => index >= 0).length;

    if (score > best.score) best = { index: i, score, indexes };
  }

  return best.score >= 3 ? best : { index: -1, score: 0, indexes: {} };
}

function getCell(row, index) {
  return index >= 0 ? normalize(row[index]) : "";
}

function shouldSkipRow(row, indexes) {
  const note = normalizeKey(getCell(row, indexes.note));
  const status = normalizeKey(getCell(row, indexes.imageStatus));
  return note.includes("DSM") || status.includes("DSM");
}

function imageStatusFromCount(count, folderError) {
  if (folderError) return "Lỗi folder";
  if (count <= 0) return "Chưa cập nhật";
  if (count >= MAX_IMAGES_PER_ORDER) return "Đã đủ ảnh";
  return "Hợp lệ";
}

function listStatusFromCount(count, folderError) {
  if (folderError) return "Lỗi folder";
  if (count <= 0) return "Chưa cập nhật";
  if (count > MAX_IMAGES_PER_ORDER) return "Vượt giới hạn";
  if (count === MAX_IMAGES_PER_ORDER) return "Đã đủ ảnh";
  return "Hợp lệ";
}

async function listFiles(drive, folderId) {
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: "nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink, createdTime, modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  files.sort((a, b) => new Date(b.modifiedTime || b.createdTime || 0) - new Date(a.modifiedTime || a.createdTime || 0));
  return files;
}

function buildRanges(sheetNames) {
  return sheetNames.map(sheetName => `'${sheetName.replace(/'/g, "''")}'!A:AZ`);
}

function formatVietnamDateTime(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(",", "");
}

function latestImageDate(files, fallback) {
  const latest = files[0] && (files[0].modifiedTime || files[0].createdTime);
  return latest ? formatVietnamDateTime(new Date(latest)) : normalize(fallback);
}

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    if (process.env.APPS_SCRIPT_API_URL) {
      const response = await fetch(process.env.APPS_SCRIPT_API_URL);
      const text = await response.text();
      const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");

      res.statusCode = response.ok && isJson ? 200 : 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(isJson ? text : JSON.stringify({
        error: "Apps Script chưa trả JSON. Kiểm tra Web App đã deploy với quyền Anyone with the link chưa.",
        status: response.status,
        preview: text.slice(0, 180)
      }));
      return;
    }

    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      json(res, 500, { error: "Thiếu SPREADSHEET_ID trong Vercel environment variables." });
      return;
    }

    const sheetNames = (process.env.SHEET_NAMES || DEFAULT_SHEETS.join(","))
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    const { google } = require("googleapis");
    const { getAuth } = require("./google-auth");
    const auth = getAuth([
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly"
    ]);

    const sheetsApi = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    const sheetResponse = await sheetsApi.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: buildRanges(sheetNames),
      majorDimension: "ROWS"
    });

    const folderCache = new Map();
    const orders = [];

    for (const valueRange of sheetResponse.data.valueRanges || []) {
      const match = valueRange.range.match(/^'?(.*?)'?!/);
      const sheetName = match ? match[1].replace(/''/g, "'") : "";
      const rows = valueRange.values || [];
      const headerInfo = detectHeaderRow(rows);
      if (headerInfo.index < 0) continue;

      const indexes = headerInfo.indexes;
      const seenInSheet = new Set();

      for (let rowIndex = headerInfo.index + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const orderCode = getCell(row, indexes.orderCode);
        const folderId = extractFolderId(getCell(row, indexes.folderId));
        const customer = getCell(row, indexes.customer);

        if (!orderCode || !folderId || shouldSkipRow(row, indexes)) continue;

        const key = `${sheetName}|${orderCode}|${folderId}`;
        if (seenInSheet.has(key)) continue;
        seenInSheet.add(key);

        let files = [];
        let error = "";

        try {
          if (!folderCache.has(folderId)) {
            folderCache.set(folderId, await listFiles(drive, folderId));
          }
          files = folderCache.get(folderId);
        } catch (err) {
          error = err.message || "Không đọc được folder Drive.";
        }

        const imageCount = files.length;
        const status = listStatusFromCount(imageCount, Boolean(error));
        const region = getCell(row, indexes.area) || sheetName;

        orders.push({
          id: `${sheetName}-${rowIndex}-${orderCode}`,
          sheet: region,
          sourceSheet: sheetName,
          rowNumber: rowIndex + 1,
          orderCode,
          date: getCell(row, indexes.date),
          sales: getCell(row, indexes.sales),
          customer,
          area: region,
          product: getCell(row, indexes.product),
          quantity: getCell(row, indexes.quantity),
          folderId,
          imageCount,
          imageLimit: MAX_IMAGES_PER_ORDER,
          lastImageUpdate: latestImageDate(files, getCell(row, indexes.lastUpdated)),
          approved: imageCount > 0,
          status,
          note: error || (imageCount > 0 ? "" : `Chưa có hình cho mã phiếu: ${orderCode}`),
          images: files.map(file => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            createdAt: formatVietnamDateTime(new Date(file.createdTime || file.modifiedTime)),
            updatedAt: formatVietnamDateTime(new Date(file.modifiedTime || file.createdTime)),
            thumbnailUrl: `/api/image?id=${encodeURIComponent(file.id)}&thumb=1`,
            imageUrl: `/api/image?id=${encodeURIComponent(file.id)}`,
            webViewLink: file.webViewLink || ""
          }))
        });
      }
    }

    const summary = {
      total: orders.length,
      reported: orders.filter(order => order.imageCount > 0).length,
      notReported: orders.filter(order => order.imageCount === 0 && order.status !== "Lỗi folder").length,
      missingImages: orders.filter(order => order.imageCount === 0).length,
      pendingReview: orders.filter(order => order.imageCount > 0 && order.imageCount < MAX_IMAGES_PER_ORDER).length,
      folderErrors: orders.filter(order => order.status === "Lỗi folder").length,
      completed: orders.filter(order => order.imageCount >= MAX_IMAGES_PER_ORDER).length
    };

    const byRegion = sheetNames.map(sheetName => {
      const regionOrders = orders.filter(order => order.sourceSheet === sheetName || order.sheet === sheetName);
      return {
        region: sheetName,
        total: regionOrders.length,
        reported: regionOrders.filter(order => order.imageCount > 0).length,
        missing: regionOrders.filter(order => order.imageCount === 0).length
      };
    });

    json(res, 200, {
      generatedAt: formatVietnamDateTime(new Date()),
      sheetNames,
      summary,
      byRegion,
      orders
    });
  } catch (err) {
    json(res, 500, { error: err.message || "Không tải được dashboard." });
  }
};
