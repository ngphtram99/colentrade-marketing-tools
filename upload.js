const { Readable } = require("stream");

const MAX_IMAGES = 10;
const MIN_IMAGES = 1;
const HEADER_SCAN = 12;

const FIELD_ALIASES = {
  orderCode:   ["Mã phiếu","Mã đơn","Mã đơn hàng","Order Code"],
  imageStatus: ["Trạng thái hình ảnh","MKT check","Trạng thái"],
  folderId:    ["Link thư mục Drive","Folder ID","Folder","Drive Folder","Link Drive"],
  lastUpdated: ["Ngày cập nhật cuối","Cập nhật cuối","Thời gian upload","Ngày cập nhật"],
  imageCount:  ["Số lượng ảnh","Số ảnh","Image Count","Ảnh"],
  approvedBy:  ["Người duyệt","Approved By"],
  approvedAt:  ["Ngày duyệt","Approved At"]
};

// ── Helpers ──────────────────────────────────────────────────────────

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function norm(v) { return String(v || "").trim(); }

function normKey(v) {
  return norm(v).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g,"d").replace(/Đ/g,"D")
    .replace(/[_\-./]+/g," ").replace(/\s+/g," ").toUpperCase();
}

function normPhone(v) { return String(v||"").replace(/[^\d]/g,"").replace(/^0+/,""); }

function colLetter(i) {
  let n=i+1, r="";
  while(n>0){const m=(n-1)%26;r=String.fromCharCode(65+m)+r;n=Math.floor((n-m)/26);}
  return r;
}

function col(headers, aliases) {
  const keys = new Set(aliases.map(normKey));
  return headers.findIndex(h => keys.has(normKey(h)));
}

function detectHeader(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN);
  let best = { index:-1, score:0, indexes:{} };
  for (let i=0;i<limit;i++) {
    const headers = rows[i]||[];
    const indexes = {};
    Object.entries(FIELD_ALIASES).forEach(([f,a]) => { indexes[f]=col(headers,a); });
    const score = [indexes.orderCode,indexes.folderId,indexes.imageStatus]
      .filter(x=>x>=0).length;
    if (score>best.score) best={index:i,score,indexes};
  }
  return best.score>=1 ? best : {index:-1,score:0,indexes:{}};
}

function resolveStatus(count, approved) {
  if (count<=0)        return "Chưa cập nhật";
  if (count>MAX_IMAGES) return "Vượt giới hạn";
  if (approved)        return "Đã duyệt";
  return "Chờ duyệt";
}

function vnDateTime(date) {
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",hour12:false
  }).format(date).replace(",","");
}

function safeFile(v) {
  return norm(v).replace(/[\\/:*?"<>|]+/g,"-").slice(0,120)||"image";
}

function getWeek() {
  const now=new Date();
  const day=now.getDay();
  const diff=now.getDate()-day+(day===0?-6:1);
  const mon=new Date(now.setDate(diff));
  const wn=String(Math.ceil(((mon-new Date(mon.getFullYear(),0,1))/86400000+1)/7)).padStart(2,"0");
  return `W${wn}_${mon.getFullYear()}`;
}

async function readBody(req) {
  if (req.body && typeof req.body==="object") return req.body;
  if (typeof req.body==="string") return JSON.parse(req.body||"{}");
  const chunks=[];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
}

async function listImages(drive, folderId) {
  const files=[];
  let pageToken;
  do {
    const r = await drive.files.list({
      q:`'${folderId}' in parents and trashed=false and mimeType contains 'image/'`,
      fields:"nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime)",
      pageSize:1000, pageToken,
      supportsAllDrives:true, includeItemsFromAllDrives:true
    });
    files.push(...(r.data.files||[]));
    pageToken=r.data.nextPageToken;
  } while(pageToken);
  return files;
}

async function updateSheetRow(google, auth, body, imageCount, status, updatedAt, approvedBy, approvedAt) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId || !body.sourceSheet) return;

  const sheetsApi = google.sheets({version:"v4",auth});
  const range = `'${body.sourceSheet.replace(/'/g,"''")}'!A:AZ`;
  const resp = await sheetsApi.spreadsheets.values.get({spreadsheetId,range,majorDimension:"ROWS"});
  const rows = resp.data.values||[];
  const hi = detectHeader(rows);
  if (hi.index<0) return;

  let targetRow = Number(body.rowNumber||0);
  if (!targetRow) {
    const oc = hi.indexes.orderCode;
    const found = rows.findIndex((r,i)=>i>hi.index && norm(r[oc])===norm(body.orderCode));
    if (found>=0) targetRow=found+1;
  }
  if (!targetRow) return;

  const esc = body.sourceSheet.replace(/'/g,"''");
  const updates = [];
  const set = (field, value) => {
    if (hi.indexes[field]>=0 && value!==undefined && value!==null)
      updates.push({
        range:`'${esc}'!${colLetter(hi.indexes[field])}${targetRow}`,
        values:[[value]]
      });
  };

  set("imageStatus",  status);
  set("lastUpdated",  updatedAt);
  set("imageCount",   imageCount);
  set("approvedBy",   approvedBy||"");
  set("approvedAt",   approvedAt||"");

  if (!updates.length) return;
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody:{ valueInputOption:"USER_ENTERED", data:updates }
  });
}

// ── Verify nhân viên từ sheet Data_Nhan_Su (chỉ dùng khi cần kiểm tra MKT) ─

async function lookupStaff(google, auth, phone) {
  const spreadsheetId = process.env.DSM_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
  if (!spreadsheetId) return null;
  const normP = normPhone(phone);
  const sheetsApi = google.sheets({version:"v4",auth});
  const resp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range:"Data_Nhan_Su!A:H",
    majorDimension:"ROWS"
  });
  const rows = resp.data.values||[];
  if (!rows.length) return null;
  const hMap = {};
  rows[0].forEach((h,i)=>{ const k=normKey(h); if(k) hMap[k]=i; });
  const phoneCol  = hMap["SDT"]||hMap["SO DIEN THOAI"]||hMap["PHONE"]||1;
  const nameCol   = hMap["HO TEN"]||hMap["TEN"]||2;
  const roleCol   = hMap["VAI TRO"]||hMap["ROLE"]||6;
  const statusCol = hMap["TRANG THAI"]||hMap["STATUS"]||7;

  for (let i=1;i<rows.length;i++) {
    const row=rows[i]||[];
    if (normPhone(row[phoneCol])!==normP) continue;
    const status = normKey(row[statusCol]||"");
    const active = !status||["ACTIVE","HOAT DONG"].includes(status);
    return {
      active,
      name:  norm(row[nameCol]),
      role:  norm(row[roleCol]),
      isMkt: normKey(row[roleCol]||"").includes("MKT")
    };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  if (req.method!=="POST") { json(res,405,{error:"Method not allowed."}); return; }

  try {
    const body       = await readBody(req);
    const action     = norm(body.action||"upload");
    const orderCode  = norm(body.orderCode);
    const folderId   = norm(body.folderId);

    // ── Proxy sang Apps Script nếu có APPS_SCRIPT_API_URL ────────────
    if (process.env.APPS_SCRIPT_API_URL) {
      const r = await fetch(process.env.APPS_SCRIPT_API_URL, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      const text = await r.text();
      const isJson = text.trim().startsWith("{");
      json(res, r.ok&&isJson?200:502, isJson?JSON.parse(text):{error:"Apps Script error",preview:text.slice(0,200)});
      return;
    }

    // ── Direct Google API ─────────────────────────────────────────────
    const { google }   = require("googleapis");
    const { getAuth }  = require("./google-auth");
    const auth         = getAuth([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets"
    ]);
    const drive = google.drive({version:"v3",auth});

    // ── APPROVE (chỉ MKT) ────────────────────────────────────────────
    if (action==="approve" || action==="unapprove") {
      const phone = norm(body.phone);
      const staff = await lookupStaff(google, auth, phone);
      if (!staff)        { json(res,403,{error:"Không tìm thấy nhân viên."}); return; }
      if (!staff.active) { json(res,403,{error:"Tài khoản không còn hoạt động."}); return; }
      if (!staff.isMkt)  { json(res,403,{error:"Chỉ nhân viên MKT mới được duyệt hình."}); return; }

      const currentFiles = await listImages(drive, folderId);
      const imageCount   = currentFiles.length;
      if (action==="approve" && imageCount<MIN_IMAGES) {
        json(res,400,{error:`Phiếu phải có ít nhất ${MIN_IMAGES} hình trước khi duyệt.`}); return;
      }

      const isApprove  = action==="approve";
      const status     = isApprove ? "Đã duyệt" : resolveStatus(imageCount, false);
      const updatedAt  = vnDateTime(new Date());
      const approvedBy = isApprove ? `${staff.name} (${normPhone(phone)})` : "";
      const approvedAt = isApprove ? updatedAt : "";

      await updateSheetRow(google,auth,body,imageCount,status,updatedAt,approvedBy,approvedAt);
      json(res,200,{approved:isApprove,status,imageCount,approvedBy,approvedAt});
      return;
    }

    // ── UPLOAD ───────────────────────────────────────────────────────
    const files = Array.isArray(body.files)?body.files:[];
    if (!orderCode||!folderId||!files.length) {
      json(res,400,{error:"Thiếu mã phiếu, folder Drive hoặc file ảnh."}); return;
    }

    const currentFiles = await listImages(drive, folderId);
    if (currentFiles.length>=MAX_IMAGES) {
      json(res,400,{error:"Phiếu đã đạt giới hạn tối đa 10 hình ảnh."}); return;
    }
    if (currentFiles.length+files.length>MAX_IMAGES) {
      json(res,400,{error:`Upload này vượt giới hạn. Hiện có ${currentFiles.length} hình, tối đa ${MAX_IMAGES}.`}); return;
    }

    const customer  = norm(body.customer||"");
    const week      = getWeek();
    const stamp     = new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const prefix    = [week, safeFile(orderCode), safeFile(customer)].filter(Boolean).join("_");
    const uploaded  = [];

    for (const file of files) {
      const mimeType = norm(file.type)||"image/jpeg";
      const buffer   = Buffer.from(String(file.data||""),"base64");
      if (!buffer.length) continue;
      const name = `${prefix}_${stamp}_${safeFile(file.name||"image.jpg")}`;
      const created = await drive.files.create({
        requestBody:{ name, parents:[folderId], mimeType },
        media:{ mimeType, body:Readable.from(buffer) },
        fields:"id,name,mimeType,webViewLink,createdTime,modifiedTime",
        supportsAllDrives:true
      });
      uploaded.push(created.data);
    }

    const imageCount = currentFiles.length+uploaded.length;
    const status     = resolveStatus(imageCount, false); // upload mới → Chờ duyệt
    const updatedAt  = vnDateTime(new Date());

    await updateSheetRow(google,auth,body,imageCount,status,updatedAt,"","");

    json(res,200,{uploaded:uploaded.length,imageCount,status,updatedAt,files:uploaded});

  } catch(err) {
    json(res,500,{error:err.message||"Upload không thành công."});
  }
};
