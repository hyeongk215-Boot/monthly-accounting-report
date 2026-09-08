(function () {
  var STATEMENT_TYPES = ["PL", "BS", "CF"];
  var ctx = window.loadContext();
  if (!ctx) {
    window.location.href = "index.html";
    return;
  }

  var client = window.getSupabaseClient();
  var accounts = [];          // 전체 계정과목 (get_accounts)
  var existingLines = {};     // accountCode -> amountCny (get_statement 프리필)
  var exchangeRate = null;    // 이 달 환율 (없으면 null)
  var closedMonths = [];

  function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 3000);
  }

  function renderContextBar() {
    var el = document.getElementById("contextBar");
    el.innerHTML =
      "<span><b>" + t("corp") + "</b>: " + window.corpLabel(ctx.corp) + "</span>" +
      "<span><b>" + t("office") + "</b>: " + window.officeLabel(ctx.office) + "</span>" +
      "<span><b>" + t("yearmonth") + "</b>: " + ctx.yearmonth + "</span>" +
      "<span><b>" + t("submitterName") + "</b>: " + ctx.submitter + "</span>";
  }

  function accountLabel(a) {
    return getLang() === "zh" ? a.nameZh : a.nameKo;
  }

  function statementTabLabel(type) {
    return type === "PL" ? t("tabPL") : (type === "BS" ? t("tabBS") : t("tabCF"));
  }

  function panelHtml(type) {
    var standardUploadHtml = "";
    if (type === "PL" || type === "BS") {
      standardUploadHtml =
        '<div class="note-box">' + t("uploadStandardNote") + "</div>" +
        '<div class="btn-row" style="align-items:center;">' +
          '<input type="file" id="uploadStandardFile_' + type + '" accept=".xls,.xlsx">' +
          '<button class="btn-primary" data-action="uploadStandard" data-type="' + type + '">' + t("uploadStandardBtn") + "</button>" +
        "</div>";
    }
    return (
      '<div class="tab-panel' + (type === "PL" ? " tab-active" : "") + '" data-panel="' + type + '">' +
        '<div class="note-box" id="rateNote_' + type + '" style="display:none;">' + t("rateUnsetNote") + "</div>" +
        standardUploadHtml +
        '<div class="btn-row" style="align-items:center;">' +
          '<button class="btn-secondary" data-action="template" data-type="' + type + '">' + t("downloadTemplateBtn") + "</button>" +
          '<input type="file" id="uploadFile_' + type + '" accept=".xlsx">' +
          '<button class="btn-secondary" data-action="upload" data-type="' + type + '">' + t("uploadBtn") + "</button>" +
          '<span style="font-size:12px; color:var(--muted);" id="draftInfo_' + type + '"></span>' +
        "</div>" +
        '<div class="table-wrap">' +
          '<table class="exp-table"><thead><tr>' +
            "<th>" + t("colAccount") + "</th><th>" + t("colAmountCny") + "</th><th>" + t("colAmountKrw") + "</th>" +
          '</tr></thead><tbody id="tbody_' + type + '"></tbody></table>' +
        "</div>" +
        '<div class="btn-row">' +
          '<button class="btn-primary" data-action="submit" data-type="' + type + '">' + t("submitTabBtn") + "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function renderPanels() {
    document.getElementById("tabPanels").innerHTML = STATEMENT_TYPES.map(panelHtml).join("");
    STATEMENT_TYPES.forEach(renderTable);
  }

  function renderTable(type) {
    var tbody = document.getElementById("tbody_" + type);
    var rows = accounts.filter(function (a) { return a.statementType === type; });
    var draft = window.loadDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type));
    tbody.innerHTML = "";
    rows.forEach(function (a) {
      var tr = document.createElement("tr");
      if (a.isSubtotal) tr.className = "subtotal-row";
      var draftVal = draft && draft.values ? draft.values[a.code] : undefined;
      var initial = draftVal !== undefined ? draftVal : (existingLines[a.code] !== undefined ? existingLines[a.code] : "");
      tr.innerHTML =
        "<td style='text-align:left;'>" + accountLabel(a) + "</td>" +
        "<td><input type='number' step='0.01' data-code='" + a.code + "' class='amt-cny' value='" + initial + "'></td>" +
        "<td class='krw-cell' data-code='" + a.code + "'>" + krwPreview(initial) + "</td>";
      tbody.appendChild(tr);
    });
    updateDraftInfo(type, draft);
    var rateNote = document.getElementById("rateNote_" + type);
    if (rateNote) rateNote.style.display = exchangeRate ? "none" : "block";
  }

  function krwPreview(amountCny) {
    var n = Number(amountCny);
    if (!n || !exchangeRate) return "-";
    return Math.round(n * exchangeRate).toLocaleString();
  }

  function updateDraftInfo(type, draft) {
    var el = document.getElementById("draftInfo_" + type);
    if (!el) return;
    el.textContent = draft && draft._savedAt ? (t("draftSavedAt") + ": " + new Date(draft._savedAt).toLocaleString()) : "";
  }

  var saveTimers = {};
  function scheduleAutosave(type) {
    clearTimeout(saveTimers[type]);
    saveTimers[type] = setTimeout(function () {
      var values = {};
      document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
        values[input.dataset.code] = input.value;
      });
      var saved = window.saveDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type), { values: values });
      updateDraftInfo(type, { _savedAt: saved });
    }, 600);
  }

  function bindPanelEvents() {
    document.getElementById("tabPanels").addEventListener("input", function (e) {
      if (!e.target.classList.contains("amt-cny")) return;
      var panel = e.target.closest(".tab-panel");
      var type = panel.dataset.panel;
      var krwCell = panel.querySelector('.krw-cell[data-code="' + e.target.dataset.code + '"]');
      if (krwCell) krwCell.textContent = krwPreview(e.target.value);
      scheduleAutosave(type);
    });

    document.getElementById("tabPanels").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var type = btn.dataset.type;
      var action = btn.dataset.action;
      if (action === "template") downloadTemplate(type);
      if (action === "upload") uploadFile(type);
      if (action === "uploadStandard") uploadStandardFile(type);
      if (action === "submit") submitTab(type);
    });
  }

  function downloadTemplate(type) {
    var wb = window.buildStatementTemplate(accounts, type, getLang());
    window.downloadWorkbook(wb, t("uploadTemplateFileName") + "_" + type + ".xlsx");
  }

  function uploadFile(type) {
    var input = document.getElementById("uploadFile_" + type);
    if (!input.files || !input.files[0]) {
      showToast(t("uploadNoFile"));
      return;
    }
    window.parseStatementFile(input.files[0]).then(function (rows) {
      var n = 0;
      rows.forEach(function (r) {
        if (applyUpload(type, r.accountCode, r.amountCny)) n++;
      });
      scheduleAutosave(type);
      showToast(t("uploadSuccess", { n: n }));
    }).catch(function () {
      showToast(t("uploadFail"));
    });
  }

  function applyUpload(type, code, amount) {
    var el = document.querySelector('#tbody_' + type + ' .amt-cny[data-code="' + code + '"]');
    if (!el) return false;
    el.value = amount;
    var krwCell = document.querySelector('#tbody_' + type + ' .krw-cell[data-code="' + code + '"]');
    if (krwCell) krwCell.textContent = krwPreview(amount);
    return true;
  }

  function uploadStandardFile(type) {
    var input = document.getElementById("uploadStandardFile_" + type);
    if (!input.files || !input.files[0]) {
      showToast(t("uploadNoFile"));
      return;
    }
    var file = input.files[0];
    var parsePromise = type === "PL" ? window.parseStandardPlReport(file) : window.parseStandardBsReport(file);
    parsePromise.then(function (rows) {
      var n = 0;
      if (type === "PL") {
        rows.forEach(function (r) {
          if (applyUpload("PL", r.accountCode, r.amountCny)) n++;
        });
      } else {
        var bsAccounts = accounts.filter(function (a) { return a.statementType === "BS"; });
        rows.forEach(function (r) {
          var match = bsAccounts.filter(function (a) { return a.nameZh === r.nameZh; })[0];
          if (match && applyUpload("BS", match.code, r.amountCny)) n++;
        });
      }
      scheduleAutosave(type);
      showToast(t("uploadSuccess", { n: n }));
    }).catch(function () {
      showToast(t("uploadStandardFail"));
    });
  }

  function applyClosedState() {
    var isClosed = closedMonths.indexOf(ctx.yearmonth) !== -1;
    var banner = document.getElementById("closedBanner");
    banner.style.display = isClosed ? "block" : "none";
    banner.textContent = isClosed ? t("monthClosedBanner", { yearmonth: ctx.yearmonth }) : "";
    document.querySelectorAll('#tabPanels button[data-action="submit"]').forEach(function (b) {
      b.disabled = isClosed;
    });
  }

  function submitTab(type) {
    if (closedMonths.indexOf(ctx.yearmonth) !== -1) {
      showToast(t("submitFailClosed"));
      return;
    }
    var lines = [];
    document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
      lines.push({ accountCode: input.dataset.code, amountCny: Number(input.value) || 0 });
    });
    client.rpc("submit_statement", {
      p_access_key: ctx.accessKey,
      p_corp: ctx.corp,
      p_office: ctx.office,
      p_yearmonth: ctx.yearmonth,
      p_statement_type: type,
      p_submitted_by: ctx.submitter,
      p_lines: lines
    }).then(function (res) {
      if (res.error) {
        if (String(res.error.message || "").indexOf("month_closed") !== -1) {
          closedMonths.push(ctx.yearmonth);
          applyClosedState();
          showToast(t("submitFailClosed"));
        } else {
          showToast(t("submitFail"));
        }
        return;
      }
      window.clearDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type));
      updateDraftInfo(type, null);
      showToast(t("submitSuccess"));
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  function bindTabs() {
    document.getElementById("tabBar").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab-btn");
      if (!btn) return;
      document.querySelectorAll("#tabBar .tab-btn").forEach(function (b) { b.classList.remove("tab-active"); });
      btn.classList.add("tab-active");
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("tab-active"); });
      document.querySelector('.tab-panel[data-panel="' + btn.dataset.tab + '"]').classList.add("tab-active");
    });
  }

  function loadAll() {
    if (!client) {
      showToast(t("submitFail"));
      return;
    }
    Promise.all([
      client.rpc("get_accounts", {}),
      client.rpc("get_statement", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      client.rpc("get_exchange_rate", { p_yearmonth: ctx.yearmonth }),
      window.fetchClosedMonths()
    ]).then(function (results) {
      accounts = (results[0].data || []).slice().sort(function (a, b) { return a.displayOrder - b.displayOrder; });
      (results[1].data || []).forEach(function (l) { existingLines[l.accountCode] = l.amountCny; });
      exchangeRate = results[2].data;
      closedMonths = results[3] || [];
      renderContextBar();
      renderPanels();
      applyClosedState();
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindTabs();
    bindPanelEvents();
    loadAll();
    document.addEventListener("langchange", function () {
      renderContextBar();
      renderPanels();
      applyClosedState();
    });
  });
})();
