const state = {
  data: null,
  activeTab: "overview",
  selectedOrderId: "",
  region: "",
  status: "",
  search: ""
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

  return state.data.orders.filter(order => {
    const matchesRegion = !state.region || order.sheet === state.region;
    const searchText = [
      order.orderCode,
      order.customer,
      order.sales,
      order.area,
      order.product
    ].join(" ").toLowerCase();

    return matchesRegion && matchesStatus(order) && (!search || searchText.includes(search));
  });
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

  els.ordersBody.innerHTML = orders.map(order => `
    <tr>
      <td><strong>${escapeHtml(order.orderCode)}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(order.sheet)}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.sales)}</td>
      <td>${escapeHtml(order.product)}</td>
      <td>${formatNumber(order.imageCount)}</td>
      <td><span class="status ${statusClass(getOperationalStatus(order))}">${escapeHtml(getOperationalStatus(order))}</span></td>
      <td><button class="view-btn" data-view="${escapeHtml(order.id)}">Xem ảnh</button></td>
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
        <span>${escapeHtml(order.customer || order.sheet)} · ${escapeHtml(getOperationalStatus(order))} · ${formatNumber(order.imageCount)} ảnh</span>
      </button>
    `).join("")
    : `<div class="empty">Chưa có đơn nào có ảnh.</div>`;

  if (!selected) {
    els.galleryTitle.textContent = "Chọn một đơn để xem ảnh";
    els.galleryMeta.textContent = "";
    els.imageGrid.innerHTML = "";
    els.openFolderLink.hidden = true;
    return;
  }

  els.galleryTitle.textContent = `${selected.orderCode} · ${getOperationalStatus(selected)}`;
  els.galleryMeta.textContent = [selected.customer, selected.sales, selected.sheet, selected.date].filter(Boolean).join(" · ");
  els.openFolderLink.href = `https://drive.google.com/drive/folders/${encodeURIComponent(selected.folderId)}`;
  els.openFolderLink.hidden = false;

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
    els.lastUpdated.textContent = `Cập nhật: ${new Date(data.generatedAt).toLocaleString("vi-VN")}`;
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
