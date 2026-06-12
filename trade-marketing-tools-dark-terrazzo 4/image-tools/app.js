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
  uploadOrderMeta: document.getElementById("uploadOrderMeta"),
  uploadFileInput: document.getElementById("uploadFileInput"),
  uploadBtn: document.getElementById("uploadBtn"),
  uploadMessage: document.getElementById("uploadMessage"),
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

function getImageStatus(order) {
  if (order.status === "Lỗi folder") return "Lỗi folder";
  if (order.status === "Vượt giới hạn") return "Vượt giới hạn";
  const limit = Number(order.imageLimit || 10);
  const count = Number(order.imageCount || 0);
  if (count <= 0) return "Chưa cập nhật";
  if (count >= limit) return "Đã đủ ảnh";
  return "Hợp lệ";
}

function matchesStatus(order) {
  if (!state.status) return true;
  const status = getImageStatus(order);
  if (state.status === "missing") return status === "Chưa cập nhật";
  if (state.status === "valid") return status === "Hợp lệ";
  if (state.status === "full") return status === "Đã đủ ảnh";
  if (state.status === "over") return status === "Vượt giới hạn";
  if (state.status === "error") return order.status === "Lỗi folder";
  return true;
}

function getFilteredOrders() {
  if (!state.data) return [];

  const search = state.search.toLowerCase();
  const fromTime = state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`).getTime() : null;
  const toTime = state.dateTo ? new Date(`${state.dateTo}T23:59:59`).getTime() : null;

  return state.data.orders.filter(order => {
    const matchesRegion = !state.region || order.sheet === state.region;
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
    pendingReview: orders.filter(order => getImageStatus(order) === "Hợp lệ").length,
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
      const regionOrders = orders.filter(order => order.sheet === sheetName);
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
  if (status === "Chưa cập nhật") return "missing";
  if (status === "Lỗi folder") return "error";
  if (status === "Vượt giới hạn") return "error";
  if (status === "Hợp lệ") return "pending";
  return "";
}

function renderOrders() {
  const orders = getFilteredOrders();

  if (!orders.length) {
    els.ordersBody.innerHTML = `<tr><td colspan="9"><div class="empty">Không có phiếu phù hợp.</div></td></tr>`;
    return;
  }

  els.ordersBody.innerHTML = orders.map(order => `
    <tr>
      <td><strong>${escapeHtml(order.orderCode)}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(order.sheet)}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.sales)}</td>
      <td>${formatNumber(order.imageCount)}/${formatNumber(order.imageLimit || 10)} ảnh</td>
      <td>${escapeHtml(order.lastImageUpdate || "")}</td>
      <td><span class="status ${statusClass(getImageStatus(order))}">${escapeHtml(getImageStatus(order))}</span></td>
      <td><button class="view-btn upload-action" data-view="${escapeHtml(order.id)}">+ Upload</button></td>
    </tr>
  `).join("");
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
      <td>${escapeHtml(order.sheet)}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.sales)}</td>
      <td>${escapeHtml(order.note)}</td>
    </tr>
  `).join("");
}

function selectOrder(orderId) {
  const order = state.data && state.data.orders.find(item => item.id === orderId);
  state.selectedOrderId = orderId;
  if (order) state.search = order.orderCode || state.search;
  setTab("gallery");
  renderGallery();
}

function renderGallery() {
  const orders = getFilteredOrders();
  const selected = orders.find(order => order.id === state.selectedOrderId) || orders[0];

  if (selected && !state.selectedOrderId) {
    state.selectedOrderId = selected.id;
  }

  els.galleryOrders.innerHTML = orders.length
    ? orders.map(order => `
      <button class="order-item ${order.id === state.selectedOrderId ? "is-active" : ""}" data-select="${escapeHtml(order.id)}">
        <strong>${escapeHtml(order.orderCode)}</strong>
        <span>${escapeHtml(order.customer || order.sheet)} · ${escapeHtml(getImageStatus(order))} · ${formatNumber(order.imageCount)}/${formatNumber(order.imageLimit || 10)} ảnh</span>
      </button>
    `).join("")
    : `<div class="empty">Không có mã phiếu phù hợp.</div>`;

  if (!selected) {
    els.galleryTitle.textContent = "Chọn một đơn để xem ảnh";
    els.galleryMeta.textContent = "";
    els.imageGrid.innerHTML = "";
    els.openFolderLink.hidden = true;
    renderUploadPanel(null);
    return;
  }

  els.galleryTitle.textContent = `${selected.orderCode} · ${getImageStatus(selected)}`;
  els.galleryMeta.textContent = [selected.customer, selected.sales, selected.sheet, selected.date, selected.lastImageUpdate].filter(Boolean).join(" · ");
  els.openFolderLink.href = `https://drive.google.com/drive/folders/${encodeURIComponent(selected.folderId)}`;
  els.openFolderLink.hidden = false;
  renderUploadPanel(selected);

  els.imageGrid.innerHTML = selected.images && selected.images.length ? selected.images.map(image => `
    <article class="image-card">
      <button data-preview="${escapeHtml(image.imageUrl)}" aria-label="Xem lớn ${escapeHtml(image.name)}">
        <img src="${escapeHtml(image.thumbnailUrl)}" alt="${escapeHtml(image.name)}" loading="lazy" />
      </button>
      <p>${escapeHtml(image.name)}</p>
      <small>${escapeHtml(image.updatedAt || image.createdAt || "")}</small>
    </article>
  `).join("") : `<div class="empty">Phiếu này chưa có hình. Có thể upload trực tiếp ở khung phía trên.</div>`;
}

function renderUploadPanel(order) {
  if (!els.uploadOrderMeta) return;

  els.uploadMessage.textContent = "";
  els.uploadMessage.className = "upload-message";

  if (!order) {
    els.uploadOrderMeta.textContent = "Chọn một mã phiếu bên trái hoặc bấm “+ Upload” ở bảng danh sách.";
    els.uploadFileInput.disabled = true;
    els.uploadBtn.disabled = true;
    return;
  }

  const limit = Number(order.imageLimit || 10);
  const count = Number(order.imageCount || 0);
  const remaining = Math.max(limit - count, 0);
  els.uploadOrderMeta.textContent = `${order.orderCode} · ${order.customer || "Không có tên khách hàng"} · ${count}/${limit} ảnh · còn ${remaining} ảnh. Bấm “+ Chọn hình” để thêm ảnh.`;
  els.uploadFileInput.disabled = remaining <= 0 || !order.folderId;
  els.uploadBtn.disabled = remaining <= 0 || !order.folderId || !els.uploadFileInput.files.length;

  if (!order.folderId) {
    els.uploadMessage.textContent = "Phiếu này chưa có link thư mục Drive.";
    els.uploadMessage.classList.add("is-error");
    return;
  }

  if (remaining <= 0) {
    els.uploadMessage.textContent = "Phiếu đã đạt giới hạn tối đa 10 hình ảnh.";
    els.uploadMessage.classList.add("is-error");
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Không đọc được file ảnh."));
    reader.readAsDataURL(file);
  });
}

async function uploadSelectedImages() {
  const order = state.data && state.data.orders.find(item => item.id === state.selectedOrderId);
  const files = [...(els.uploadFileInput.files || [])];
  if (!order || !files.length) return;

  const limit = Number(order.imageLimit || 10);
  const remaining = Math.max(limit - Number(order.imageCount || 0), 0);
  if (files.length > remaining) {
    els.uploadMessage.textContent = "Phiếu đã đạt giới hạn tối đa 10 hình ảnh.";
    els.uploadMessage.className = "upload-message is-error";
    return;
  }

  els.uploadBtn.disabled = true;
  els.uploadBtn.textContent = "Đang upload...";
  els.uploadMessage.textContent = "";
  els.uploadMessage.className = "upload-message";

  try {
    const payloadFiles = await Promise.all(files.map(async file => ({
      name: file.name,
      type: file.type || "image/jpeg",
      data: await fileToBase64(file)
    })));

    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderCode: order.orderCode,
        folderId: order.folderId,
        sourceSheet: order.sourceSheet || order.sheet,
        rowNumber: order.rowNumber,
        files: payloadFiles
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Upload không thành công.");

    els.uploadFileInput.value = "";
    els.uploadMessage.textContent = `Đã upload ${formatNumber(result.uploaded || files.length)} ảnh.`;
    els.uploadMessage.className = "upload-message is-success";
    await loadData();
    const refreshed = state.data.orders.find(item => item.orderCode === order.orderCode && item.folderId === order.folderId);
    if (refreshed) state.selectedOrderId = refreshed.id;
    renderGallery();
  } catch (err) {
    els.uploadMessage.textContent = err.message;
    els.uploadMessage.className = "upload-message is-error";
  } finally {
    els.uploadBtn.textContent = "Upload hình";
    renderUploadPanel(state.data && state.data.orders.find(item => item.id === state.selectedOrderId));
  }
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

els.uploadFileInput.addEventListener("change", () => {
  const order = state.data && state.data.orders.find(item => item.id === state.selectedOrderId);
  if (!order) {
    renderUploadPanel(null);
    return;
  }

  const limit = Number(order.imageLimit || 10);
  const remaining = Math.max(limit - Number(order.imageCount || 0), 0);
  const fileCount = els.uploadFileInput.files ? els.uploadFileInput.files.length : 0;

  renderUploadPanel(order);
  if (fileCount > remaining) {
    els.uploadMessage.textContent = "Phiếu đã đạt giới hạn tối đa 10 hình ảnh.";
    els.uploadMessage.className = "upload-message is-error";
    els.uploadBtn.disabled = true;
  } else if (fileCount > 0) {
    els.uploadMessage.textContent = `Đã chọn ${formatNumber(fileCount)} ảnh. Bấm “Upload hình” để lưu lên Drive.`;
    els.uploadMessage.className = "upload-message is-success";
  }
});

els.uploadBtn.addEventListener("click", uploadSelectedImages);

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
