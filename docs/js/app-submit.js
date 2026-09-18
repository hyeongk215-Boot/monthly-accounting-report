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
  var lockedTypes = [];       // 이 법인/지점/월에 이미 제출되어 잠긴 제표종류 목록
  var plKrExtra = {};         // { headcount, entertainmentCny } (get_pl_kr_extra 프리필)

  function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 3000);
  }

  function renderMyChecklist() {
    var body = document.getElementById("myChecklistBody");
    if (!body) return;
    var months = window.recentYearMonths(3);
    Promise.all(months.map(function (ym) {
      return client.rpc("get_submission_locks", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ym });
    })).then(function (results) {
      var html = "";
      months.forEach(function (ym, i) {
        var locked = (results[i] && results[i].data) || [];
        var missing = STATEMENT_TYPES.filter(function (type) { return locked.indexOf(type) === -1; });
        html += "<div style='margin:4px 0;'><b>" + ym + "</b>: ";
        if (!missing.length) {
          html += "<span style='color:var(--ok);'>" + t("checklistAllDone") + "</span>";
        } else {
          html += "<span style='color:var(--danger);'>" + t("checklistMissingLabel") + " " +
            missing.map(statementTabLabel).join(", ") + "</span>";
        }
        html += "</div>";
      });
      body.innerHTML = html;
    }).catch(function () {
      body.innerHTML = "";
    });
  }

  function renderContextBar() {
    var el = document.getElementById("contextBar");
    el.innerHTML =
      "<span><b>" + t("corp") + "</b>: " + window.corpLabel(ctx.corp) + "</span>" +
      "<span><b>" + t("office") + "</b>: " + window.officeLabel(ctx.office) + "</span>" +
      "<span><b>" + t("yearmonth") + "</b>: <select id='ymSwitch'></select></span>" +
      "<span><b>" + t("submitterName") + "</b>: " + ctx.submitter + "</span>";
    var sel = document.getElementById("ymSwitch");
    window.generateYearMonths().forEach(function (ym) {
      var o = document.createElement("option");
      o.value = ym; o.textContent = ym;
      sel.appendChild(o);
    });
    sel.value = ctx.yearmonth;
    sel.addEventListener("change", function () {
      ctx.yearmonth = sel.value;
      window.saveContext(ctx);
      loadAll();
    });
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

  // PL(한국)의 인원수/접대비/출장비. 표에 없는 값이라 놓치기 쉬워서 별도 박스로 크게 띄우고,
  // 세 칸이 다 채워지지 않으면 submitTab()에서 제출 자체를 막습니다.
  var PLKR_EXTRA_FIELDS = [
    { id: "plKrHeadcount", labelKey: "headcountLabel", storeKey: "headcount" },
    { id: "plKrEntertainment", labelKey: "entertainmentLabel", storeKey: "entertainmentCny" },
    { id: "plKrTravel", labelKey: "travelLabel", storeKey: "travelCny" }
  ];

  function plKrExtraHtml() {
    // 금액 칸과 마찬가지로 천단위 콤마를 넣기 위해 type=text입니다(=number는 콤마를 못 받음).
    var fields = PLKR_EXTRA_FIELDS.map(function (f) {
      return (
        "<div>" +
          '<label for="' + f.id + '">' + t(f.labelKey) + ' <span class="req-mark">*</span></label>' +
          "<input type='text' inputmode='decimal' id='" + f.id + "' class='plkr-extra'>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="required-box">' +
        '<p class="required-box-title">' + t("plKrExtraHeading") + "</p>" +
        '<p class="required-box-desc">' + t("plKrExtraNote") + "</p>" +
        '<div class="form-grid" style="margin-bottom:0;">' + fields + "</div>" +
        '<div class="note-box" id="plKrBackfillNote" style="display:none;">' + t("plKrBackfillNote") + "</div>" +
        '<div class="btn-row" id="plKrBackfillRow" style="display:none;">' +
          '<button class="btn-primary" data-action="backfill" data-type="PL_KR">' + t("plKrBackfillBtn") + "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function plKrExtraInputs() {
    return PLKR_EXTRA_FIELDS.map(function (f) {
      return { el: document.getElementById(f.id), id: f.id, stored: plKrExtra[f.storeKey] };
    });
  }

  // 서버 저장값 -> 임시저장 초안 순으로 세 칸을 채우고, 잠금 상태에 맞춰 보완입력 UI를 켭니다.
  // renderPanels()가 패널 innerHTML을 통째로 다시 만들기 때문에(언어 전환 포함) 렌더 뒤에는
  // 항상 이 함수를 다시 불러야 값이 날아가지 않습니다.
  function applyPlKrExtra() {
    var draft = window.loadDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, "PL_KR"));
    var draftExtra = (draft && draft.extra) || {};
    var locked = isLocked("PL_KR");
    var closed = closedMonths.indexOf(ctx.yearmonth) !== -1;
    var hasBlank = false;

    plKrExtraInputs().forEach(function (f) {
      if (!f.el) return;
      // 잠긴 뒤에도 "아직 비어 있는" 칸만 열어둡니다. 이미 저장된 값은 잠가서 덮어쓰기를 막습니다.
      var lockedField = locked && f.stored != null;
      var draftVal = draftExtra[f.id];
      // 초안은 제출 성공 시 지워지므로, 남아 있다면 아직 제출 안 된 사용자의 입력입니다.
      // 그래서 서버 저장값보다 우선합니다(잠긴 칸은 예외 - 항상 서버 값을 보여줍니다).
      if (!lockedField && draftVal != null && draftVal !== "") f.el.value = window.formatAmount(draftVal);
      else if (f.stored != null) f.el.value = window.formatAmount(f.stored);
      f.el.disabled = closed || lockedField;
      if (locked && !closed && f.stored == null) hasBlank = true;
    });

    var note = document.getElementById("plKrBackfillNote");
    var row = document.getElementById("plKrBackfillRow");
    if (note) note.style.display = hasBlank ? "block" : "none";
    if (row) row.style.display = hasBlank ? "flex" : "none";
  }

  // 지금 선택돼 있는 탭. 탭 바(#tabBar)는 다시 그리지 않고 패널만 다시 그리기 때문에,
  // 패널을 만들 때 항상 여기를 물어봐야 탭 버튼 강조와 실제 보이는 패널이 어긋나지 않습니다.
  // (언어 전환·적용년월 변경 때 renderPanels()가 불립니다.)
  function activeTabType() {
    var btn = document.querySelector("#tabBar .tab-btn.tab-active");
    return btn && btn.dataset.tab ? btn.dataset.tab : STATEMENT_TYPES[0];
  }

  function panelHtml(type) {
    return (
      '<div class="tab-panel' + (type === activeTabType() ? " tab-active" : "") + '" data-panel="' + type + '">' +
        '<div class="note-box" id="rateNote_' + type + '" style="display:none;">' + t("rateUnsetNote") + "</div>" +
        '<div class="note-box" id="lockNote_' + type + '" style="display:none;">' + t("submissionLockedBanner") + "</div>" +
        (type === "PL_KR" ? plKrExtraHtml() : "") +
        '<div class="btn-row" style="align-items:center;">' +
          '<button class="btn-secondary" data-action="template" data-type="' + type + '">' + t("downloadTemplateBtn") + "</button>" +
          '<input type="file" id="uploadFile_' + type + '" accept=".xlsx">' +
          '<button class="btn-secondary" data-action="upload" data-type="' + type + '">' + t("uploadBtn") + "</button>" +
        "</div>" +
        '<div class="table-wrap">' +
          '<table class="exp-table"><thead><tr>' +
            "<th>" + t("colLineNo") + "</th><th>" + t("colAccount") + "</th><th>" + t("colAmountCny") + "</th><th>" + t("colAmountKrw") + "</th>" +
          '</tr></thead><tbody id="tbody_' + type + '"></tbody></table>' +
        "</div>" +
        '<div class="btn-row" style="align-items:center;">' +
          '<button class="btn-primary" data-action="submit" data-type="' + type + '">' + t("submitTabBtn") + "</button>" +
          '<button class="btn-secondary" data-action="draft" data-type="' + type + '" title="' + t("draftLocalNote") + '">' +
            t("draftSaveBtn") + "</button>" +
          '<span class="draft-info" id="draftInfo_' + type + '"></span>' +
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
        "<td style='text-align:center; color:var(--muted);'>" + (a.lineNo || "") + "</td>" +
        "<td style='text-align:left;'>" + accountLabel(a) + "</td>" +
        "<td><input type='text' inputmode='decimal' data-code='" + a.code + "' class='amt-cny' value='" + window.formatAmount(initial) + "'></td>" +
        "<td class='krw-cell' data-code='" + a.code + "'>" + krwPreview(initial) + "</td>";
      tbody.appendChild(tr);
    });
    updateDraftInfo(type, draft);
    var rateNote = document.getElementById("rateNote_" + type);
    if (rateNote) rateNote.style.display = exchangeRate ? "none" : "block";
  }

  function krwPreview(amountCny) {
    // 화면 값에는 콤마가 섞여 있으므로 반드시 벗겨낸 뒤 숫자로 바꿉니다.
    var n = Number(window.parseAmount(amountCny));
    if (!n || !exchangeRate) return "-";
    return Math.round(n * exchangeRate).toLocaleString();
  }

  function updateDraftInfo(type, draft) {
    var el = document.getElementById("draftInfo_" + type);
    if (!el) return;
    el.textContent = draft && draft._savedAt
      ? "💾 " + t("draftSavedAt") + ": " + window.formatSavedAt(draft._savedAt)
      : "";   // 비어 있으면 CSS의 .draft-info:empty 가 칩을 통째로 숨깁니다.
  }

  // 임시저장에는 **콤마를 벗긴 값**만 넣습니다. 예전 초안(콤마 없던 시절)과도 형식이 같아
  // 이미 저장해둔 초안이 그대로 살아납니다.
  function saveDraftNow(type) {
    var values = {};
    document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
      values[input.dataset.code] = window.parseAmount(input.value);
    });
    var payload = { values: values };
    // PL_KR은 표 밖에 있는 인원수/접대비/출장비도 같이 보관해야 새로고침·언어전환에도 살아남습니다.
    if (type === "PL_KR") {
      payload.extra = {};
      plKrExtraInputs().forEach(function (f) {
        if (f.el) payload.extra[f.id] = window.parseAmount(f.el.value);
      });
    }
    var saved = window.saveDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type), payload);
    updateDraftInfo(type, { _savedAt: saved });
  }

  var saveTimers = {};
  function scheduleAutosave(type) {
    clearTimeout(saveTimers[type]);
    saveTimers[type] = setTimeout(function () { saveDraftNow(type); }, 600);
  }

  // 「임시저장」 버튼: 자동저장을 기다리지 않고 즉시 저장하고, 저장됐다는 걸 눈으로 확인시켜 줍니다.
  function saveDraftManual(type) {
    clearTimeout(saveTimers[type]);
    saveDraftNow(type);
    showToast(t("draftSaved"));
  }

  function bindPanelEvents() {
    document.getElementById("tabPanels").addEventListener("input", function (e) {
      if (e.target.classList.contains("plkr-extra")) {
        window.formatAmountInput(e.target);
        scheduleAutosave("PL_KR");
        return;
      }
      if (!e.target.classList.contains("amt-cny")) return;
      window.formatAmountInput(e.target);
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
      if (action === "draft") saveDraftManual(type);
      if (action === "backfill") backfillPlKrExtra();
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
    el.value = window.formatAmount(amount);
    var krwCell = document.querySelector('#tbody_' + type + ' .krw-cell[data-code="' + code + '"]');
    if (krwCell) krwCell.textContent = krwPreview(amount);
    return true;
  }

  function applyClosedState() {
    var isClosed = closedMonths.indexOf(ctx.yearmonth) !== -1;
    var banner = document.getElementById("closedBanner");
    banner.style.display = isClosed ? "block" : "none";
    banner.textContent = isClosed ? t("monthClosedBanner", { yearmonth: ctx.yearmonth }) : "";
    document.querySelectorAll('#tabPanels button[data-action="submit"], #tabPanels button[data-action="backfill"]').forEach(function (b) {
      if (isClosed) b.disabled = true;
    });
  }

  function isLocked(type) {
    return lockedTypes.indexOf(type) !== -1;
  }

  function applyLockedState() {
    STATEMENT_TYPES.forEach(function (type) {
      var locked = isLocked(type);
      var lockNote = document.getElementById("lockNote_" + type);
      if (lockNote) lockNote.style.display = locked ? "block" : "none";
      var panel = document.querySelector('.tab-panel[data-panel="' + type + '"]');
      if (!panel) return;
      // ⚠ .plkr-extra(인원수/접대비/출장비)는 여기서 손대지 않습니다. 잠긴 뒤에도 "비어 있는 칸만"
      //   보완 입력할 수 있어야 해서, 그 세 칸의 disabled는 applyPlKrExtra()가 전담합니다.
      panel.querySelectorAll("input, button").forEach(function (el) {
        if (el.type === "file" || el.dataset.action === "submit" || el.classList.contains("amt-cny") ||
            el.dataset.action === "upload") {
          el.disabled = locked;
        }
      });
    });
  }

  function submitTab(type) {
    if (closedMonths.indexOf(ctx.yearmonth) !== -1) {
      showToast(t("submitFailClosed"));
      return;
    }
    if (isLocked(type)) {
      showToast(t("submissionLockedBanner"));
      return;
    }
    // 제출하면 바로 잠기므로, 세 칸이 비어 있으면 잠기기 전에 여기서 막습니다.
    if (type === "PL_KR" && !requirePlKrExtra()) return;
    if (!confirm(t("submitWarningConfirm"))) return;
    var lines = [];
    document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
      lines.push({ accountCode: input.dataset.code, amountCny: Number(window.parseAmount(input.value)) || 0 });
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
        var msg = String(res.error.message || "");
        if (msg.indexOf("month_closed") !== -1) {
          closedMonths.push(ctx.yearmonth);
          applyClosedState();
          showToast(t("submitFailClosed"));
        } else if (msg.indexOf("submission_locked") !== -1) {
          lockedTypes.push(type);
          applyLockedState();
          showToast(t("submissionLockedBanner"));
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
        lockSubmission(type);
        showToast(t("submitSuccess"));
      }
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  function lockSubmission(type) {
    client.rpc("lock_submission", {
      p_access_key: ctx.accessKey,
      p_corp: ctx.corp,
      p_office: ctx.office,
      p_yearmonth: ctx.yearmonth,
      p_statement_type: type,
      p_locked_by: ctx.submitter
    }).then(function (res) {
      if (res.error) return;
      lockedTypes.push(type);
      applyLockedState();
    });
  }

  // 세 칸이 모두 채워졌는지 검사하고, 비어 있으면 첫 빈 칸으로 커서를 옮깁니다.
  function requirePlKrExtra() {
    var blank = null;
    plKrExtraInputs().forEach(function (f) {
      if (!blank && f.el && !f.el.disabled && window.parseAmount(f.el.value) === "") blank = f.el;
    });
    if (!blank) return true;
    showToast(t("plKrExtraMissing"));
    blank.focus();
    blank.scrollIntoView({ block: "center" });
    return false;
  }

  function plKrExtraPayload() {
    var byId = {};
    plKrExtraInputs().forEach(function (f) {
      var raw = f.el ? window.parseAmount(f.el.value) : "";
      byId[f.id] = raw === "" ? null : Number(raw);
    });
    return {
      p_access_key: ctx.accessKey,
      p_corp: ctx.corp,
      p_office: ctx.office,
      p_yearmonth: ctx.yearmonth,
      p_headcount: byId.plKrHeadcount,
      p_entertainment_cny: byId.plKrEntertainment,
      p_travel_cny: byId.plKrTravel,
      p_submitted_by: ctx.submitter
    };
  }

  function submitPlKrExtra() {
    client.rpc("submit_pl_kr_extra", plKrExtraPayload()).then(function (res) {
      if (res.error) {
        showToast(t("submitFail"));
        return;
      }
      lockSubmission("PL_KR");
      showToast(t("submitSuccess"));
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  // 이미 잠긴 뒤에 비어 있던 인원수/접대비/출장비만 채워 넣는 경로입니다.
  // 재무제표 금액은 건드리지 않고(submit_statement를 부르지 않음), 서버도 이미 값이 있는 칸은
  // coalesce로 지켜주므로 제출이 끝난 데이터가 덮어써질 수 없습니다.
  function backfillPlKrExtra() {
    if (closedMonths.indexOf(ctx.yearmonth) !== -1) {
      showToast(t("submitFailClosed"));
      return;
    }
    if (!requirePlKrExtra()) return;
    client.rpc("submit_pl_kr_extra", plKrExtraPayload()).then(function (res) {
      if (res.error) {
        showToast(t("submitFail"));
        return;
      }
      window.clearDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, "PL_KR"));
      showToast(t("plKrBackfillSuccess"));
      loadAll();
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
    existingLines = {};
    lockedTypes = [];
    plKrExtra = {};
    Promise.all([
      client.rpc("get_accounts", {}),
      client.rpc("get_statement", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      client.rpc("get_exchange_rate", { p_yearmonth: ctx.yearmonth }),
      window.fetchClosedMonths(),
      client.rpc("get_pl_kr_extra", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      client.rpc("get_submission_locks", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth })
    ]).then(function (results) {
      accounts = (results[0].data || []).slice().sort(function (a, b) { return a.displayOrder - b.displayOrder; });
      (results[1].data || []).forEach(function (l) { existingLines[l.statementType + "::" + l.accountCode] = l.amountCny; });
      exchangeRate = results[2].data;
      closedMonths = results[3] || [];
      plKrExtra = results[4].data || {};
      lockedTypes = results[5].data || [];
      renderContextBar();
      renderPanels();
      applyClosedState();
      applyLockedState();
      applyPlKrExtra();
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindTabs();
    bindPanelEvents();
    loadAll();
    renderMyChecklist();
    document.addEventListener("langchange", function () {
      renderContextBar();
      renderPanels();
      applyClosedState();
      applyLockedState();
      applyPlKrExtra();
      renderMyChecklist();
    });
  });
})();
