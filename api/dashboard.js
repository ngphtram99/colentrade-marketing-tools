const DEFAULT_SHEETS = ["Miền Tây", "Miền Đông", "Hồ Chí Minh", "Miền Trung"];
const HEADER_ROW_INDEX = 1;
const DATA_START_INDEX = 2;

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalize(value) {
  return String(value || "").trim();
}

function extractFolderId(value) {
  const match = normalize(value).match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function truthy(value) {
  const normalized = normalize(value).toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "x" || normalized === "đã duyệt";
}

function col(headers, name) {
  return headers.findIndex(header => normalize(header) === name);
}

async function listFiles(drive, folderId) {
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink)",
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

function buildRanges(sheetNames) {
  return sheetNames.map(sheetName => `'${sheetName.replace(/'/g, "''")}'!A:Z`);
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
      const region = match ? match[1].replace(/''/g, "'") : "";
      const rows = valueRange.values || [];
      const headers = rows[HEADER_ROW_INDEX] || [];

      const indexes = {
        orderCode: col(headers, "Mã đơn hàng"),
        date: col(headers, "Ngày tạo"),
        sales: col(headers, "Nhân viên kinh doanh"),
        customer: col(headers, "Khách hàng"),
        area: col(headers, "Khu vực"),
        product: col(headers, "Sản phẩm"),
        quantity: col(headers, "Số lượng"),
        mktCheck: col(headers, "MKT check"),
        folderId: col(headers, "Folder ID")
      };

      if (indexes.orderCode === -1 || indexes.folderId === -1) continue;

      const seenInSheet = new Set();

      for (let rowIndex = DATA_START_INDEX; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const orderCode = normalize(row[indexes.orderCode]);
        const folderId = extractFolderId(row[indexes.folderId]);

        if (!orderCode || !folderId) continue;

        const key = `${region}|${orderCode}|${folderId}`;
        if (seenInSheet.has(key)) continue;
        seenInSheet.add(key);

        let files = [];
        let error = "";

        try {
          if (!folderCache.has(folderId)) {
            folderCache.set(folderId, await listFiles(drive, folderId));
          }
          files = folderCache.get(folderId).filter(file => (
            normalize(file.name).includes(orderCode) &&
            normalize(file.mimeType).startsWith("image/")
          ));
        } catch (err) {
          error = err.message || "Không đọc được folder Drive.";
        }

        const imageCount = files.length;
        const approved = indexes.mktCheck >= 0 ? truthy(row[indexes.mktCheck]) : false;
        if (rowIndex === 2) console.log("[DEBUG] mktCheck index:", indexes.mktCheck, "headers:", JSON.stringify(headers), "raw value:", JSON.stringify(row[indexes.mktCheck]));

        orders.push({
          id: `${region}-${rowIndex}-${orderCode}`,
          sheet: region,
          rowNumber: rowIndex + 1,
          orderCode,
          date: indexes.date >= 0 ? normalize(row[indexes.date]) : "",
          sales: indexes.sales >= 0 ? normalize(row[indexes.sales]) : "",
          customer: indexes.customer >= 0 ? normalize(row[indexes.customer]) : "",
          area: indexes.area >= 0 ? normalize(row[indexes.area]) : region,
          product: indexes.product >= 0 ? normalize(row[indexes.product]) : "",
          quantity: indexes.quantity >= 0 ? normalize(row[indexes.quantity]) : "",
          folderId,
          imageCount,
          approved,
          status: error ? "Lỗi folder" : imageCount > 0 ? "Đã upload" : "Thiếu hình",
          note: error || (imageCount > 0 ? "" : `Không thấy file có chứa mã đơn: ${orderCode}`),
          images: files.map(file => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
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
      pendingReview: orders.filter(order => order.imageCount > 0 && !order.approved).length,
      folderErrors: orders.filter(order => order.status === "Lỗi folder").length
    };

    const byRegion = sheetNames.map(sheetName => {
      const regionOrders = orders.filter(order => order.sheet === sheetName);
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
