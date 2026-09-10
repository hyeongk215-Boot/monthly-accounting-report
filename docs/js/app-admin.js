(function () {
  var STATEMENT_TYPES = ["PL", "PL_KR", "BS", "CF"];
  var lastData = null;      // { lines: [...], submissions: [...], locks: [...] }
  var corpFilter = null;
  var officeFilter = null;
  var typeFilter = null;
  var closedMonths = [];
  var currentRole = null;
  var accountsCache = [];

  function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 3000);
  }

  function getKey() { return document.getElementById("adminKey").value; }
  function getYm() { return document.getElementById("adminYm").value; }

  function fillYm() {
    var sel = document.getElementById("adminYm");
    var prev = sel.value;
    sel.innerHTML = "";
    window.generateYearMonths().forEach(function (ym) {
      var o = document.createElement("option");
      o.value = ym; o.textContent = ym;
      sel.appendChild(o);
    });
    sel.value = prev || window.defaultYearMonth();
  }

  function statementLabel(type) {
    if (type === "PL") return t("tabPL");
    if (type === "PL_KR") return t("tabPLKR");
    if (type === "BS") return t("tabBS");
    return t("tabCF");
  }

  function filteredLines() {
    var lines = (lastData && lastData.lines) || [];
    if (corpFilter) lines = lines.filter(function (l) { return l.corp === corpFilter; });
    if (officeFilter) lines = lines.filter(function (l) { return l.office === officeFilter; });
    if (typeFilter) lines = lines.filter(function (l) { return l.statementType === typeFilter; });
    return lines;
  }

  // PL과 PL_KR이 같은 code(예: 500000)를 공유하므로 statementType까지 같이 매칭해야 합니다.
  function accountLabel(code, statementType) {
    var candidates = accountsCache.filter(function (x) { return x.code === code; });
    var a = candidates.length > 1 && statementType
      ? (candidates.filter(function (x) { return x.statementType === statementType; })[0] || candidates[0])
      : candidates[0];
    if (!a) return code;
    return getLang() === "zh" ? a.nameZh : a.nameKo;
  }

  function renderStatusGrid() {
    var grid = document.getElementById("statusGrid");
    grid.innerHTML = "";
    var submitted = {};
    var extras = {};
    var locked = {};
    var pairs = [];
    var seenPairs = {};
    ((lastData && lastData.submissions) || []).forEach(function (s) {
      submitted[s.corp + "::" + s.office + "::" + s.statementType] = s;
      var pairKey = s.corp + "::" + s.office;
      if (!seenPairs[pairKey]) {
        seenPairs[pairKey] = true;
        pairs.push({ corp: s.corp, office: s.office });
      }
    });
    ((lastData && lastData.extras) || []).forEach(function (x) {
      extras[x.corp + "::" + x.office] = x;
    });
    ((lastData && lastData.locks) || []).forEach(function (k) {
      locked[k.corp + "::" + k.office + "::" + k.statementType] = true;
    });
    pairs.sort(function (a, b) {
      return (a.corp + a.office).localeCompare(b.corp + b.office);
    });
    pairs.forEach(function (pair) {
      var div = document.createElement("div");
      div.className = "status-chip";
      div.style.cursor = "pointer";
      if (corpFilter === pair.corp && officeFilter === pair.office) div.style.outline = "2px solid var(--primary)";
      var html = "<b>" + window.corpLabel(pair.corp) + " - " + window.officeLabel(pair.office) + "</b><br>";
      html += STATEMENT_TYPES.map(function (type) {
        var s = submitted[pair.corp + "::" + pair.office + "::" + type];
        var isLocked = locked[pair.corp + "::" + pair.office + "::" + type];
        var label = statementLabel(type) + ": " + (s ? t("adminSubmitted") : t("adminNotSubmitted")) + (isLocked ? " 🔒" : "");
        var span = "<span style='display:inline-block; margin:2px 4px 0 0; padding:1px 6px; border-radius:8px; font-size:11px; background:" +
          (isLocked ? "#fff8e6;color:#a56a00;" : (s ? "#f2fbf3;color:var(--ok);" : "#fdf3f2;color:var(--danger);")) + "'>" + label + "</span>";
        if (isLocked) {
          span += "<button type='button' class='btn-secondary unlock-btn' data-corp='" + pair.corp + "' data-office='" + pair.office +
            "' data-type='" + type + "' style='font-size:10px; padding:1px 6px; margin:2px 4px 0 0;'>" + t("adminUnlockBtn") + "</button>";
        }
        return span;
      }).join(" ");
      var extra = extras[pair.corp + "::" + pair.office];
      if (extra) {
        html += "<br><span style='font-size:11px;color:var(--muted);'>" +
          t("headcountLabel") + ": " + (extra.headcount != null ? extra.headcount : "-") + " / " +
          t("entertainmentLabel") + ": " + (extra.entertainmentCny != null ? Number(extra.entertainmentCny).toLocaleString() : "-") + " / " +
          t("travelLabel") + ": " + (extra.travelCny != null ? Number(extra.travelCny).toLocaleString() : "-") +
          "</span>";
      }
      div.innerHTML = html;
      div.addEventListener("click", function (e) {
        if (e.target.closest(".unlock-btn")) return;
        var isSame = corpFilter === pair.corp && officeFilter === pair.office;
        corpFilter = isSame ? null : pair.corp;
        officeFilter = isSame ? null : pair.office;
        renderAll();
      });
      div.querySelectorAll(".unlock-btn").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          unlockSubmission(btn.dataset.corp, btn.dataset.office, btn.dataset.type);
        });
      });
      grid.appendChild(div);
    });
    document.getElementById("filterAllWrap").style.display = corpFilter ? "block" : "none";
  }

  function renderTable() {
    var lines = filteredLines();
    var body = document.getElementById("previewBody");
    body.innerHTML = "";
    lines.forEach(function (l, i) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + (i + 1) + "</td><td>" + window.corpLabel(l.corp) + "</td><td>" + window.officeLabel(l.office) + "</td><td>" + statementLabel(l.statementType) + "</td>" +
        "<td style='text-align:left;'>" + accountLabel(l.accountCode, l.statementType) + "</td>" +
        "<td>" + Number(l.amountCny).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "</td>" +
        "<td>" + (l.amountKrw != null ? Number(l.amountKrw).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-") + "</td>" +
        "<td>" + (l.submittedBy || "") + "</td>" +
        "<td style='font-size:11px;color:var(--muted);'>" + (l.submittedAt ? new Date(l.submittedAt).toLocaleString() : "") + "</td>" +
        "<td style='text-align:center;'><input type='checkbox' class='row-select' data-id='" + l.id + "'></td>";
      body.appendChild(tr);
    });
    document.getElementById("totalRows").textContent = lines.length;
    var selectAll = document.getElementById("selectAllCheckbox");
    if (selectAll) selectAll.checked = false;
  }

  function renderMonthStatus() {
    var ym = getYm();
    var isClosed = closedMonths.indexOf(ym) !== -1;
    var badge = document.getElementById("monthStatusBadge");
    badge.textContent = t(isClosed ? "adminMonthClosedBadge" : "adminMonthOpenBadge");
    badge.className = "badge " + (isClosed ? "badge-special" : "badge-general");
    document.getElementById("closeMonthBtn").textContent = t(isClosed ? "adminReopenMonthBtn" : "adminCloseMonthBtn");
  }

  function renderRate() {
    var client = window.getSupabaseClient();
    if (!client) return;
    client.rpc("get_exchange_rate", { p_yearmonth: getYm() }).then(function (res) {
      document.getElementById("currentRate").textContent = res.data ? res.data : t("rateNotSet");
    });
  }

  function renderCoaGate() {
    var isAdmin = currentRole === "system_admin";
    document.getElementById("coaAdminOnlyNote").style.display = isAdmin ? "none" : "block";
    document.getElementById("coaUploadBtn").disabled = !isAdmin;
  }

  function renderAll() {
    renderStatusGrid();
    renderTable();
    renderMonthStatus();
  }

  function refreshClosedMonths() {
    return window.fetchClosedMonths().then(function (list) {
      closedMonths = list;
      renderMonthStatus();
    });
  }

  function toggleMonthClosed() {
    var ym = getYm();
    var key = getKey();
    var isClosed = closedMonths.indexOf(ym) !== -1;
    var client = window.getSupabaseClient();
    if (!client) { showToast(t("adminCloseFail")); return; }
    if (!key) { showToast(t("adminKeyRequired")); return; }
    if (!confirm(t(isClosed ? "adminReopenConfirm" : "adminCloseConfirm", { yearmonth: ym }))) return;
    var fn = isClosed ? "reopen_month" : "close_month";
    client.rpc(fn, { p_access_key: key, p_yearmonth: ym }).then(function (res) {
      if (res.error) throw res.error;
      showToast(t(isClosed ? "adminReopenSuccess" : "adminCloseSuccess"));
      return refreshClosedMonths();
    }).catch(function () {
      showToast(t("adminCloseFail"));
    });
  }

  function setRate() {
    var client = window.getSupabaseClient();
    var key = getKey();
    var rate = Number(document.getElementById("rateInput").value);
    if (!key) { showToast(t("adminKeyRequired")); return; }
    if (!rate || rate <= 0) { showToast(t("rateSetFail")); return; }
    client.rpc("set_exchange_rate", { p_access_key: key, p_yearmonth: getYm(), p_cny_to_krw: rate }).then(function (res) {
      if (res.error) throw res.error;
      showToast(t("rateSetSuccess"));
      renderRate();
      fetchData();
    }).catch(function () {
      showToast(t("rateSetFail"));
    });
  }

  function deleteSelected() {
    var ids = Array.from(document.querySelectorAll(".row-select:checked")).map(function (cb) { return cb.dataset.id; });
    if (ids.length === 0) { showToast(t("adminDeleteSelectedNone")); return; }
    var client = window.getSupabaseClient();
    var key = getKey();
    if (!client) { showToast(t("adminDeleteFail")); return; }
    if (!key) { showToast(t("adminKeyRequired")); return; }
    if (!confirm(t("adminDeleteConfirm", { n: ids.length }))) return;
    Promise.all(ids.map(function (id) {
      return client.rpc("delete_statement_line", { p_access_key: key, p_id: id });
    })).then(function (results) {
      if (results.some(function (r) { return r.error; })) throw new Error("delete_failed");
      showToast(t("adminDeleteSuccess"));
      lastData.lines = lastData.lines.filter(function (l) { return ids.indexOf(String(l.id)) === -1; });
      renderAll();
    }).catch(function () {
      showToast(t("adminDeleteFail"));
    });
  }

  function downloadAggregate() {
    var lines = filteredLines();
    if (!lines.length) { showToast(t("adminDeleteSelectedNone")); return; }
    var ym = getYm();
    var header = [t("rowNumberCol"), t("colCorp"), t("colOffice"), t("colStatementType"), t("colAccount"), t("colAmountCny"), t("colAmountKrw"), t("colSubmittedBy"), t("colSubmittedAt")];
    var aoa = [header];
    lines.forEach(function (l, i) {
      aoa.push([i + 1, window.corpLabel(l.corp), window.officeLabel(l.office), statementLabel(l.statementType), accountLabel(l.accountCode, l.statementType),
        l.amountCny, l.amountKrw != null ? l.amountKrw : "", l.submittedBy || "", l.submittedAt ? new Date(l.submittedAt).toLocaleString() : ""]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 18 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, ym);
    var suffix = (corpFilter ? "_" + corpFilter : "") + (officeFilter ? "_" + officeFilter : "") + (typeFilter ? "_" + typeFilter : "");
    XLSX.writeFile(wb, t("fileNamePrefix") + "_" + ym + suffix + ".xlsx");
  }

  function unlockSubmission(corp, office, type) {
    var client = window.getSupabaseClient();
    var key = getKey();
    if (!client || !key) { showToast(t("adminKeyRequired")); return; }
    if (!confirm(t("adminUnlockConfirm"))) return;
    client.rpc("unlock_submission", {
      p_access_key: key, p_corp: corp, p_office: office, p_yearmonth: getYm(), p_statement_type: type
    }).then(function (res) {
      if (res.error) throw res.error;
      showToast(t("adminUnlockSuccess"));
      fetchData();
    }).catch(function () {
      showToast(t("adminUnlockFail"));
    });
  }

  function fetchData() {
    var client = window.getSupabaseClient();
    var key = getKey();
    var ym = getYm();
    if (!client) { showToast(t("adminFetchFail")); return; }
    if (!key) { showToast(t("adminKeyRequired")); return; }
    client.rpc("verify_access_key", { p_key: key }).then(function (vres) {
      if (vres.error || !vres.data || !vres.data.length) throw new Error("invalid_key");
      currentRole = vres.data[0].role;
      renderCoaGate();
      return client.rpc("get_aggregate", { p_access_key: key, p_yearmonth: ym });
    }).then(function (res) {
      if (res.error) throw res.error;
      lastData = res.data;
      corpFilter = null;
      officeFilter = null;
      typeFilter = null;
      renderAll();
      renderRate();
    }).catch(function () {
      showToast(t("adminFetchFail"));
    });
  }

  function fillConsolCorp() {
    var sel = document.getElementById("consolCorp");
    var prev = sel.value;
    var lang = getLang();
    sel.innerHTML = "";
    window.APP_CONFIG.CORPORATIONS.forEach(function (item) {
      var o = document.createElement("option");
      o.value = item.ko; o.textContent = item[lang] || item.ko;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  }

  function switchView(mode) {
    var isConsolidated = mode === "consolidated";
    document.getElementById("viewByOfficeBtn").classList.toggle("tab-active", !isConsolidated);
    document.getElementById("viewConsolidatedBtn").classList.toggle("tab-active", isConsolidated);
    document.getElementById("byOfficeSection").style.display = isConsolidated ? "none" : "block";
    document.getElementById("consolidatedSection").style.display = isConsolidated ? "block" : "none";
  }

  var consolReports = { pl: [], bs: [], cf: [] };

  function accountName(r) {
    return getLang() === "zh" ? r.nameZh : r.nameKo;
  }
  function fmtAmount(n) {
    return n == null ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function renderFlowReportTable(bodyId, rows) {
    var body = document.getElementById(bodyId);
    body.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.isSubtotal) tr.className = "subtotal-row";
      tr.innerHTML =
        "<td class='col-lineno'>" + (r.lineNo || "") + "</td>" +
        "<td class='col-label'>" + accountName(r) + "</td>" +
        "<td class='col-amt'>" + fmtAmount(r.currentCny) + "</td>" +
        "<td class='col-amt'>" + fmtAmount(r.ytdCny) + "</td>";
      body.appendChild(tr);
    });
  }

  // 재무상태표는 자산(BS-L*)과 부채및자본(BS-R*)을 나란히 2단으로 배치합니다 (원본 정부양식과 동일한 구성).
  function renderBsReportTable(bodyId, rows) {
    var body = document.getElementById(bodyId);
    body.innerHTML = "";
    var left = rows.filter(function (r) { return r.accountCode.indexOf("BS-L") === 0; });
    var right = rows.filter(function (r) { return r.accountCode.indexOf("BS-R") === 0; });
    var maxLen = Math.max(left.length, right.length);
    function cellsFor(r) {
      if (!r) return "<td class='col-blank'></td><td class='col-blank'></td><td class='col-blank'></td><td class='col-blank'></td>";
      var cls = r.isSubtotal ? " subtotal-cell" : "";
      return (
        "<td class='col-label" + cls + "'>" + accountName(r) + "</td>" +
        "<td class='col-lineno" + cls + "'>" + (r.lineNo || "") + "</td>" +
        "<td class='col-amt" + cls + "'>" + fmtAmount(r.currentCny) + "</td>" +
        "<td class='col-amt" + cls + "'>" + fmtAmount(r.priorYearEndCny) + "</td>"
      );
    }
    for (var i = 0; i < maxLen; i++) {
      var tr = document.createElement("tr");
      tr.innerHTML = cellsFor(left[i]) + cellsFor(right[i]);
      body.appendChild(tr);
    }
  }

  function renderReportMeta(prefix, corp, ym) {
    document.getElementById("consol" + prefix + "MetaCorp").textContent = window.corpLabel(corp);
    document.getElementById("consol" + prefix + "MetaYm").textContent = ym + " (" + t("reportUnitNote") + ")";
  }

  function fetchConsolidated() {
    var client = window.getSupabaseClient();
    var key = getKey();
    var corp = document.getElementById("consolCorp").value;
    var ym = getYm();
    if (!client) { showToast(t("adminFetchFail")); return; }
    if (!key) { showToast(t("adminKeyRequired")); return; }
    Promise.all([
      client.rpc("get_consolidated_flow_report", { p_access_key: key, p_corp: corp, p_yearmonth: ym, p_statement_type: "PL" }),
      client.rpc("get_consolidated_bs_report", { p_access_key: key, p_corp: corp, p_yearmonth: ym }),
      client.rpc("get_consolidated_flow_report", { p_access_key: key, p_corp: corp, p_yearmonth: ym, p_statement_type: "CF" })
    ]).then(function (results) {
      if (results.some(function (r) { return r.error; })) throw new Error("fetch_failed");
      consolReports.pl = results[0].data || [];
      consolReports.bs = results[1].data || [];
      consolReports.cf = results[2].data || [];
      renderFlowReportTable("consolPlBody", consolReports.pl);
      renderBsReportTable("consolBsBody", consolReports.bs);
      renderFlowReportTable("consolCfBody", consolReports.cf);
      renderReportMeta("Pl", corp, ym);
      renderReportMeta("Bs", corp, ym);
      renderReportMeta("Cf", corp, ym);
    }).catch(function () {
      showToast(t("adminConsolFetchFail"));
    });
  }

  function downloadConsolidated() {
    if (!consolReports.pl.length && !consolReports.bs.length && !consolReports.cf.length) {
      showToast(t("adminDeleteSelectedNone"));
      return;
    }
    var corp = document.getElementById("consolCorp").value;
    var ym = getYm();
    var wb = XLSX.utils.book_new();
    var flowHeader = [t("colLineNo"), t("colAccount"), t("consolCurrentMonth"), t("consolYtd")];
    [["PL", consolReports.pl, t("tabPL")], ["CF", consolReports.cf, t("tabCF")]].forEach(function (entry) {
      var aoa = [flowHeader];
      entry[1].forEach(function (r) { aoa.push([r.lineNo || "", accountName(r), r.currentCny, r.ytdCny]); });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, entry[2]);
    });
    var bsAoa = [[t("colLineNo"), t("colAccount"), t("consolCurrentBalance"), t("consolPriorYearEnd")]];
    consolReports.bs.forEach(function (r) { bsAoa.push([r.lineNo || "", accountName(r), r.currentCny, r.priorYearEndCny]); });
    var bsWs = XLSX.utils.aoa_to_sheet(bsAoa);
    bsWs["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, bsWs, t("tabBS"));
    XLSX.writeFile(wb, t("fileNamePrefix") + "_" + window.corpLabel(corp) + "_" + ym + "_consol.xlsx");
  }

  function loadAccounts() {
    var client = window.getSupabaseClient();
    if (!client) return;
    client.rpc("get_accounts", {}).then(function (res) {
      accountsCache = res.data || [];
    });
  }

  function downloadCoaTemplate() {
    var wb = window.buildAccountsWorkbook(accountsCache);
    window.downloadWorkbook(wb, "accounts_template.xlsx");
  }

  function uploadCoa() {
    var key = getKey();
    var input = document.getElementById("coaFile");
    if (!key) { showToast(t("adminKeyRequired")); return; }
    if (!input.files || !input.files[0]) { showToast(t("uploadNoFile")); return; }
    window.parseAccountsFile(input.files[0]).then(function (rows) {
      var client = window.getSupabaseClient();
      return client.rpc("replace_accounts", { p_access_key: key, p_accounts: rows });
    }).then(function (res) {
      if (res.error) throw res.error;
      showToast(t("coaUploadSuccess", { n: res.data }));
      loadAccounts();
    }).catch(function () {
      showToast(t("coaUploadFail"));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fillYm();
    fillConsolCorp();
    loadAccounts();
    renderCoaGate();
    document.addEventListener("langchange", function () { fillYm(); fillConsolCorp(); renderMonthStatus(); renderAll(); });
    document.getElementById("fetchBtn").addEventListener("click", fetchData);
    document.getElementById("viewByOfficeBtn").addEventListener("click", function () { switchView("byOffice"); });
    document.getElementById("viewConsolidatedBtn").addEventListener("click", function () { switchView("consolidated"); });
    document.getElementById("consolFetchBtn").addEventListener("click", fetchConsolidated);
    document.getElementById("consolDownloadBtn").addEventListener("click", downloadConsolidated);
    document.getElementById("downloadBtn").addEventListener("click", downloadAggregate);
    document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelected);
    document.getElementById("selectAllCheckbox").addEventListener("change", function (e) {
      document.querySelectorAll(".row-select").forEach(function (cb) { cb.checked = e.target.checked; });
    });
    document.getElementById("filterAllBtn").addEventListener("click", function () {
      corpFilter = null;
      officeFilter = null;
      renderAll();
    });
    document.getElementById("adminYm").addEventListener("change", function () { renderMonthStatus(); renderRate(); });
    document.getElementById("closeMonthBtn").addEventListener("click", toggleMonthClosed);
    document.getElementById("setRateBtn").addEventListener("click", setRate);
    document.getElementById("coaTemplateBtn").addEventListener("click", downloadCoaTemplate);
    document.getElementById("coaUploadBtn").addEventListener("click", uploadCoa);
    refreshClosedMonths();
  });
})();
