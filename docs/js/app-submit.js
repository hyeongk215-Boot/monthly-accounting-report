(function () {
  var STATEMENT_TYPES = ["PL", "PL_KR", "BS", "CF"];
  var ctx = window.loadContext();
  if (!ctx) {
    window.location.href = "index.html";
    return;
  }

  var client = window.getSupabaseClient();
  var accounts = [];          // 전체 계정과목 (get_accounts)
  // PL과 PL_KR이 같은 AC CODE(예: 500000)를 공유하므로 "statementType::code"로 키를 분리합니다.
  var existingLines = {};     // "type::accountCode" -> amountCny (get_statement 프리필)
  var exchangeRate = null;    // 이 달 환율 (없으면 null)
  var closedMonths = [];
  var plKrExtra = {};         // { headcount, entertainmentCny } (get_pl_kr_extra 프리필)

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
    if (type === "PL") return t("tabPL");
    if (type === "PL_KR") return t("tabPLKR");
    if (type === "BS") return t("tabBS");
    return t("tabCF");
  }

  function plKrExtraHtml() {
    return (
      '<div class="note-box">' + t("plKrExtraNote") + "</div>" +
      '<div class="btn-row" style="align-items:center;">' +
        "<label>" + t("headcountLabel") + " <input type='number' step='1' id='plKrHeadcount' style='width:80px;'></label>" +
        "<label>" + t("entertainmentLabel") + " <input type='number' step='0.01' id='plKrEntertainment' style='width:120px;'></label>" +
        "<label>" + t("travelLabel") + " <input type='number' step='0.01' id='plKrTravel' style='width:120px;'></label>" +
      "</div>"
    );
  }

  function panelHtml(type) {
    return (
      '<div class="tab-panel' + (type === "PL" ? " tab-active" : "") + '" data-panel="' + type + '">' +
        '<div class="note-box" id="rateNote_' + type + '" style="display:none;">' + t("rateUnsetNote") + "</div>" +
        (type === "PL_KR" ? plKrExtraHtml() : "") +
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
      var lineKey = type + "::" + a.code;
      var initial = draftVal !== undefined ? draftVal : (existingLines[lineKey] !== undefined ? existingLines[lineKey] : "");
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
      if (type === "PL_KR") {
        submitPlKrExtra();
      } else {
        showToast(t("submitSuccess"));
      }
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  function submitPlKrExtra() {
    var hcEl = document.getElementById("plKrHeadcount");
    var entEl = document.getElementById("plKrEntertainment");
    var travelEl = document.getElementById("plKrTravel");
    client.rpc("submit_pl_kr_extra", {
      p_access_key: ctx.accessKey,
      p_corp: ctx.corp,
      p_office: ctx.office,
      p_yearmonth: ctx.yearmonth,
      p_headcount: hcEl && hcEl.value !== "" ? Number(hcEl.value) : null,
      p_entertainment_cny: entEl && entEl.value !== "" ? Number(entEl.value) : null,
      p_travel_cny: travelEl && travelEl.value !== "" ? Number(travelEl.value) : null,
      p_submitted_by: ctx.submitter
    }).then(function (res) {
      showToast(res.error ? t("submitFail") : t("submitSuccess"));
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
      window.fetchClosedMonths(),
      client.rpc("get_pl_kr_extra", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth })
    ]).then(function (results) {
      accounts = (results[0].data || []).slice().sort(function (a, b) { return a.displayOrder - b.displayOrder; });
      (results[1].data || []).forEach(function (l) { existingLines[l.statementType + "::" + l.accountCode] = l.amountCny; });
      exchangeRate = results[2].data;
      closedMonths = results[3] || [];
      plKrExtra = results[4].data || {};
      renderContextBar();
      renderPanels();
      applyClosedState();
      var hcEl = document.getElementById("plKrHeadcount");
      var entEl = document.getElementById("plKrEntertainment");
      var travelEl = document.getElementById("plKrTravel");
      if (hcEl && plKrExtra.headcount != null) hcEl.value = plKrExtra.headcount;
      if (entEl && plKrExtra.entertainmentCny != null) entEl.value = plKrExtra.entertainmentCny;
      if (travelEl && plKrExtra.travelCny != null) travelEl.value = plKrExtra.travelCny;
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
