const DSM_REPORT_SHEET_NAME = "REPORT V2";
const DSM_DATA_SHEET_NAME = "Data_Update mỗi ngày_Theo Odoo";
const DSM_STAFF_SHEET_NAME = "Data_Nhan_Su";
const DSM_ACCESS_LOG_SHEET_NAME = "DSM_Access_Log";
const DSM_MONTH_CELL = "B1";
const DSM_REGION_CELL = "E1";
const DSM_UPDATED_CELL = "J1";

function onEdit(e) {
  if (!e || !e.range) return;
  const editedSheet = e.range.getSheet();
  const sheetName = editedSheet.getName();
  if (!sheetName.includes("Data") && !sheetName.includes("Định mức") && !sheetName.includes("Giá trị")) return;

  const report = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DSM_REPORT_SHEET_NAME);
  if (!report) return;

  report
    .getRange(DSM_UPDATED_CELL)
    .setValue("Cập nhật ngày: " + formatDateTime_(new Date()));
}

function doGet(e) {
  const payload = buildDsmReportData_(e);
  const json = JSON.stringify(payload);
  const callback = e && e.parameter && e.parameter.callback;

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function buildDsmReportData_(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (e && e.parameter && e.parameter.debugAuth) {
      return buildAuthDebug_(ss, e.parameter.authPhone);
    }

    const auth = authorizeDsmUser_(ss, e && e.parameter && e.parameter.authPhone);
    if (auth.authorized && e && e.parameter && e.parameter.authEvent === "login") {
      logDsmAccess_(ss, auth.user, e);
    }
    if (e && e.parameter && e.parameter.authOnly) {
      return {
        generatedAt: formatDateTime_(new Date()),
        auth: auth
      };
    }
    if (!auth.authorized) {
      return {
        generatedAt: formatDateTime_(new Date()),
        sourceSheet: DSM_REPORT_SHEET_NAME,
        auth: auth,
        capMauRows: [],
        summaryRows: [],
        error: "Bạn không có quyền truy cập chức năng này."
      };
    }

    const sheet = ss.getSheetByName(DSM_REPORT_SHEET_NAME);
    if (!sheet) {
      return {
        generatedAt: formatDateTime_(new Date()),
        sourceSheet: DSM_REPORT_SHEET_NAME,
        auth: auth,
        capMauRows: [],
        summaryRows: [],
        error: "Không tìm thấy sheet: " + DSM_REPORT_SHEET_NAME
      };
    }

    applyReportFilters_(sheet, e);

    const values = sheet.getDataRange().getDisplayValues();
    const headerRowIndex = findDsmHeaderRow_(values);
    const leftHeaders = values[headerRowIndex].slice(0, 10).map(value => String(value || "").trim());
    const rightHeaderStart = findRightSummaryStart_(values[headerRowIndex]);
    const rightHeaders = rightHeaderStart >= 0
      ? values[headerRowIndex].slice(rightHeaderStart, rightHeaderStart + 6).map(value => String(value || "").trim())
      : [];

    const selectedMonth = sheet.getRange(DSM_MONTH_CELL).getDisplayValue();
    const selectedRegion = sheet.getRange(DSM_REGION_CELL).getDisplayValue();
    const exportHistoryIndex = buildExportHistoryIndex_(ss, selectedMonth);

    const rows = values.slice(headerRowIndex + 1)
      .map(row => rowToObject_(leftHeaders, row.slice(0, 10)))
      .filter(row => row["Khách hàng"] && !String(row["Khách hàng"]).toLowerCase().startsWith("tổng"))
      .map(row => {
        const regionKey = makeHistoryKey_(row["Miền/Khu vực"], row["Khách hàng"]);
        const customerKey = makeCustomerHistoryKey_(row["Khách hàng"]);
        row.exportHistory = exportHistoryIndex[regionKey] || exportHistoryIndex[customerKey] || [];
        return row;
      });

    const summaryRows = rightHeaderStart >= 0
      ? values.slice(headerRowIndex + 1)
        .map(row => rowToObject_(rightHeaders, row.slice(rightHeaderStart, rightHeaderStart + 6)))
        .filter(row => row["Miền/Khu vực"])
      : [];

    return {
      generatedAt: formatDateTime_(new Date()),
      sourceSheet: DSM_REPORT_SHEET_NAME,
      auth: auth,
      selectedMonth: selectedMonth,
      selectedRegion: selectedRegion,
      updatedAt: sheet.getRange(DSM_UPDATED_CELL).getDisplayValue(),
      monthOptions: ["4/2026", "5/2026", "6/2026", "Tất cả"],
      regionOptions: ["Hồ Chí Minh", "Miền Đông", "Miền Tây", "Miền Trung", "OEM", "Miền Bắc", "Tất cả"],
      capMauRows: rows,
      summaryRows: summaryRows
    };
  } finally {
    lock.releaseLock();
  }
}

function applyReportFilters_(sheet, e) {
  const month = e && e.parameter && e.parameter.month ? String(e.parameter.month).trim() : "";
  const region = e && e.parameter && e.parameter.region ? String(e.parameter.region).trim() : "";

  if (month) sheet.getRange(DSM_MONTH_CELL).setValue(month);
  if (region) sheet.getRange(DSM_REGION_CELL).setValue(region);
  if (month || region) {
    SpreadsheetApp.flush();
    Utilities.sleep(250);
  }
}

function buildExportHistoryIndex_(ss, selectedMonth) {
  const sheet = ss.getSheetByName(DSM_DATA_SHEET_NAME);
  if (!sheet) return {};

  const values = sheet.getDataRange().getValues();
  const displays = sheet.getDataRange().getDisplayValues();
  const selected = parseMonth_(selectedMonth);
  const isAllMonths = normalizeDsmKey_(selectedMonth) === "TAT CA" || !selected;
  const index = {};

  for (let i = 1; i < values.length; i += 1) {
    const displayRow = displays[i] || [];
    const valueRow = values[i] || [];
    const customer = displayRow[4];
    const region = normalizeReportRegion_(displayRow[5]);
    const note = displayRow[7];
    const status = displayRow[10];
    const amount = toDsmNumber_(valueRow[11] !== "" ? valueRow[11] : displayRow[11]);
    const dateValue = valueRow[14];
    const dateDisplay = displayRow[14];
    const date = parseDate_(dateValue, dateDisplay);

    if (!customer || !amount) continue;
    if (!normalizeDsmKey_(note).includes("DSM")) continue;
    const statusKey = normalizeDsmKey_(status);
    if (statusKey === "DA HUY" || statusKey === "CHUA TAO PHIEU GIAO HANG") continue;
    if (!isAllMonths && (!date || date.getFullYear() !== selected.year || date.getMonth() + 1 !== selected.month)) continue;

    const item = {
      date: formatDateTime_(date) || dateDisplay || "",
      month: date ? (date.getMonth() + 1) + "/" + date.getFullYear() : "",
      amount: amount,
      amountText: displayRow[11] || String(amount),
      note: "Xuất DSM"
    };

    addHistoryItem_(index, makeHistoryKey_(region, customer), item);
    addHistoryItem_(index, makeCustomerHistoryKey_(customer), item);
  }

  Object.keys(index).forEach(key => {
    index[key].sort((a, b) => parseDate_(null, b.date) - parseDate_(null, a.date));
  });
  return index;
}

function addHistoryItem_(index, key, item) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(item);
}

function makeHistoryKey_(region, customer) {
  return normalizeDsmKey_(normalizeReportRegion_(region)) + "|" + normalizeDsmKey_(customer);
}

function makeCustomerHistoryKey_(customer) {
  return "KH|" + normalizeDsmKey_(customer);
}

function normalizeReportRegion_(region) {
  const key = normalizeDsmKey_(region);
  if (key === "DOC QUYEN") return "OEM";
  return String(region || "").trim();
}

function parseMonth_(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2})\s*[\/.-]\s*(\d{4})/);
  if (!match) return null;
  return { month: Number(match[1]), year: Number(match[2]) };
}

function parseDate_(value, display) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) return value;
  const text = String(display || value || "").trim();
  let match = text.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const year = match[3].length === 2 ? Number("20" + match[3]) : Number(match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  }
  match = text.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
}

function formatDate_(date) {
  if (!date) return "";
  return Utilities.formatDate(date, "GMT+7", "dd/MM/yyyy");
}

function formatDateTime_(date) {
  if (!date || Object.prototype.toString.call(date) !== "[object Date]" || isNaN(date)) return "";
  return Utilities.formatDate(date, "GMT+7", "dd/MM/yyyy HH:mm");
}

function authorizeDsmUser_(ss, phone) {
  const normalizedPhone = normalizePhone_(phone);
  const comparablePhone = normalizePhoneForCompare_(phone);
  if (!normalizedPhone) {
    return {
      authorized: false,
      reason: "missing_phone",
      message: "Bạn không có quyền truy cập chức năng này."
    };
  }

  const sheet = findSheetByNormalizedName_(ss, DSM_STAFF_SHEET_NAME);
  if (!sheet) {
    return {
      authorized: false,
      reason: "missing_staff_sheet",
      message: "Bạn không có quyền truy cập chức năng này."
    };
  }

  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) {
    return {
      authorized: false,
      reason: "empty_staff_sheet",
      message: "Bạn không có quyền truy cập chức năng này."
    };
  }

  const headerRowIndex = findStaffHeaderRow_(rows);
  const headers = rows[headerRowIndex].map(value => String(value || "").trim());
  const headerMap = buildHeaderMap_(headers);
  let phoneCol = findMappedColumn_(headerMap, ["SDT", "SĐT", "SO DIEN THOAI", "DIEN THOAI", "PHONE"]);
  let nameCol = findMappedColumn_(headerMap, ["HO TEN", "TEN", "NHAN SU", "NAME"]);
  const deptCol = findMappedColumn_(headerMap, ["PHONG BAN", "BO PHAN", "DEPARTMENT"]);
  const titleCol = findMappedColumn_(headerMap, ["CHUC DANH", "CHUC VU", "TITLE"]);
  const regionCol = findMappedColumn_(headerMap, ["KHU VUC", "MIEN/KHU VUC", "MIEN", "REGION"]);
  const roleCol = findMappedColumn_(headerMap, ["VAI TRO", "ROLE"]);
  const statusCol = findMappedColumn_(headerMap, ["TRANG THAI", "STATUS"]);
  const codeCol = findMappedColumn_(headerMap, ["CODE", "MA", "MA TRUY CAP"]);

  // Fallbacks for compact staff sheets if headers are edited later.
  if (phoneCol < 0) phoneCol = findLikelyPhoneColumn_(rows, headerRowIndex + 1);
  if (nameCol < 0) nameCol = findLikelyNameColumn_(rows, headerRowIndex + 1, phoneCol);

  if (phoneCol < 0) {
    return {
      authorized: false,
      reason: "missing_phone_column",
      message: "Bạn không có quyền truy cập chức năng này."
    };
  }

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const rowPhone = normalizePhone_(row[phoneCol]);
    if (rowPhone !== normalizedPhone && normalizePhoneForCompare_(row[phoneCol]) !== comparablePhone) continue;

    const status = statusCol >= 0 ? normalizeDsmKey_(row[statusCol]) : "ACTIVE";
    const isActive = !status || status === "ACTIVE" || status === "HOAT DONG" || status === "DANG LAM";
    if (!isActive) {
      return {
        authorized: false,
        reason: "inactive",
        message: "Bạn không có quyền truy cập chức năng này."
      };
    }

    return {
      authorized: true,
      user: {
        phone: normalizedPhone,
        name: nameCol >= 0 ? row[nameCol] : "",
        department: deptCol >= 0 ? row[deptCol] : "",
        title: titleCol >= 0 ? row[titleCol] : "",
        region: regionCol >= 0 ? row[regionCol] : "",
        role: roleCol >= 0 ? row[roleCol] : "User",
        status: statusCol >= 0 ? row[statusCol] : "Active",
      code: codeCol >= 0 ? String(row[codeCol] || "").trim() : ""
      }
    };
  }

  return {
    authorized: false,
    reason: "not_found",
    message: "Bạn không có quyền truy cập chức năng này."
  };
}

function findSheetByNormalizedName_(ss, expectedName) {
  const expectedKey = normalizeDsmKey_(expectedName);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i += 1) {
    if (normalizeDsmKey_(sheets[i].getName()) === expectedKey) return sheets[i];
  }
  return null;
}

function findStaffHeaderRow_(rows) {
  const required = ["SDT", "SĐT", "SO DIEN THOAI", "PHONE", "HO TEN", "TEN", "TRANG THAI", "VAI TRO"];
  let bestIndex = 0;
  let bestHits = -1;
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i += 1) {
    const normalized = (rows[i] || []).map(normalizeDsmKey_);
    const hits = required.filter(key => normalized.indexOf(normalizeDsmKey_(key)) !== -1).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestIndex = i;
    }
    if (hits >= 2) return i;
  }
  return bestIndex;
}

function findLikelyPhoneColumn_(rows, startRow) {
  const maxCols = Math.max.apply(null, rows.map(row => row.length));
  let bestCol = -1;
  let bestHits = 0;
  for (let col = 0; col < maxCols; col += 1) {
    let hits = 0;
    for (let row = startRow; row < Math.min(rows.length, startRow + 25); row += 1) {
      const phone = normalizePhone_(rows[row] && rows[row][col]);
      if (phone.length >= 9 && phone.length <= 11) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = col;
    }
  }
  return bestHits ? bestCol : -1;
}

function findLikelyNameColumn_(rows, startRow, phoneCol) {
  const maxCols = Math.max.apply(null, rows.map(row => row.length));
  let bestCol = -1;
  let bestHits = 0;
  for (let col = 0; col < maxCols; col += 1) {
    if (col === phoneCol) continue;
    let hits = 0;
    for (let row = startRow; row < Math.min(rows.length, startRow + 25); row += 1) {
      const text = String(rows[row] && rows[row][col] || "").trim();
      if (text && !/^\d+$/.test(text)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = col;
    }
  }
  return bestHits ? bestCol : -1;
}

function logDsmAccess_(ss, user, e) {
  let sheet = ss.getSheetByName(DSM_ACCESS_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DSM_ACCESS_LOG_SHEET_NAME);
    sheet.appendRow(["Thời gian", "SĐT", "Họ tên", "Phòng ban", "Chức danh", "Khu vực", "Vai trò", "Hành động"]);
  }
  sheet.appendRow([
    formatDateTime_(new Date()),
    user.phone || "",
    user.name || "",
    user.department || "",
    user.title || "",
    user.region || "",
    user.role || "",
    e && e.parameter && e.parameter.authEvent ? e.parameter.authEvent : "access"
  ]);
}

function buildHeaderMap_(headers) {
  const map = {};
  headers.forEach((header, index) => {
    const key = normalizeDsmKey_(header);
    if (key && map[key] === undefined) map[key] = index;
  });
  return map;
}

function findMappedColumn_(headerMap, aliases) {
  for (let i = 0; i < aliases.length; i += 1) {
    const key = normalizeDsmKey_(aliases[i]);
    if (headerMap[key] !== undefined) return headerMap[key];
  }
  return -1;
}

function normalizePhone_(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function normalizePhoneForCompare_(phone) {
  const digits = normalizePhone_(phone);
  return digits.replace(/^0+/, "");
}

function buildAuthDebug_(ss, phone) {
  const normalizedPhone = normalizePhone_(phone);
  const comparablePhone = normalizePhoneForCompare_(phone);
  const sheet = findSheetByNormalizedName_(ss, DSM_STAFF_SHEET_NAME);
  const auth = authorizeDsmUser_(ss, phone);

  if (!sheet) {
    return {
      generatedAt: formatDateTime_(new Date()),
      mode: "debugAuth",
      spreadsheetName: ss ? ss.getName() : "",
      sheetNames: ss ? ss.getSheets().map(sheetItem => sheetItem.getName()) : [],
      phoneInput: String(phone || ""),
      phoneNormalized: normalizedPhone,
      phoneCompare: comparablePhone,
      staffSheetFound: false,
      auth: auth
    };
  }

  const rows = sheet.getDataRange().getDisplayValues();
  const headerRowIndex = findStaffHeaderRow_(rows);
  const headers = rows[headerRowIndex] || [];
  const headerMap = buildHeaderMap_(headers);
  let phoneCol = findMappedColumn_(headerMap, ["SDT", "SĐT", "SO DIEN THOAI", "DIEN THOAI", "PHONE"]);
  let nameCol = findMappedColumn_(headerMap, ["HO TEN", "TEN", "NHAN SU", "NAME"]);
  const statusCol = findMappedColumn_(headerMap, ["TRANG THAI", "STATUS"]);

  if (phoneCol < 0) phoneCol = findLikelyPhoneColumn_(rows, headerRowIndex + 1);
  if (nameCol < 0) nameCol = findLikelyNameColumn_(rows, headerRowIndex + 1, phoneCol);

  const samples = rows.slice(headerRowIndex + 1, headerRowIndex + 9).map((row, index) => ({
    row: headerRowIndex + 2 + index,
    phoneRaw: phoneCol >= 0 ? row[phoneCol] : "",
    phoneNormalized: phoneCol >= 0 ? normalizePhone_(row[phoneCol]) : "",
    phoneCompare: phoneCol >= 0 ? normalizePhoneForCompare_(row[phoneCol]) : "",
    name: nameCol >= 0 ? row[nameCol] : "",
    status: statusCol >= 0 ? row[statusCol] : ""
  }));

  return {
    generatedAt: formatDateTime_(new Date()),
    mode: "debugAuth",
    spreadsheetName: ss ? ss.getName() : "",
    sheetNames: ss ? ss.getSheets().map(sheetItem => sheetItem.getName()) : [],
    phoneInput: String(phone || ""),
    phoneNormalized: normalizedPhone,
    phoneCompare: comparablePhone,
    staffSheetFound: true,
    staffSheetName: sheet.getName(),
    headerRow: headerRowIndex + 1,
    headers: headers,
    phoneCol: phoneCol + 1,
    nameCol: nameCol + 1,
    statusCol: statusCol + 1,
    sampleRows: samples,
    auth: auth
  };
}

function toDsmNumber_(value) {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  let text = String(value || "").trim();
  if (!text) return 0;
  text = text.replace(/[^\d,.-]/g, "");
  if (text.indexOf(",") >= 0 && text.indexOf(".") >= 0) text = text.replace(/\./g, "").replace(",", ".");
  else if (text.indexOf(".") >= 0) text = text.split(".").every((part, index) => index === 0 || part.length === 3) ? text.replace(/\./g, "") : text;
  else if (text.indexOf(",") >= 0) text = text.replace(",", ".");
  const number = Number(text);
  return isFinite(number) ? number : 0;
}

function findDsmHeaderRow_(values) {
  for (let i = 0; i < Math.min(values.length, 12); i += 1) {
    const normalized = values[i].map(normalizeDsmKey_);
    const hits = [
      "STT",
      "MIEN/KHU VUC",
      "KHACH HANG",
      "TON DAU KY",
      "DINH MUC PHAT SINH",
      "TONG DUOC SU DUNG",
      "DA XUAT THANG NAY",
      "TON CUOI KY",
      "VUOT DINH MUC",
      "TRANG THAI"
    ].filter(key => normalized.indexOf(key) !== -1).length;
    if (hits >= 4) return i;
  }
  return 2;
}

function findRightSummaryStart_(headerRow) {
  for (let i = 0; i < headerRow.length; i += 1) {
    const normalized = normalizeDsmKey_(headerRow[i]);
    const next = normalizeDsmKey_(headerRow[i + 1]);
    if (normalized === "STT" && next === "MIEN/KHU VUC" && i > 8) return i;
  }
  return -1;
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach((header, index) => {
    if (header) object[header] = row[index] || "";
  });
  return object;
}

function normalizeDsmKey_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
