const state = {
  data: null,
  activeTab: "overview",
  selectedOrderId: "",
  region: "",
  status: "",
  search: "",
  dateFrom: "",
  dateTo: ""
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: {
    overview: document.getElementById("overviewPanel"),
    orders: document.getElementById("ordersPanel"),
    missing: document.getElementById("missingPanel"),
    gallery: document.getElementById("galleryPanel")
  },
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  regionFilter: document.getElementById("regionFilter"),
  statusFilter: document.getElementById("statusFilter"),
  dateFromInput: document.getElementById("dateFromInput"),
  dateToInput: document.getElementById("dateToInput"),
  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  lastUpdated: document.getElementById("lastUpdated"),
  errorBox: document.getElementById("errorBox"),
  totalMetric: document.getElementById("totalMetric"),
  reportedMetric: document.getElementById("reportedMetric"),
  notReportedMetric: document.getElementById("notReportedMetric"),
  missingMetric: document.getElementById("missingMetric"),
  pendingMetric: document.getElementById("pendingMetric"),
  rateMetric: document.getElementById("rateMetric"),
  folderErrorMetric: document.getElementById("folderErrorMetric"),
  systemStatus: document.getElementById("systemStatus"),
  regionGrid: document.getElementById("regionGrid"),
  ordersBody: document.getElementById("ordersBody"),
  missingBody: document.getElementById("missingBody"),
  galleryOrders: document.getElementById("galleryOrders"),
  galleryTitle: document.getElementById("galleryTitle"),
  galleryMeta: document.getElementById("galleryMeta"),
  imageGrid: document.getElementById("imageGrid"),
  openFolderLink: document.getElementById("openFolderLink"),
  approveBtn: document.getElementById("approveBtn"),
  rejectBtn: document.getElementById("rejectBtn"),
  previewDialog: document.getElementById("previewDialog"),
  previewImage: document.getElementById("previewImage"),
  closePreview: document.getElementById("closePreview")
};

const tabTitles = {
  overview: ["Tổng quan", "Tiến độ hình ảnh và việc cần xử lý"],
  orders: ["Tất cả phiếu", "Theo dõi từng mã đơn hàng"],
  missing: ["Cần xử lý", "Các phiếu thiếu hình hoặc lỗi folder"],
  gallery: ["Duyệt hình", "Xem nhanh hình ảnh Kinh Doanh đã upload"]
};

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(value || 0);
}

function formatVietnamDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(direct).replace(",", "");
  }
  return text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showError(message) {
  els.errorBox.hidden = !message;
  els.errorBox.textContent = message || "";
}

// API mới dùng sourceSheet, cũ dùng sheet — normalize
function getSheet(order) { return order.sourceSheet || order.sheet || ""; }

function getOperationalStatus(order) {
  if (order.status === "Lỗi folder") return "Lỗi folder";
  if (order.imageCount === 0) return "Thiếu hình";
  if (!order.approved) return "Chờ duyệt";
  return "Đã duyệt";
}

function matchesStatus(order) {
  if (!state.status) return true;
  if (state.status === "missing") return order.imageCount === 0 && order.status !== "Lỗi folder";
  if (state.status === "uploaded") return order.imageCount > 0;
  if (state.status === "pending") return order.imageCount > 0 && !order.approved;
  if (state.status === "error") return order.status === "Lỗi folder";
  return true;
}

function getFilteredOrders() {
  if (!state.data) return [];

  const search = state.search.toLowerCase();
  const fromTime = state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`).getTime() : null;
  const toTime = state.dateTo ? new Date(`${state.dateTo}T23:59:59`).getTime() : null;

  return state.data.orders.filter(order => {
    const matchesRegion = !state.region || getSheet(order) === state.region;
    const orderTime = parseOrderDate(order.date);
    const searchText = [
      order.orderCode,
      order.customer,
      order.sales,
      order.area,
      order.product
    ].join(" ").toLowerCase();

    const matchesDateFrom = !fromTime || !orderTime || orderTime >= fromTime;
    const matchesDateTo = !toTime || !orderTime || orderTime <= toTime;

    return matchesRegion && matchesStatus(order) && matchesDateFrom && matchesDateTo && (!search || searchText.includes(search));
  });
}

function parseOrderDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? null : direct.getTime();
}

function renderOverview() {
  const orders = getFilteredOrders();
  const summary = {
    total: orders.length,
    reported: orders.filter(order => order.imageCount > 0).length,
    notReported: orders.filter(order => order.imageCount === 0 && order.status !== "Lỗi folder").length,
    missingImages: orders.filter(order => order.imageCount === 0).length,
    pendingReview: orders.filter(order => order.imageCount > 0 && !order.approved).length,
    folderErrors: orders.filter(order => order.status === "Lỗi folder").length
  };
  const uploadRate = summary.total ? Math.round((summary.reported / summary.total) * 100) : 0;

  els.totalMetric.textContent = formatNumber(summary.total);
  els.reportedMetric.textContent = formatNumber(summary.reported);
  els.notReportedMetric.textContent = formatNumber(summary.notReported);
  els.missingMetric.textContent = formatNumber(summary.missingImages);
  els.pendingMetric.textContent = formatNumber(summary.pendingReview);
  els.rateMetric.textContent = `${uploadRate}%`;
  els.folderErrorMetric.textContent = formatNumber(summary.folderErrors);
  els.systemStatus.textContent = summary.folderErrors > 0 ? "Có lỗi cần kiểm tra" : "Ổn định";

  const regions = state.data.sheetNames
    .filter(sheetName => !state.region || sheetName === state.region)
    .map(sheetName => {
      const regionOrders = orders.filter(order => getSheet(order) === sheetName);
      const total = regionOrders.length;
      const reported = regionOrders.filter(order => order.imageCount > 0).length;
      const missing = regionOrders.filter(order => order.imageCount === 0).length;
      const percent = total ? Math.round((reported / total) * 100) : 0;

      return { sheetName, total, reported, missing, percent };
    });

  els.regionGrid.innerHTML = regions.map(region => `
    <article class="region-card">
      <h3>${escapeHtml(region.sheetName)}</h3>
      <div class="bar"><span style="width: ${region.percent}%"></span></div>
      <div class="region-stats">
        <span>${formatNumber(region.reported)}/${formatNumber(region.total)} upload</span>
        <span>${formatNumber(region.missing)} thiếu</span>
      </div>
    </article>
  `).join("");

}

function statusClass(status) {
  if (status === "Thiếu hình") return "missing";
  if (status === "Lỗi folder") return "error";
  if (status === "Chờ duyệt") return "pending";
  return "";
}

function renderOrders() {
  const orders = getFilteredOrders();

  if (!orders.length) {
    els.ordersBody.innerHTML = `<tr><td colspan="9"><div class="empty">Không có phiếu phù hợp.</div></td></tr>`;
    return;
  }

  els.ordersBody.innerHTML = orders.map(order => {
    const st = getOperationalStatus(order);
    const hasFolder = Boolean(order.folderId);
    let actionBtn = "";
    if (!hasFolder) {
      actionBtn = `<span style="color:#89a8ba;font-size:12px">Chưa có folder</span>`;
    } else if (order.imageCount === 0) {
      actionBtn = `<button class="upload-btn" data-upload="${escapeHtml(order.id)}">+ Đăng tải</button>`;
    } else if (order.imageCount < (order.imageLimit || 10)) {
      actionBtn = `
        <button class="view-btn" data-view="${escapeHtml(order.id)}">Xem (${order.imageCount})</button>
        <button class="upload-btn small" data-upload="${escapeHtml(order.id)}">＋</button>`;
    } else {
      actionBtn = `<button class="view-btn" data-view="${escapeHtml(order.id)}">Xem (${order.imageCount})</button>`;
    }
    return `
    <tr>
      <td><strong>${escapeHtml(order.orderCode)}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(getSheet(order))}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.sales)}</td>
      <td>${escapeHtml(order.product)}</td>
      <td>${formatNumber(order.imageCount)}</td>
      <td><span class="status ${statusClass(st)}">${escapeHtml(st)}</span></td>
      <td style="display:flex;gap:6px;align-items:center">${actionBtn}</td>
    </tr>`;
  }).join("");
}

function renderMissing() {
  const missing = getFilteredOrders().filter(order => order.imageCount === 0 || order.status === "Lỗi folder");

  if (!missing.length) {
    els.missingBody.innerHTML = `<tr><td colspan="6"><div class="empty">Không có phiếu cần xử lý.</div></td></tr>`;
    return;
  }

  els.missingBody.innerHTML = missing.map(order => `
    <tr>
      <td><strong>${escapeHtml(order.orderCode)}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(getSheet(order))}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.sales)}</td>
      <td>${escapeHtml(order.note)}</td>
    </tr>
  `).join("");
}

function selectOrder(orderId) {
  const order = state.data && state.data.orders.find(item => item.id === orderId);
  state.selectedOrderId = orderId;

  if (order && order.imageCount > 0) {
    setTab("gallery");
    renderGallery();
    return;
  }

  setTab("missing");
  renderMissing();
}

function renderGallery() {
  const orders = getFilteredOrders().filter(order => order.imageCount > 0);
  const selected = orders.find(order => order.id === state.selectedOrderId) || orders[0];

  if (selected && !state.selectedOrderId) {
    state.selectedOrderId = selected.id;
  }

  els.galleryOrders.innerHTML = orders.length
    ? orders.map(order => `
      <button class="order-item ${order.id === state.selectedOrderId ? "is-active" : ""}" data-select="${escapeHtml(order.id)}">
        <strong>${escapeHtml(order.orderCode)}</strong>
        <span>${escapeHtml(order.customer || getSheet(order))} · ${escapeHtml(getOperationalStatus(order))} · ${formatNumber(order.imageCount)} ảnh</span>
      </button>
    `).join("")
    : `<div class="empty">Chưa có đơn nào có ảnh.</div>`;

  if (!selected) {
    els.galleryTitle.textContent = "Chọn một đơn để xem ảnh";
    els.galleryMeta.textContent = "";
    els.imageGrid.innerHTML = "";
    els.openFolderLink.hidden = true;
    els.approveBtn.hidden = true;
    els.rejectBtn.hidden = true;
    return;
  }

  els.galleryTitle.textContent = `${selected.orderCode} · ${getOperationalStatus(selected)}`;
  els.galleryMeta.textContent = [selected.customer, selected.sales, getSheet(selected), selected.date].filter(Boolean).join(" · ");
  els.openFolderLink.href = `https://drive.google.com/drive/folders/${encodeURIComponent(selected.folderId)}`;
  els.openFolderLink.hidden = false;

  const opStatus = getOperationalStatus(selected);
  const needReview = opStatus === "Chờ duyệt";
  els.approveBtn.hidden = !needReview;
  els.rejectBtn.hidden = !needReview;
  els.approveBtn.onclick = () => doReviewAction(selected, "approved");
  els.rejectBtn.onclick = () => doReviewAction(selected, "rejected");

  els.imageGrid.innerHTML = selected.images.map(image => `
    <article class="image-card">
      <button data-preview="${escapeHtml(image.imageUrl)}" aria-label="Xem lớn ${escapeHtml(image.name)}">
        <img src="${escapeHtml(image.thumbnailUrl)}" alt="${escapeHtml(image.name)}" loading="lazy" />
      </button>
      <p>${escapeHtml(image.name)}</p>
    </article>
  `).join("");
}

function renderRegionOptions() {
  const current = state.region;
  els.regionFilter.innerHTML = `<option value="">Tất cả</option>${state.data.sheetNames.map(name => `
    <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
  `).join("")}`;
  els.regionFilter.value = current;
}

function render() {
  if (!state.data) return;

  renderRegionOptions();
  renderOverview();
  renderOrders();
  renderMissing();
  renderGallery();
}

function setTab(tabName) {
  state.activeTab = tabName;
  els.tabs.forEach(tab => tab.classList.toggle("is-active", tab.dataset.tab === tabName));
  Object.entries(els.panels).forEach(([name, panel]) => {
    panel.classList.toggle("is-active", name === tabName);
  });

  const [title, subtitle] = tabTitles[tabName];
  els.pageTitle.textContent = title;
  els.pageSubtitle.textContent = subtitle;
}

async function loadData() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "Đang tải...";
  showError("");

  try {
    const response = await fetch("/api/dashboard");
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };

    if (!response.ok) {
      throw new Error(data.error || "Không tải được dữ liệu.");
    }

    state.data = data;
    els.lastUpdated.textContent = `Cập nhật: ${formatVietnamDateTime(data.generatedAt)}`;
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "Tải lại dữ liệu";
  }
}

els.tabs.forEach(tab => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

els.regionFilter.addEventListener("change", event => {
  state.region = event.target.value;
  state.selectedOrderId = "";
  render();
});

els.statusFilter.addEventListener("change", event => {
  state.status = event.target.value;
  state.selectedOrderId = "";
  render();
});

els.searchInput.addEventListener("input", event => {
  state.search = event.target.value;
  state.selectedOrderId = "";
  render();
});

els.dateFromInput.addEventListener("change", event => {
  state.dateFrom = event.target.value;
  state.selectedOrderId = "";
  render();
});

els.dateToInput.addEventListener("change", event => {
  state.dateTo = event.target.value;
  state.selectedOrderId = "";
  render();
});

els.refreshBtn.addEventListener("click", loadData);

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  const selectButton = event.target.closest("[data-select]");
  const previewButton = event.target.closest("[data-preview]");

  if (viewButton) selectOrder(viewButton.dataset.view);
  if (selectButton) {
    state.selectedOrderId = selectButton.dataset.select;
    renderGallery();
  }
  if (previewButton) {
    els.previewImage.src = previewButton.dataset.preview;
    els.previewDialog.showModal();
  }
});

els.closePreview.addEventListener("click", () => {
  els.previewDialog.close();
  els.previewImage.src = "";
});

loadData();
setInterval(loadData, 10 * 60 * 1000);

/* ─── REVIEW (Duyệt / Từ chối) ─── */

async function doReviewAction(order, action) {
  const phone = prompt("Nhập số điện thoại của bạn (nhân viên Marketing) để xác nhận:");
  if (!phone) return;

  let note = "";
  if (action === "rejected") {
    note = prompt("Lý do từ chối (không bắt buộc):") || "";
  }

  const btn = action === "approved" ? els.approveBtn : els.rejectBtn;
  const otherBtn = action === "approved" ? els.rejectBtn : els.approveBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  otherBtn.disabled = true;
  btn.textContent = "Đang xử lý...";

  try {
    const resp = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review",
        orderCode: order.orderCode,
        reviewAction: action,
        reviewNote: note,
        reviewerPhone: phone
      })
    });
    const result = await resp.json();
    if (result.error) { alert("Lỗi: " + result.error); return; }

    alert(`✓ Phiếu ${result.orderCode} đã ${result.status}${result.reviewer ? " bởi " + result.reviewer : ""}`);

    const idx = state.data.orders.findIndex(o => o.id === order.id);
    if (idx >= 0) {
      state.data.orders[idx].status = result.status;
      state.data.orders[idx].approved = action === "approved";
    }
    render();
  } catch (e) {
    alert("Thao tác thất bại: " + e.message);
  } finally {
    btn.disabled = false;
    otherBtn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ─── UPLOAD MODAL ─── */
let uploadOrder = null;
let uploadFiles = [];

function openUploadModal(orderId) {
  uploadOrder = state.data && state.data.orders.find(o => o.id === orderId);
  if (!uploadOrder) return;
  uploadFiles = [];

  const limit = uploadOrder.imageLimit || 10;
  const existing = uploadOrder.imageCount || 0;
  const remaining = limit - existing;

  document.getElementById("uploadModalTitle").textContent = `Upload ảnh — ${uploadOrder.orderCode}`;
  document.getElementById("uploadModalMeta").textContent =
    `${uploadOrder.customer} · ${getSheet(uploadOrder)} · ${existing}/${limit} ảnh`;
  document.getElementById("uploadPreviewGrid").innerHTML = "";
  document.getElementById("uploadSuccessBox").hidden = true;
  document.getElementById("uploadSubmitBtn").hidden = true;
  document.getElementById("uploadWarn").hidden = true;

  const dz = document.getElementById("uploadDropzone");
  if (remaining <= 0) {
    dz.innerHTML = `<p style="color:#f59e0b">Phiếu đã đủ ${limit} ảnh, không thể upload thêm.</p>`;
    dz.onclick = null;
  } else {
    dz.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p>Kéo thả ảnh vào đây hoặc <strong>bấm để chọn</strong></p>
      <small>Còn có thể thêm ${remaining} ảnh</small>
      <input type="file" id="uploadFileInput" accept="image/*" multiple style="display:none">
    `;
    dz.onclick = () => document.getElementById("uploadFileInput").click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add("dz-over"); };
    dz.ondragleave = () => dz.classList.remove("dz-over");
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove("dz-over"); handleUploadFiles(e.dataTransfer.files); };
    setTimeout(() => {
      const fi = document.getElementById("uploadFileInput");
      if (fi) fi.onchange = e => handleUploadFiles(e.target.files);
    }, 50);
  }

  document.getElementById("uploadModal").showModal();
}

function handleUploadFiles(fileList) {
  if (!uploadOrder) return;
  const limit = uploadOrder.imageLimit || 10;
  const existing = uploadOrder.imageCount || 0;
  const remaining = limit - existing - uploadFiles.length;
  if (remaining <= 0) return;

  const toAdd = Array.from(fileList).slice(0, remaining);
  Promise.all(toAdd.map(f => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res({ file: f, dataUrl: r.result });
    r.readAsDataURL(f);
  }))).then(results => {
    uploadFiles = uploadFiles.concat(results);
    renderUploadPreviews();
  });
}

function renderUploadPreviews() {
  const grid = document.getElementById("uploadPreviewGrid");
  grid.innerHTML = uploadFiles.map((f, i) => `
    <div class="up-prev-item">
      <img src="${f.dataUrl}" alt="">
      <button class="up-prev-remove" data-ri="${i}" title="Xoá">×</button>
    </div>
  `).join("");
  document.getElementById("uploadSubmitBtn").hidden = uploadFiles.length === 0;
  const limit = uploadOrder.imageLimit || 10;
  const existing = uploadOrder.imageCount || 0;
  const remaining = limit - existing;
  const warn = document.getElementById("uploadWarn");
  warn.hidden = uploadFiles.length < remaining;
  warn.textContent = `Còn có thể thêm tối đa ${remaining} ảnh.`;
}

async function doUploadSubmit() {
  if (!uploadFiles.length || !uploadOrder) return;
  const btn = document.getElementById("uploadSubmitBtn");
  btn.disabled = true; btn.textContent = "Đang upload…";
  try {
    const files = uploadFiles.map(f => {
      const comma = f.dataUrl.indexOf(",");
      return { name: f.file.name, type: f.file.type, data: f.dataUrl.slice(comma + 1) };
    });
    const resp = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderCode: uploadOrder.orderCode,
        folderId: uploadOrder.folderId,
        sourceSheet: getSheet(uploadOrder),
        customer: uploadOrder.customer, 
	rowNumber: uploadOrder.rowNumber,
        files
      })
    });
    const result = await resp.json();
    if (result.error) { alert("Lỗi: " + result.error); return; }

    // cập nhật local state
    const idx = state.data.orders.findIndex(o => o.id === uploadOrder.id);
    if (idx >= 0) {
      state.data.orders[idx].imageCount = result.imageCount;
      state.data.orders[idx].status = result.status;
      if (result.files) state.data.orders[idx].images = (state.data.orders[idx].images || []).concat(result.files);
    }

    const box = document.getElementById("uploadSuccessBox");
    box.textContent = `✓ Đã upload ${result.uploaded} ảnh — Tổng ${result.imageCount}/${uploadOrder.imageLimit || 10} — ${result.status}`;
    box.hidden = false;
    uploadFiles = [];
    document.getElementById("uploadPreviewGrid").innerHTML = "";
    document.getElementById("uploadSubmitBtn").hidden = true;
    render();
  } catch(e) { alert("Upload thất bại: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Upload ảnh"; }
}

document.addEventListener("click", e => {
  const ri = e.target.dataset.ri;
  if (ri !== undefined && e.target.classList.contains("up-prev-remove")) {
    uploadFiles.splice(Number(ri), 1);
    renderUploadPreviews();
  }
});



// ════════════════════════════════════════════════════════════════════
// PATCH: Tab "Hoàn thành" — các phiếu đã được MKT duyệt (approved=true)
// ════════════════════════════════════════════════════════════════════
tabTitles.done = ["Hoàn thành", "Các phiếu đã được MKT xác nhận duyệt"];

els.panels.done = document.getElementById("donePanel");
els.doneBody = document.getElementById("doneBody");

function renderDone() {
  const done = getFilteredOrders().filter(o => o.approved);

  if (!done.length) {
    els.doneBody.innerHTML = `<tr><td colspan="9"><div class="empty">Chưa có phiếu nào được duyệt.</div></td></tr>`;
    return;
  }

  els.doneBody.innerHTML = done.map(o => `
    <tr>
      <td><strong>${esc(o.orderCode)}</strong></td>
      <td>${esc(o.date)}</td>
      <td>${esc(getSheet(o))}</td>
      <td>${esc(o.customer)}</td>
      <td>${esc(o.sales)}</td>
      <td>${fmt(o.imageCount)}</td>
      <td>${esc(o.approvedBy || "")}</td>
      <td>${esc(o.approvedAt || "")}</td>
      <td><button class="view-btn" data-view="${esc(o.id)}">Xem (${o.imageCount})</button></td>
    </tr>
  `).join("");
}

const _origRender = render;
render = function() {
  _origRender();
  renderDone();
};

if (state.data) renderDone();

// Toggle filter mở rộng trên mobile
const filterToggleBtn = document.getElementById("filterToggle");
if (filterToggleBtn) {
  filterToggleBtn.addEventListener("click", () => {
    const filters = document.querySelector(".filters");
    const expanded = filters.classList.toggle("expanded");
    filterToggleBtn.textContent = expanded ? "▴ Ẩn bộ lọc" : "▾ Bộ lọc khác";
  });
}

// Click handler cho nút upload (+ Đăng tải)
document.addEventListener("click", e => {
  const uploadBtn = e.target.closest("[data-upload]");
  if (uploadBtn) openUploadModal(uploadBtn.dataset.upload);
});
