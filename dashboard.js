const DEFAULT_SHEETS = ["Miền Tây","Miền Đông","Hồ Chí Minh","Miền Trung"];
const HEADER_SCAN    = 12;
const MAX_IMAGES     = 10;

const FIELD_ALIASES = {
  orderCode:   ["Mã phiếu","Mã đơn","Mã đơn hàng","Order Code"],
  date:        ["Ngày hiệu lực","Ngày tạo","Ngày","Ngày chứng từ"],
  sales:       ["Nhân viên kinh doanh","Nhân viên","Sales","Sale"],
  customer:    ["Khách hàng","Tên khách hàng","Customer"],
  area:        ["Khu vực","Miền/Khu vực","Miền","Region"],
  product:     ["Sản phẩm","Mã hàng","Tên hàng"],
  quantity:    ["Số lượng","SL"],
  note:        ["Ghi chú chung","Ghi chú","Nội dung","Note"],
  imageStatus: ["Trạng thái hình ảnh","MKT check","Trạng thái"],
  folderId:    ["Link thư mục Drive","Folder ID","Folder","Drive Folder","Link Drive"],
  lastUpdated: ["Ngày cập nhật cuối","Cập nhật cuối","Thời gian upload","Ngày cập nhật"],
  imageCount:  ["Số lượng ảnh","Số ảnh","Image Count","Ảnh"],
  approvedBy:  ["Người duyệt","Approved By"],
  approvedAt:  ["Ngày duyệt","Approved At"]
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify(body));
}

function norm(v) { return String(v||"").trim(); }

function normKey(v) {
  return norm(v).normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/g,"d").replace(/Đ/g,"D")
    .replace(/[_\-./]+/g," ").replace(/\s+/g," ").toUpperCase();
}

function extractFolderId(v) {
  const m = norm(v).match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

function col(headers, aliases) {
  const keys = new Set(aliases.map(normKey));
  return headers.findIndex(h=>keys.has(normKey(h)));
}

function detectHeader(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN);
  let best = {index:-1,score:0,indexes:{}};
  for (let i=0;i<limit;i++) {
    const headers=rows[i]||[];
    const indexes={};
    Object.entries(FIELD_ALIASES).forEach(([f,a])=>{indexes[f]=col(headers,a);});
    const score=[indexes.orderCode,indexes.customer,indexes.folderId,indexes.date,indexes.sales,indexes.area]
      .filter(x=>x>=0).length;
    if (score>best.score) best={index:i,score,indexes};
  }
  return best.score>=3 ? best : {index:-1,score:0,indexes:{}};
}

function getCell(row,i) { return i>=0?norm(row[i]):""; }

function shouldSkip(row,idx) {
  const note=normKey(getCell(row,idx.note));
  const st=normKey(getCell(row,idx.imageStatus));
  return note.includes("DSM")||st.includes("DSM");
}

// Trạng thái mới: Chờ duyệt thay cho Hợp lệ
function resolveStatus(count, folderError, isApproved) {
  if (folderError)       return "Lỗi folder";
  if (count<=0)          return "Chưa cập nhật";
  if (count>MAX_IMAGES)  return "Vượt giới hạn";
  if (isApproved)        return "Đã duyệt";
  return "Chờ duyệt";
}

function vnDateTime(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",hour12:false
  }).format(date).replace(",","");
}

function latestDate(files, fallback) {
  const latest = files[0]&&(files[0].modifiedTime||files[0].createdTime);
  return latest ? vnDateTime(new Date(latest)) : norm(fallback);
}

async function listFiles(drive, folderId) {
  const files=[];
  let pageToken;
  do {
    const r = await drive.files.list({
      q:`'${folderId}' in parents and trashed=false and mimeType contains 'image/'`,
      fields:"nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,createdTime,modifiedTime)",
      pageSize:1000, pageToken,
      supportsAllDrives:true, includeItemsFromAllDrives:true
    });
    files.push(...(r.data.files||[]));
    pageToken=r.data.nextPageToken;
  } while(pageToken);
  files.sort((a,b)=>new Date(b.modifiedTime||b.createdTime||0)-new Date(a.modifiedTime||a.createdTime||0));
  return files;
}

module.exports = async function handler(req, res) {
  if (req.method && req.method!=="GET") { json(res,405,{error:"Method not allowed."}); return; }

  try {
    // ── Proxy mode ─────────────────────────────────────────────────
    if (process.env.APPS_SCRIPT_API_URL) {
      const r = await fetch(process.env.APPS_SCRIPT_API_URL);
      const text = await r.text();
      const isJson = text.trim().startsWith("{");
      res.statusCode = r.ok&&isJson?200:502;
      res.setHeader("Content-Type","application/json; charset=utf-8");
      res.setHeader("Cache-Control","no-store");
      res.end(isJson?text:JSON.stringify({
        error:"Apps Script chưa trả JSON.",status:r.status,preview:text.slice(0,180)
      }));
      return;
    }

    // ── Direct Google API ────────────────────────────────────────────
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) { json(res,500,{error:"Thiếu SPREADSHEET_ID."}); return; }

    const sheetNames = (process.env.SHEET_NAMES||DEFAULT_SHEETS.join(","))
      .split(",").map(n=>n.trim()).filter(Boolean);

    const {google}  = require("googleapis");
    const {getAuth} = require("./google-auth");
    const auth      = getAuth([
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly"
    ]);
    const sheetsApi = google.sheets({version:"v4",auth});
    const drive     = google.drive({version:"v3",auth});

    const sheetResp = await sheetsApi.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: sheetNames.map(n=>`'${n.replace(/'/g,"''")}'!A:AZ`),
      majorDimension:"ROWS"
    });

    const folderCache = new Map();
    const orders      = [];

    for (const vr of sheetResp.data.valueRanges||[]) {
      const m = vr.range.match(/^'?(.*?)'?!/);
      const sheetName = m?m[1].replace(/''/g,"'"):"";
      const rows = vr.values||[];
      const hi = detectHeader(rows);
      if (hi.index<0) continue;
      const idx = hi.indexes;
      const seen = new Set();

      for (let r=hi.index+1;r<rows.length;r++) {
        const row      = rows[r]||[];
        const orderCode= getCell(row,idx.orderCode);
        const folderId = extractFolderId(getCell(row,idx.folderId));
        const customer = getCell(row,idx.customer);
        if (!orderCode||!folderId||shouldSkip(row,idx)) continue;
        const key=`${sheetName}|${orderCode}|${folderId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let files=[], error="";
        try {
          if (!folderCache.has(folderId)) folderCache.set(folderId,await listFiles(drive,folderId));
          files=folderCache.get(folderId);
        } catch(err) { error=err.message||"Không đọc được folder."; }

        const imageCount  = files.length;
        const rawStatus   = getCell(row,idx.imageStatus);
        const isApproved  = rawStatus==="Đã duyệt";
        const status      = resolveStatus(imageCount, Boolean(error), isApproved);
        const area        = getCell(row,idx.area)||sheetName;

        orders.push({
          id:              `${sheetName}-${r}-${orderCode}`,
          sheet:           area,
          sourceSheet:     sheetName,
          rowNumber:       r+1,
          orderCode,
          date:            getCell(row,idx.date),
          sales:           getCell(row,idx.sales),
          customer,
          area,
          product:         getCell(row,idx.product),
          quantity:        getCell(row,idx.quantity),
          folderId,
          imageCount,
          imageLimit:      MAX_IMAGES,
          imageMin:        1,
          lastImageUpdate: latestDate(files,getCell(row,idx.lastUpdated)),
          approved:        isApproved,
          approvedBy:      getCell(row,idx.approvedBy),
          approvedAt:      getCell(row,idx.approvedAt),
          status,
          note:            error||(imageCount>0?"":"Chưa có hình: "+orderCode),
          images: files.map(f=>({
            id:           f.id,
            name:         f.name,
            mimeType:     f.mimeType,
            createdAt:    vnDateTime(new Date(f.createdTime||f.modifiedTime)),
            updatedAt:    vnDateTime(new Date(f.modifiedTime||f.createdTime)),
            thumbnailUrl: `/api/image?id=${encodeURIComponent(f.id)}&thumb=1`,
            imageUrl:     `/api/image?id=${encodeURIComponent(f.id)}`,
            webViewLink:  f.webViewLink||""
          }))
        });
      }
    }

    const summary = {
      total:         orders.length,
      missing:       orders.filter(o=>o.imageCount===0).length,
      pendingReview: orders.filter(o=>o.imageCount>=1&&!o.approved).length,
      approved:      orders.filter(o=>o.approved).length,
      folderErrors:  orders.filter(o=>o.status==="Lỗi folder").length
    };

    const byRegion = sheetNames.map(n=>{
      const ro=orders.filter(o=>o.sourceSheet===n||o.sheet===n);
      return {
        region:n,total:ro.length,
        missing:ro.filter(o=>o.imageCount===0).length,
        pendingReview:ro.filter(o=>o.imageCount>=1&&!o.approved).length,
        approved:ro.filter(o=>o.approved).length
      };
    });

    json(res,200,{
      generatedAt: vnDateTime(new Date()),
      sheetNames, summary, byRegion, orders
    });

  } catch(err) {
    json(res,500,{error:err.message||"Không tải được dashboard."});
  }
};
