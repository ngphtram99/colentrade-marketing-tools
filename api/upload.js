const { Readable } = require("stream");

const MAX_IMAGES_PER_ORDER = 10;
const HEADER_SCAN_LIMIT = 12;

const FIELD_ALIASES = {
  orderCode: ["Mã phiếu", "Mã đơn", "Mã đơn hàng", "Mã đơn hàng/phiếu", "Order Code"],
  imageStatus: ["Trạng thái hình ảnh", "MKT check", "Trạng thái"],
  folderId: ["Link thư mục Drive", "Folder ID", "Folder", "Drive Folder", "Link Drive"],
  lastUpdated: ["Ngày cập nhật cuối", "Cập nhật cuối", "Thời gian upload", "Ngày cập nhật"],
  imageCount: ["Số lượng ảnh", "Số ảnh", "Image Count", "Ảnh"]
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

    const score = [indexes.orderCode, indexes.folderId, indexes.imageStatus, indexes.lastUpdated, indexes.imageCount]
      .filter(index => index >= 0).length;

    if (score > best.score) best = { index: i, score, indexes };
  }

  return best.score >= 1 ? best : { index: -1, score: 0, indexes: {} };
}

function columnLetter(index) {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - mod) / 26);
  }
  return result;
}

function formatVietnamDateTime(date) {
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

function statusFromCount(count) {
  if (count <= 0) return "Chưa cập nhật";
  if (count >= MAX_IMAGES_PER_ORDER) return "Đã đủ ảnh";
  return "Hợp lệ";
}

function safeFileName(value) {
  return normalize(value).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) || "image";
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function proxyToAppsScript(body) {
  const response = await fetch(process.env.APPS_SCRIPT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, api: "upload" })
  });
  const text = await response.text();
  const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");
  return {
    ok: response.ok && isJson,
    status: response.status,
    body: isJson ? JSON.parse(text) : {
      error: "Apps Script upload chưa trả JSON. Kiểm tra đúng script Cập nhật hình ảnh và đã deploy Web App.",
      preview: text.slice(0, 180)
    }
  };
}

async function listImageFiles(drive, folderId) {
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: "nextPageToken, files(id, name, mimeType, webViewLink, createdTime, modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return files;
}

async function updateSheet({ google, auth, spreadsheetId, sourceSheet, rowNumber, orderCode, imageCount, status, updatedAt }) {
  if (!spreadsheetId || !sourceSheet) return;

  const sheetsApi = google.sheets({ version: "v4", auth });
  const range = `'${sourceSheet.replace(/'/g, "''")}'!A:AZ`;
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS"
  });

  const rows = response.data.values || [];
  const headerInfo = detectHeaderRow(rows);
  if (headerInfo.index < 0) return;

  let targetRow = Number(rowNumber || 0);
  if (!targetRow || targetRow <= headerInfo.index + 1) {
    const orderCol = headerInfo.indexes.orderCode;
    const found = rows.findIndex((row, index) => index > headerInfo.index && normalize(row[orderCol]) === normalize(orderCode));
    if (found >= 0) targetRow = found + 1;
  }
  if (!targetRow) return;

  const updates = [];
  const escapedSheet = sourceSheet.replace(/'/g, "''");

  if (headerInfo.indexes.imageStatus >= 0) {
    updates.push({
      range: `'${escapedSheet}'!${columnLetter(headerInfo.indexes.imageStatus)}${targetRow}`,
      values: [[status]]
    });
  }
  if (headerInfo.indexes.lastUpdated >= 0) {
    updates.push({
      range: `'${escapedSheet}'!${columnLetter(headerInfo.indexes.lastUpdated)}${targetRow}`,
      values: [[updatedAt]]
    });
  }
  if (headerInfo.indexes.imageCount >= 0) {
    updates.push({
      range: `'${escapedSheet}'!${columnLetter(headerInfo.indexes.imageCount)}${targetRow}`,
      values: [[imageCount]]
    });
  }

  if (!updates.length) return;

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readBody(req);
    const orderCode = normalize(body.orderCode);
    const folderId = normalize(body.folderId);
    const files = Array.isArray(body.files) ? body.files : [];

    if (!orderCode || !folderId || !files.length) {
      json(res, 400, { error: "Thiếu mã phiếu, folder Drive hoặc file ảnh." });
      return;
    }

    if (process.env.APPS_SCRIPT_API_URL) {
      const proxied = await proxyToAppsScript(body);
      json(res, proxied.ok ? 200 : 502, proxied.body);
      return;
    }

    const spreadsheetId = process.env.SPREADSHEET_ID;
    const { google } = require("googleapis");
    const { getAuth } = require("./google-auth");
    const auth = getAuth([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets"
    ]);
    const drive = google.drive({ version: "v3", auth });

    const currentFiles = await listImageFiles(drive, folderId);
    if (currentFiles.length + files.length > MAX_IMAGES_PER_ORDER) {
      json(res, 400, { error: "Phiếu đã đạt giới hạn tối đa 10 hình ảnh." });
      return;
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const uploadedFiles = [];

    for (const file of files) {
      const mimeType = normalize(file.type) || "image/jpeg";
      const buffer = Buffer.from(String(file.data || ""), "base64");
      if (!buffer.length) continue;

      const created = await drive.files.create({
        requestBody: {
          name: `${safeFileName(orderCode)}-${stamp}-${safeFileName(file.name)}`,
          parents: [folderId],
          mimeType
        },
        media: {
          mimeType,
          body: Readable.from(buffer)
        },
        fields: "id, name, mimeType, webViewLink, createdTime, modifiedTime",
        supportsAllDrives: true
      });
      uploadedFiles.push(created.data);
    }

    const imageCount = currentFiles.length + uploadedFiles.length;
    const status = statusFromCount(imageCount);
    const updatedAt = formatVietnamDateTime(new Date());

    await updateSheet({
      google,
      auth,
      spreadsheetId,
      sourceSheet: body.sourceSheet,
      rowNumber: body.rowNumber,
      orderCode,
      imageCount,
      status,
      updatedAt
    });

    json(res, 200, {
      uploaded: uploadedFiles.length,
      imageCount,
      status,
      updatedAt,
      files: uploadedFiles
    });
  } catch (err) {
    json(res, 500, { error: err.message || "Upload không thành công." });
  }
};
