(function () {
  var STATEMENT_TYPES = ["PL", "PL_KR", "BS", "CF"];
  var ctx = window.loadContext();
  if (!ctx) {
    window.location.href = "index.html";
    return;
  }

  var client = window.getSupabaseClient();
  var accounts = [];          // 전체 계정과목 (get_accounts, formula 포함)
  // PL과 PL_KR이 같은 AC CODE(예: 500000)를 공유하므로 "statementType::code"로 키를 분리합니다.
  var existingLines = {};     // "type::accountCode" -> amountCny (get_statement 프리필)
  var exchangeRate = null;    // 이 달 환율 (없으면 null)
  var closedMonths = [];
  var lockedTypes = [];       // 이 법인/지점/월에 이미 제출되어 잠긴 제표종류 목록
  var plKrExtra = {};         // { headcount, entertainmentCny } (get_pl_kr_extra 프리필)
  var staleDraftTypes = {};   // type -> true: 이미 제출돼 잠긴 탭이라 이 PC의 옛 임시저장본을 버린 경우(안내 표시용)

  // ===== 서버 공유 임시저장 (2단계) =====
  // 임시저장을 서버(acct_statement_drafts)에 두어 같은 지점 키로 들어온 사람은 누구나 볼 수 있게 합니다.
  // 서버 함수가 아직 배포되지 않았거나 호출이 실패하면 serverDraftsEnabled=false 로 남아, 예전처럼
  // 이 PC(localStorage)에만 저장합니다. 그래서 SQL 배포 전/후 어느 쪽이든 화면이 깨지지 않습니다.
  var serverDraftsEnabled = false;
  var serverDrafts = {};      // type -> { payload, savedBy, savedAt, version } (서버가 가진 임시저장)
  var draftBase = {};         // type -> 내가 마지막으로 읽거나 저장한 서버 version (없으면 null)
  var draftConflict = {};     // type -> 서버에 더 새로 저장된 다른 사람의 임시저장(충돌 안내용)
  var draftStatus = {};       // type -> { state: 'synced'|'saving'|'failed'|'conflict', by, at }
  var saveInFlight = {};      // type -> true: 서버 저장 요청이 진행 중
  var saveQueued = {};        // type -> true: 진행 중에 입력이 더 있어 끝나면 한 번 더 저장해야 함
  var serverSaveTimers = {};
  var SERVER_SAVE_DELAY = 3000;   // 마지막 입력 후 3초 뒤 서버에 저장(키 입력마다 보내지 않기 위함)
  var autosavePending = {};       // type -> true: 이 PC 자동저장(0.6초 뒤) 대기 중 — 달을 옮기기 전에 먼저 비워야 함

  // ===== 월별 제출 현황표 (3단계) =====
  // get_submission_overview 가 있으면 "최근 3개월" 카드 대신 전체 월 × 제표 4종 현황표를 보여줍니다.
  // 함수가 없거나 실패하면 예전의 최근 3개월 카드(renderMyChecklist)로 폴백합니다.
  var overviewMode = false;
  var overviewSupported = true;   // 서버에 get_submission_overview 가 없으면(PGRST202) false — 이후엔 다시 부르지 않습니다
  var overviewSeq = 0;            // 읽기 요청 번호: 늦게 도착한 옛 응답이 새 응답을 덮어쓰지 않도록
  var overviewCells = {};         // "YYYY-MM|TYPE" -> { state: submitted|draft|partial, by, at }
  var overviewClosed = [];        // 마감된 달 목록
  var overviewTimer = null;
  var ovOpen = false;             // 상세 표를 펼쳤는지(다시 그려도 유지)
  var ovShowClosed = false;       // 마감된 달도 보기
  var ovOnlyMissing = false;      // 미제출이 있는 달만 보기

  // ===== 자동계산 (阶段一 · 财务报表自动计算 方案 v5) =====
  var formulaPlans = {};      // type -> 위상정렬된 공식 목록 (buildFormulaPlan)
  var calcModes = {};         // type -> 'auto' | 'legacy'
  // 대조값: 업로드한 엑셀에 들어있던 회계프로그램 산출 합계. 합계행은 이 값을 화면에 넣지 않고
  // 여기에 따로 담아둔 뒤 시스템 계산값과 비교만 합니다 (v5 3.8).
  var compareValues = {};     // type -> { accountCode: 숫자 }

  // 이 제표가 자동계산 대상인지. 'legacy'(2026-01~08 동결 구간)면 예전처럼 전부 수기입력입니다.
  function isAutoCalc(type) {
    return calcModes[type] !== "legacy" && (formulaPlans[type] || []).length > 0;
  }

  function formulaOf(type, code) {
    if (!isAutoCalc(type)) return null;
    var plan = formulaPlans[type] || [];
    for (var i = 0; i < plan.length; i++) {
      if (plan[i].code === code) return plan[i];
    }
    return null;
  }

  // 공식을 사람이 읽을 수 있게 — "[BS-L18]-[BS-L19]" -> "固定资产原价 − 累计折旧"
  function formulaHint(type, plan) {
    var names = {};
    accounts.forEach(function (a) {
      if (a.statementType === type) names[a.code] = accountLabel(a);
    });
    return plan.terms.map(function (term, i) {
      var op = term.sign < 0 ? "− " : (i === 0 ? "" : "+ ");
      return op + (names[term.code] || term.code);
    }).join(" ");
  }

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

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // from~to(포함) 사이의 'YYYY-MM' 목록(오름차순)
  function monthsBetween(from, to) {
    var out = [];
    var y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
    var ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
    while (y < ey || (y === ey && m <= em)) {
      out.push(y + "-" + String(m).padStart(2, "0"));
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  // 현황표가 다루는 기간: 시스템 시작월 ~ 전월(이미 제출했어야 하는 달까지)
  function overviewRange() {
    var from = window.MIN_YEARMONTH;
    var to = window.defaultYearMonth();
    return { from: from, to: to < from ? from : to };
  }

  function setChecklistHeading(overview) {
    var h = document.getElementById("checklistHeading");
    if (!h) return;
    var key = overview ? "overviewHeading" : "myChecklistHeading";
    h.setAttribute("data-i18n", key);
    h.textContent = t(key);
  }

  // 서버에서 현황(+마감월)을 읽어 표를 그립니다. 함수가 없거나 실패하면 예전의 "최근 3개월" 카드로 폴백합니다.
  function refreshOverview() {
    var rg = overviewRange();
    var mySeq = ++overviewSeq;
    return Promise.all([
      client.rpc("get_submission_overview", {
        p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_from: rg.from, p_to: rg.to
      }).then(function (r) { return r; }, function () { return { error: { message: "network" } }; }),
      window.fetchClosedMonths()
    ]).then(function (res) {
      if (mySeq !== overviewSeq) return;     // 더 새로운 읽기가 시작됐다 → 이 응답은 버립니다
      var r = res[0] || {};
      if (r.error || !Array.isArray(r.data)) {
        var msg = String((r.error && r.error.message) || "");
        if (String((r.error && r.error.code) || "") === "PGRST202" || msg.indexOf("Could not find the function") !== -1) {
          overviewSupported = false;         // SQL 미적용: 이 화면을 연 동안은 다시 묻지 않습니다
        }
        overviewMode = false;
        setChecklistHeading(false);
        renderMyChecklist();
        return;
      }
      overviewMode = true;
      overviewClosed = res[1] || [];
      overviewCells = {};
      r.data.forEach(function (c) { overviewCells[c.yearmonth + "|" + c.statementType] = c; });
      setChecklistHeading(true);
      renderOverview();
    });
  }

  // 임시저장·삭제처럼 상태가 바뀐 뒤 잠시 모아서 한 번만 다시 읽습니다.
  // 현황표를 쓸 수 없는 상태(SQL 미적용)면 아무것도 하지 않습니다 — 예전 카드는 제출 여부만 보여주므로 다시 그릴 필요가 없습니다.
  function scheduleOverviewRefresh(delay) {
    if (!overviewSupported) return;
    clearTimeout(overviewTimer);
    overviewTimer = setTimeout(refreshOverview, delay == null ? 800 : delay);
  }

  // 제출(잠금)로 상태가 바뀐 뒤: 현황표가 있으면 그것을, 없으면 예전의 "최근 3개월" 카드를 갱신합니다.
  function refreshChecklistAfterSubmit() {
    if (overviewSupported) scheduleOverviewRefresh(300); else renderMyChecklist();
  }

  // 칸 하나의 표시 상태. 마감된 달에서 제출 안 된 칸은 지점이 할 수 있는 일이 없으니 "마감"으로 표시합니다.
  function cellView(ym, type) {
    var c = overviewCells[ym + "|" + type];
    var closed = overviewClosed.indexOf(ym) !== -1;
    if (closed && (!c || c.state !== "submitted")) return { state: "closed", cell: c || null };
    if (c) return { state: c.state, cell: c };
    return { state: "missing", cell: null };
  }

  // 칸 안의 표시: 상태 + (있으면) 누가·언제. 마우스를 올릴 수 없는 모바일에서도 보이도록 칸 안에 직접 적습니다.
  function overviewCellHtml(v) {
    var label;
    if (v.state === "submitted") label = "✅ " + t("overviewStateSubmitted");
    else if (v.state === "draft") label = "✏️ " + t("overviewStateDraft");
    else if (v.state === "partial") label = "⚠ " + t("overviewStatePartial");
    else if (v.state === "closed") label = "🔒 " + t("overviewStateClosed");
    else label = t("overviewStateMissing");
    var who = "";
    if (v.cell && v.state !== "closed") {
      var when = v.cell.at ? window.formatSavedAt(v.cell.at).slice(5) : "";   // 'MM-DD HH:mm'
      var line = [v.cell.by || "", when].filter(Boolean).join(" · ");
      if (line) who = "<small>" + escHtml(line) + "</small>";
    }
    return label + who;
  }

  function overviewCellTip(v) {
    var by = v.cell ? (v.cell.by || "") : "";
    var time = v.cell && v.cell.at ? window.formatSavedAt(v.cell.at) : "";
    if (v.state === "submitted") return t("overviewTipSubmitted", { by: by, time: time });
    if (v.state === "draft") return t("overviewTipDraft", { by: by, time: time });
    if (v.state === "partial") return t("overviewTipPartial", { by: by, time: time });
    if (v.state === "closed") return t("overviewTipClosed");
    return t("overviewTipMissing");
  }

  function renderOverview() {
    var body = document.getElementById("myChecklistBody");
    if (!body) return;
    var oldDetails = body.querySelector("#ovDetails");
    if (oldDetails) ovOpen = oldDetails.open;                        // 다시 그리기 전에 지금 펼쳐져 있는지 기억
    var oldWrap = body.querySelector(".ov-wrap");
    var keepTop = oldWrap ? oldWrap.scrollTop : 0;                   // 표 안의 스크롤 위치도 기억(저장할 때마다 맨 위로 튀지 않게)
    var rg = overviewRange();
    var months = monthsBetween(rg.from, rg.to).reverse();            // 최근 달이 위로
    var openMonths = months.filter(function (ym) { return overviewClosed.indexOf(ym) === -1; });

    // 집계는 마감되지 않은 달만: 마감된 달은 지점이 더 할 수 있는 일이 없다.
    var done = 0, drafting = 0, missing = 0, next = null;
    openMonths.slice().reverse().forEach(function (ym) {              // 가장 오래된 달부터 훑어 "다음 할 일"을 찾는다
      STATEMENT_TYPES.forEach(function (type) {
        var v = cellView(ym, type);
        if (v.state === "submitted") done++;
        else {
          if (v.state === "draft" || v.state === "partial") drafting++; else missing++;
          if (!next) next = { ym: ym, type: type };
        }
      });
    });
    var total = openMonths.length * STATEMENT_TYPES.length;

    var summary = "";
    if (total > 0 && done === total) {
      summary = "<span style='color:var(--ok); font-weight:600;'>" + t("overviewAllDone") + "</span>";
    } else if (total > 0) {
      summary = t("overviewSummary", { done: done, total: total, draft: drafting, missing: missing });
    }

    var rows = months.filter(function (ym) {
      var isClosed = overviewClosed.indexOf(ym) !== -1;
      if (isClosed && !ovShowClosed) return false;
      if (ovOnlyMissing) {
        return STATEMENT_TYPES.some(function (type) {
          var s = cellView(ym, type).state;
          return s !== "submitted" && s !== "closed";
        });
      }
      return true;
    }).map(function (ym) {
      var cells = STATEMENT_TYPES.map(function (type) {
        var v = cellView(ym, type);
        return "<td class='ov-cell ov-" + v.state + "' data-ym='" + ym + "' data-type='" + type + "' title='" +
          escHtml(overviewCellTip(v)) + "'>" + overviewCellHtml(v) + "</td>";
      }).join("");
      return "<tr class='" + (ym === ctx.yearmonth ? "ov-current" : "") + "'><td class='ov-month'>" + ym +
        (overviewClosed.indexOf(ym) !== -1 ? " 🔒" : "") + "</td>" + cells + "</tr>";
    }).join("");

    var head = "<th>" + t("overviewColMonth") + "</th>" + STATEMENT_TYPES.map(function (type) {
      return "<th>" + statementTabLabel(type) + "</th>";
    }).join("");

    body.innerHTML =
      '<p class="ov-summary">' + summary + "</p>" +
      (next
        ? '<div class="btn-row" style="margin:0 0 8px;"><button class="btn-primary" id="ovGoto" data-ym="' + next.ym +
          '" data-type="' + next.type + '">' + t("overviewGotoNext", { ym: next.ym, type: statementTabLabel(next.type) }) + "</button></div>"
        : "") +
      '<details id="ovDetails"><summary>' + t("overviewDetailsSummary", { from: rg.from, to: rg.to }) + "</summary>" +
        '<div class="ov-filters">' +
          '<label><input type="checkbox" id="ovShowClosed"' + (ovShowClosed ? " checked" : "") + "> " + t("overviewShowClosed") + "</label>" +
          '<label><input type="checkbox" id="ovOnlyMissing"' + (ovOnlyMissing ? " checked" : "") + "> " + t("overviewOnlyMissing") + "</label>" +
        "</div>" +
        '<div class="ov-wrap table-wrap"><table class="exp-table ov-table"><thead><tr>' + head + "</tr></thead><tbody>" +
          (rows || "<tr><td colspan='5' style='color:var(--muted);'>" + t("overviewNoRows") + "</td></tr>") +
        "</tbody></table></div>" +
        '<p class="desc" style="margin:6px 0 0; font-size:12px;">' + t("overviewHint") + "</p>" +
      "</details>";

    body.querySelector("#ovDetails").open = ovOpen;
    var newWrap = body.querySelector(".ov-wrap");
    if (newWrap) newWrap.scrollTop = keepTop;
  }

  function bindOverviewEvents() {
    var body = document.getElementById("myChecklistBody");
    if (!body) return;
    body.addEventListener("click", function (e) {
      var cell = e.target.closest(".ov-cell");
      if (cell) { gotoCell(cell.dataset.ym, cell.dataset.type); return; }
      var btn = e.target.closest("#ovGoto");
      if (btn) gotoCell(btn.dataset.ym, btn.dataset.type);
    });
    body.addEventListener("change", function (e) {
      if (e.target.id === "ovShowClosed") { ovShowClosed = e.target.checked; renderOverview(); }
      if (e.target.id === "ovOnlyMissing") { ovOnlyMissing = e.target.checked; renderOverview(); }
    });
  }

  // 현황표의 칸/버튼을 누르면 그 달·그 제표 탭으로 이동합니다.
  function gotoCell(ym, type) {
    flushDraftsBeforeLeave();          // 아직 서버에 못 올린 입력이 있으면 옮기기 전에 올립니다
    ctx.yearmonth = ym;
    window.saveContext(ctx);
    var tabBtn = document.querySelector('#tabBar .tab-btn[data-tab="' + type + '"]');
    if (tabBtn) tabBtn.click();
    loadAll();
    if (overviewMode) renderOverview();   // 현재 달 강조를 갱신
    var bar = document.getElementById("contextBar");
    if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderContextBar() {
    var el = document.getElementById("contextBar");
    el.innerHTML =
      "<span><b>" + t("corp") + "</b>: " + window.corpLabel(ctx.corp) + "</span>" +
      "<span><b>" + t("office") + "</b>: " + window.officeLabel(ctx.office) + "</span>" +
      "<span><b>" + t("yearmonth") + "</b>: <select id='ymSwitch'></select></span>" +
      "<span><b>" + t("submitterName") + "</b>: " + ctx.submitter + "</span>";
    var sel = document.getElementById("ymSwitch");
    // 마감월은 선택지에서 뺍니다. 단 지금 보고 있는 달이 마감된 경우는 남겨야
    // select가 엉뚱한 값을 가리키지 않습니다(그 달은 마감 배너가 따로 뜹니다).
    // openYearMonths 가 없으면(= 캐시된 옛 common.js) 전체 월을 보여줍니다.
    // 없는 채로 호출하면 예외로 선택지가 통째로 비어 달을 못 바꾸게 됩니다.
    var ymList = window.openYearMonths
      ? window.openYearMonths(closedMonths, ctx.yearmonth)
      : window.generateYearMonths();
    ymList.forEach(function (ym) {
      var o = document.createElement("option");
      o.value = ym;
      o.textContent = closedMonths.indexOf(ym) === -1 ? ym : ym + " " + t("ymClosedSuffix");
      sel.appendChild(o);
    });
    sel.value = ctx.yearmonth;
    sel.addEventListener("change", function () {
      flushDraftsBeforeLeave();          // 아직 서버에 못 올린 입력이 있으면 옮기기 전에 올립니다
      ctx.yearmonth = sel.value;
      window.saveContext(ctx);
      loadAll();
      if (overviewMode) renderOverview();   // 현황표의 현재 달 강조를 갱신
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
    // 잠긴 탭의 보완입력은 이 PC의 초안(서버 공유 대상 아님), 잠기지 않은 탭은 pickDraft(서버 임시저장 포함)를 봅니다.
    var draft = isLocked("PL_KR") ? window.loadDraft(dKey("PL_KR")) : pickDraft("PL_KR");
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
        '<div class="note-box" id="staleNote_' + type + '" style="display:none;">' + t("staleDraftNote") + "</div>" +
        // 서버에 임시저장된 내용을 불러왔을 때 "누가·언제 저장했는지" 알려 줍니다(다른 담당자의 입력이 보이는 이유).
        '<div class="note-box" id="draftOwner_' + type + '" style="display:none;"></div>' +
        // 내가 입력하는 사이 다른 사람이 서버에 먼저 저장했을 때: 어느 쪽을 쓸지 고르게 합니다.
        '<div class="note-box" id="draftConflict_' + type + '" style="display:none;">' +
          '<span class="conflict-msg"></span>' +
          '<div class="btn-row" style="margin:8px 0 0;">' +
            '<button class="btn-primary" data-action="conflict-server" data-type="' + type + '">' + t("draftConflictTakeServer") + "</button>" +
            '<button class="btn-secondary" data-action="conflict-mine" data-type="' + type + '">' + t("draftConflictKeepMine") + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="note-box" id="calcNote_' + type + '" style="display:none;">' + t("calcAutoNote") + "</div>" +
        '<div class="note-box" id="legacyNote_' + type + '" style="display:none;">' + t("calcLegacyNote") + "</div>" +
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
          '<button class="btn-secondary" id="draftDiscard_' + type + '" data-action="discard" data-type="' + type + '" style="display:none;">' +
            t("draftDiscardBtn") + "</button>" +
          '<span class="draft-info" id="draftInfo_' + type + '"></span>' +
        "</div>" +
        // 임시저장이 어디에 저장되는지(서버 공유 / 이 PC뿐)를 툴팁이 아니라 상시 문구로 알려 "다른 사람도 보겠지"라는 오해를 막습니다.
        '<p style="margin:6px 0 0; font-size:12px; color:var(--muted);">' +
          t(serverDraftsEnabled ? "draftScopeNoteServer" : "draftScopeNote") + "</p>" +
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
    var draft;
    if (isLocked(type)) {
      // 제출이 끝나 잠긴 탭은 언제나 서버 값을 보여줍니다. 이 PC에 남아 있던 옛 초안(표의 values/compare)은
      // 쓰지 않고 지웁니다. 초안을 우선하면 다른 사람이 제출한 뒤에도 이 PC의 초안(빈 칸·옛 숫자)이 제출된
      // 값을 가려서 "제출했는데 안 보인다"가 됩니다. 단 PL(한국)의 보완입력용 extra는 남겨 둡니다.
      var dkey = dKey(type);
      draft = window.loadDraft(dkey);
      if (draft && (draft.values || draft.compare)) {
        if (draft.extra) {
          localStorage.setItem(dkey, JSON.stringify({ extra: draft.extra, _savedAt: draft._savedAt }));
        } else {
          window.clearDraft(dkey);
        }
        draft = null;
        staleDraftTypes[type] = true;
      }
    } else {
      // 잠기지 않은 탭: 이 PC의 미전송 입력 > 서버 임시저장 순으로 고릅니다(pickDraft 참고).
      draft = pickDraft(type);
    }
    if (serverDraftsEnabled && draft && draft.source === "server" && serverDrafts[type]) {
      var cs = draftStatus[type];
      if (!cs || cs.state === "synced") {
        draftStatus[type] = { state: "synced", by: serverDrafts[type].savedBy, at: serverDrafts[type].savedAt };
      }
    }
    // 초안에 담아둔 대조값을 되살립니다(업로드 후 새로고침해도 경고가 유지되도록).
    compareValues[type] = (draft && draft.compare) || compareValues[type] || {};
    tbody.innerHTML = "";
    rows.forEach(function (a) {
      var tr = document.createElement("tr");
      var plan = formulaOf(type, a.code);
      if (a.isSubtotal) tr.className = "subtotal-row";
      var draftVal = draft && draft.values ? draft.values[a.code] : undefined;
      // 초안의 빈 칸("")은 입력한 값이 아니라 아직 안 채웠다는 뜻입니다. 서버 값을 가리지 않게 합니다.
      var hasDraftVal = draftVal !== undefined && draftVal !== null && String(draftVal).trim() !== "";
      var lineKey = type + "::" + a.code;
      var initial = hasDraftVal ? draftVal : (existingLines[lineKey] !== undefined ? existingLines[lineKey] : "");
      // 자동계산행은 readonly로 두되 input 자체는 남겨둡니다 — 제출 시 값을 모으는 코드와
      // KRW 미리보기가 .amt-cny 기준으로 돌아가고 있어서 구조를 바꾸면 더 위험합니다.
      tr.innerHTML =
        "<td style='text-align:center; color:var(--muted);'>" + (a.lineNo || "") + "</td>" +
        "<td style='text-align:left;'>" + accountLabel(a) +
          (plan ? "<span class='calc-badge' title='" + formulaHint(type, plan) + "'>" + t("calcAutoBadge") + "</span>" +
                  "<span class='calc-warn' data-code='" + a.code + "'></span>" : "") + "</td>" +
        "<td><input type='text' inputmode='decimal' data-code='" + a.code + "' class='amt-cny" +
          (plan ? " amt-calc' readonly tabindex='-1" : "") + "' value='" + window.formatAmount(initial) + "'></td>" +
        "<td class='krw-cell' data-code='" + a.code + "'>" + krwPreview(initial) + "</td>";
      tbody.appendChild(tr);
    });
    updateDraftInfo(type, draft);
    var staleNote = document.getElementById("staleNote_" + type);
    if (staleNote) staleNote.style.display = staleDraftTypes[type] ? "block" : "none";
    // 서버 임시저장을 불러온 경우 누가·언제 저장했는지 알려 줍니다.
    var ownerNote = document.getElementById("draftOwner_" + type);
    if (ownerNote) {
      var fromServer = !!(draft && draft.source === "server" && serverDrafts[type]);
      ownerNote.style.display = fromServer ? "block" : "none";
      if (fromServer) {
        ownerNote.textContent = t("draftLoadedFromServer", {
          by: serverDrafts[type].savedBy || "", time: window.formatSavedAt(serverDrafts[type].savedAt)
        });
      }
    }
    var discardBtn = document.getElementById("draftDiscard_" + type);
    if (discardBtn) {
      discardBtn.style.display = (serverDraftsEnabled && !isLocked(type) && (draft || serverDrafts[type])) ? "" : "none";
    }
    renderConflictBanner(type);
    var rateNote = document.getElementById("rateNote_" + type);
    if (rateNote) rateNote.style.display = exchangeRate ? "none" : "block";
    var calcNote = document.getElementById("calcNote_" + type);
    if (calcNote) calcNote.style.display = isAutoCalc(type) ? "block" : "none";
    var legacyNote = document.getElementById("legacyNote_" + type);
    if (legacyNote) legacyNote.style.display = calcModes[type] === "legacy" ? "block" : "none";
    recalcTable(type);
  }

  // 명세행 값으로 합계행을 다시 계산해 화면에 반영합니다.
  // 입력할 때마다 불리므로 DOM 조회는 tbody 하나로 한정합니다.
  function recalcTable(type) {
    if (!isAutoCalc(type)) return;
    var tbody = document.getElementById("tbody_" + type);
    if (!tbody) return;

    var values = {};
    tbody.querySelectorAll(".amt-cny").forEach(function (input) {
      values[input.dataset.code] = Number(window.parseAmount(input.value)) || 0;
    });
    window.evalFormulas(formulaPlans[type], values);

    var compare = compareValues[type] || {};
    formulaPlans[type].forEach(function (plan) {
      var input = tbody.querySelector('.amt-cny[data-code="' + plan.code + '"]');
      // 0.1+0.2 류의 부동소수 찌꺼기가 화면에 나오지 않도록 소수 2자리에서 끊습니다.
      // (String(1234.5) -> "1234.5" 처럼 불필요한 ".00"은 붙지 않습니다)
      if (input) input.value = window.formatAmount(String(Math.round(values[plan.code] * 100) / 100));
      var krwCell = tbody.querySelector('.krw-cell[data-code="' + plan.code + '"]');
      if (krwCell) krwCell.textContent = krwPreview(values[plan.code]);

      // 엑셀 원본 합계와 1원 넘게 벌어지면 노란 경고 (v5 3.8 / 5.4 ①)
      var warn = tbody.querySelector('.calc-warn[data-code="' + plan.code + '"]');
      if (!warn) return;
      if (compare[plan.code] == null) {
        warn.textContent = "";
        warn.removeAttribute("title");
        return;
      }
      var diff = values[plan.code] - Number(compare[plan.code]);
      if (Math.abs(diff) <= 1) {
        warn.textContent = "";
        warn.removeAttribute("title");
      } else {
        warn.textContent = "⚠";
        warn.title = t("calcCompareMismatch", {
          excel: Number(compare[plan.code]).toLocaleString(),
          diff: diff.toLocaleString()
        });
      }
    });
  }

  function krwPreview(amountCny) {
    // 화면 값에는 콤마가 섞여 있으므로 반드시 벗겨낸 뒤 숫자로 바꿉니다.
    var n = Number(window.parseAmount(amountCny));
    if (!n || !exchangeRate) return "-";
    return Math.round(n * exchangeRate).toLocaleString();
  }

  // 임시저장 칩. 서버 공유가 켜져 있으면 저장 상태(저장 중/서버에 저장됨/실패/충돌)를, 아니면 이 PC의
  // 마지막 임시저장 시각을 보여줍니다.
  function updateDraftInfo(type, draft) {
    var el = document.getElementById("draftInfo_" + type);
    if (!el) return;
    var st = serverDraftsEnabled ? draftStatus[type] : null;
    var text = "";
    if (st && st.state === "saving") text = "💾 " + t("draftChipSaving");
    else if (st && st.state === "failed") text = "⚠ " + t("draftChipFailed");
    else if (st && st.state === "conflict") text = "⚠ " + t("draftChipConflict");
    else if (st && st.state === "synced" && st.at) {
      text = "💾 " + t("draftChipServer", { by: st.by || "", time: window.formatSavedAt(st.at) });
    } else if (draft && draft._savedAt) {
      text = "💾 " + t("draftSavedAt") + ": " + window.formatSavedAt(draft._savedAt);
    }
    el.textContent = text;   // 비어 있으면 CSS의 .draft-info:empty 가 칩을 통째로 숨깁니다.
  }

  function dKey(type) {
    return window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type);
  }

  // 화면에 그릴 임시저장을 고릅니다. { values, compare, extra, _savedAt, source: 'local'|'server' } 또는 null.
  //  - 서버 공유가 꺼져 있으면(함수 미배포/실패) 예전처럼 이 PC의 초안만 씁니다.
  //  - 이 PC에 "아직 서버에 못 올린" 입력(dirty)이 있으면 그것이 가장 최신이라 우선합니다.
  //    dirty 표시가 없는 옛 초안(1단계까지 만든 초안)도 서버에 올라간 적이 없으니 같은 취급입니다.
  //  - 그 외에는 서버의 임시저장을 씁니다. 이미 서버와 맞춘 이 PC의 사본은 서버에 없으면 버립니다.
  function pickDraft(type) {
    var local = window.loadDraft(dKey(type));
    if (!serverDraftsEnabled) return local;
    if (local && local.dirty !== false) {
      local.source = "local";
      return local;
    }
    var srv = serverDrafts[type];
    if (srv) {
      var p = srv.payload || {};
      return { values: p.values || {}, compare: p.compare || {}, extra: p.extra || {}, _savedAt: srv.savedAt, source: "server" };
    }
    return null;
  }

  function renderConflictBanner(type) {
    var box = document.getElementById("draftConflict_" + type);
    if (!box) return;
    var c = serverDraftsEnabled ? draftConflict[type] : null;
    if (!c) { box.style.display = "none"; return; }
    box.querySelector(".conflict-msg").textContent = t("draftConflictMsg", {
      by: c.savedBy || "", time: window.formatSavedAt(c.savedAt)
    });
    box.style.display = "block";
  }

  // 임시저장에는 **콤마를 벗긴 값**만 넣습니다. 예전 초안(콤마 없던 시절)과도 형식이 같아
  // 이미 저장해둔 초안이 그대로 살아납니다.
  function saveDraftNow(type) {
    autosavePending[type] = false;
    var values = {};
    document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
      values[input.dataset.code] = window.parseAmount(input.value);
    });
    var payload = { values: values, compare: compareValues[type] || {} };
    // PL_KR은 표 밖에 있는 인원수/접대비/출장비도 같이 보관해야 새로고침·언어전환에도 살아남습니다.
    if (type === "PL_KR") {
      payload.extra = {};
      plKrExtraInputs().forEach(function (f) {
        if (f.el) payload.extra[f.id] = window.parseAmount(f.el.value);
      });
    }
    // 서버 공유가 켜져 있으면 "서버에 아직 못 올린 입력"임을 표시합니다. baseVersion은 내가 마지막으로 본 서버 version,
    // _seq는 서버로 보내는 사이 입력이 더 있었는지 가려내는 번호입니다.
    if (serverDraftsEnabled) {
      var prev = window.loadDraft(dKey(type));
      payload.baseVersion = draftBase[type] == null ? null : draftBase[type];
      payload.dirty = true;
      payload._seq = ((prev && prev._seq) || 0) + 1;
    }
    var saved = window.saveDraft(dKey(type), payload);
    updateDraftInfo(type, { _savedAt: saved });
    if (serverDraftsEnabled && !isLocked(type)) scheduleServerSave(type, false);
  }

  var saveTimers = {};
  function scheduleAutosave(type) {
    clearTimeout(saveTimers[type]);
    autosavePending[type] = true;
    saveTimers[type] = setTimeout(function () { saveDraftNow(type); }, 600);
  }

  // 달을 옮기기 전에: 이 PC 자동저장 대기 중인 입력을 먼저 저장하고, 서버에 못 올린 입력은 지금 올립니다.
  // 요청은 옮기기 전의 달 기준으로 즉시 만들어지므로(호출 시점에 ctx를 읽음) 다른 달 데이터와 섞이지 않습니다.
  // (자동저장 대기분을 비우지 않으면, 0.6초 뒤 타이머가 "옮긴 뒤의 달" 이름으로 옛 달의 입력을 저장해 버립니다.)
  function flushDraftsBeforeLeave() {
    STATEMENT_TYPES.forEach(function (type) {
      if (isLocked(type)) return;
      if (autosavePending[type]) {
        clearTimeout(saveTimers[type]);
        saveDraftNow(type);
      }
      if (!serverDraftsEnabled) return;
      var rec = window.loadDraft(dKey(type));
      if (rec && rec.dirty !== false) {
        clearTimeout(serverSaveTimers[type]);
        pushDraft(type, false);
      }
    });
  }

  // 「임시저장」 버튼: 자동저장을 기다리지 않고 즉시 저장하고, 저장됐다는 걸 눈으로 확인시켜 줍니다.
  function saveDraftManual(type) {
    clearTimeout(saveTimers[type]);
    saveDraftNow(type);                       // 이 PC에는 즉시 저장하고(서버 저장은 예약됨)
    if (!serverDraftsEnabled || isLocked(type)) {
      showToast(t("draftSaved"));
      return;
    }
    clearTimeout(serverSaveTimers[type]);     // 예약을 기다리지 않고 지금 서버에도 저장합니다
    pushDraft(type, false).then(function (result) {
      if (result === "ok") showToast(t("draftSavedServer"));
      else if (result === "conflict" || draftConflict[type]) showToast(t("draftToastConflict"));
      else if (result === "failed") showToast(t("draftSavedLocalOnly"));
      else showToast(t("draftSavedServer"));  // 진행 중인 저장에 이어붙은 경우
    });
  }

  function scheduleServerSave(type, immediate) {
    clearTimeout(serverSaveTimers[type]);
    serverSaveTimers[type] = setTimeout(function () { pushDraft(type, false); }, immediate ? 0 : SERVER_SAVE_DELAY);
  }

  // 이 PC에 저장된 초안을 서버에 올립니다. 결과: 'ok' | 'conflict' | 'failed' | 'skipped'
  function pushDraft(type, force) {
    if (!serverDraftsEnabled || isLocked(type)) return Promise.resolve("skipped");
    var rec = window.loadDraft(dKey(type));
    if (!rec) return Promise.resolve("skipped");
    if (draftConflict[type] && !force) return Promise.resolve("skipped");   // 충돌을 해결하기 전에는 덮어쓰지 않습니다
    if (saveInFlight[type]) { saveQueued[type] = true; return Promise.resolve("skipped"); }

    saveInFlight[type] = true;
    draftStatus[type] = { state: "saving" };
    updateDraftInfo(type, null);
    var seq = rec._seq || 0;
    var sent = { values: rec.values || {}, compare: rec.compare || {}, extra: rec.extra || {} };
    // 응답을 기다리는 사이 다른 달로 옮길 수 있으므로, 어느 달의 초안을 보냈는지 지금 적어 둡니다.
    var ymAtStart = ctx.yearmonth;
    var keyAtStart = dKey(type);
    return client.rpc("save_statement_draft", {
      p_access_key: ctx.accessKey,
      p_corp: ctx.corp,
      p_office: ctx.office,
      p_yearmonth: ctx.yearmonth,
      p_statement_type: type,
      p_saved_by: ctx.submitter,
      p_payload: sent,
      p_base_version: draftBase[type] == null ? null : draftBase[type],
      p_force: !!force
    }).then(function (res) {
      saveInFlight[type] = false;
      var moved = ctx.yearmonth !== ymAtStart;   // 응답을 기다리는 사이 다른 달로 옮겼다
      if (res.error) return moved ? "failed" : handlePushError(type, res.error);
      var r = res.data || {};
      if (r.conflict) {
        // 옮긴 뒤라면 화면은 건드리지 않습니다. 그 달을 다시 열 때 서버본과 비교해 충돌 안내가 뜹니다.
        if (moved) return "conflict";
        draftConflict[type] = r.current || null;
        draftStatus[type] = { state: "conflict" };
        updateDraftInfo(type, null);
        renderConflictBanner(type);
        return "conflict";
      }
      // 이 PC 사본은 "보냈던 달"의 것에 반영합니다(옮겼더라도).
      var cur = window.loadDraft(keyAtStart);
      if (cur) {
        cur.baseVersion = r.version;
        if ((cur._seq || 0) === seq) cur.dirty = false;   // 보내는 사이 입력이 더 없었을 때만 "서버와 맞춤"
        localStorage.setItem(keyAtStart, JSON.stringify(cur));
      }
      if (!moved) {
        draftBase[type] = r.version;
        serverDrafts[type] = { payload: sent, savedBy: ctx.submitter, savedAt: r.savedAt, version: r.version };
        draftStatus[type] = { state: "synced", by: ctx.submitter, at: r.savedAt };
        updateDraftInfo(type, null);
        var disc = document.getElementById("draftDiscard_" + type);
        if (disc) disc.style.display = "";
      }
      if (saveQueued[type]) {
        saveQueued[type] = false;
        // 보내는 사이 입력이 더 있었다면 한 번 더. 달을 옮긴 뒤라면 "지금 보는 달"의 미동기 초안이 있을 때만 올립니다.
        var now = window.loadDraft(dKey(type));
        if (now && now.dirty !== false) scheduleServerSave(type, true);
      }
      scheduleOverviewRefresh(1500);   // 현황표에 "작성 중"이 반영되도록
      return "ok";
    }).catch(function () {
      saveInFlight[type] = false;
      if (ctx.yearmonth === ymAtStart) {
        draftStatus[type] = { state: "failed" };
        updateDraftInfo(type, null);
      }
      return "failed";
    });
  }

  function handlePushError(type, err) {
    var msg = String((err && err.message) || "");
    var code = String((err && err.code) || "");
    if (code === "PGRST202" || msg.indexOf("Could not find the function") !== -1) {
      // 서버 함수가 아직 없다 → 예전처럼 이 PC에만 저장하는 방식으로 되돌립니다.
      serverDraftsEnabled = false;
      delete draftStatus[type];
      updateDraftInfo(type, window.loadDraft(dKey(type)));
      return "failed";
    }
    if (msg.indexOf("submission_locked") !== -1) {
      // 그 사이 다른 사람이 이 탭을 제출했다 → 제출된 값을 다시 불러옵니다.
      showToast(t("draftToastLocked"));
      loadAll();
      return "failed";
    }
    if (msg.indexOf("month_closed") !== -1) {
      closedMonths.push(ctx.yearmonth);
      applyClosedState();
      showToast(t("submitFailClosed"));
    }
    draftStatus[type] = { state: "failed" };
    updateDraftInfo(type, null);
    return "failed";
  }

  // 제출에 성공했으니 서버의 임시저장은 필요 없습니다. 지우기에 실패해도 서버가 "마지막 제출보다 오래된 초안"을
  // 조회에서 걸러 주므로 치명적이지 않습니다.
  function discardServerDraft(type) {
    clearTimeout(serverSaveTimers[type]);
    delete serverDrafts[type];
    delete draftConflict[type];
    delete draftStatus[type];
    draftBase[type] = null;
    if (!serverDraftsEnabled) return;
    client.rpc("delete_statement_draft", {
      p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office,
      p_yearmonth: ctx.yearmonth, p_statement_type: type
    }).then(function () {}, function () {});
  }

  // 「임시저장 지우기」: 서버와 이 PC의 임시저장을 모두 지우고 서버에 제출된 값(없으면 빈 표)으로 되돌립니다.
  function discardDraft(type) {
    if (!confirm(t("draftDiscardConfirm"))) return;
    clearTimeout(saveTimers[type]);
    clearTimeout(serverSaveTimers[type]);
    var finish = function () {
      window.clearDraft(dKey(type));
      delete serverDrafts[type];
      delete draftConflict[type];
      delete draftStatus[type];
      draftBase[type] = null;
      renderPanels();
      applyClosedState();
      applyLockedState();
      applyPlKrExtra();
      showToast(t("draftDiscarded"));
      scheduleOverviewRefresh();   // 현황표의 "작성 중" 칸이 "미제출"로 돌아가도록
    };
    if (!serverDraftsEnabled) { finish(); return; }
    client.rpc("delete_statement_draft", {
      p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office,
      p_yearmonth: ctx.yearmonth, p_statement_type: type
    }).then(function (res) {
      if (res.error) { showToast(t("submitFail")); return; }
      finish();
    }).catch(function () { showToast(t("submitFail")); });
  }

  // 충돌: 서버에 있는 다른 사람의 임시저장본을 가져옵니다(이 PC의 입력은 버려집니다).
  function resolveConflictTakeServer(type) {
    var c = draftConflict[type];
    if (!c) return;
    window.clearDraft(dKey(type));
    serverDrafts[type] = c;
    draftBase[type] = c.version;
    delete draftConflict[type];
    draftStatus[type] = { state: "synced", by: c.savedBy, at: c.savedAt };
    renderPanels();
    applyClosedState();
    applyLockedState();
    applyPlKrExtra();
  }

  // 충돌: 내 입력으로 덮어씁니다.
  function resolveConflictKeepMine(type) {
    var c = draftConflict[type];
    if (!c) return;
    draftBase[type] = c.version;
    delete draftConflict[type];
    var rec = window.loadDraft(dKey(type));
    if (rec) {
      rec.baseVersion = c.version;
      rec.dirty = true;
      localStorage.setItem(dKey(type), JSON.stringify(rec));
    }
    renderConflictBanner(type);
    pushDraft(type, true).then(function (result) {
      if (result === "ok") showToast(t("draftSavedServer"));
    });
  }

  // 화면을 그린 직후: 이 PC에 서버로 못 올린 입력이 있으면 올리고, 서버에 더 새로운 저장본이 있으면 충돌을 알립니다.
  function syncDraftsAfterLoad() {
    if (!serverDraftsEnabled) return;
    STATEMENT_TYPES.forEach(function (type) {
      if (isLocked(type)) return;
      var rec = window.loadDraft(dKey(type));
      var srv = serverDrafts[type];
      if (!rec) return;
      if (rec.dirty === false) {
        if (!srv) window.clearDraft(dKey(type));   // 서버에서 사라진 초안의 사본은 버립니다
        return;
      }
      if (srv && rec.baseVersion !== srv.version) {
        draftConflict[type] = srv;
        draftStatus[type] = { state: "conflict" };
        updateDraftInfo(type, rec);
        renderConflictBanner(type);
        return;
      }
      scheduleServerSave(type, true);
    });
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
      recalcTable(type);
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
      if (action === "discard") discardDraft(type);
      if (action === "conflict-server") resolveConflictTakeServer(type);
      if (action === "conflict-mine") resolveConflictKeepMine(type);
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
      recalcTable(type);
      scheduleAutosave(type);
      showToast(t("uploadSuccess", { n: n }));
    }).catch(function () {
      showToast(t("uploadFail"));
    });
  }

  function applyUpload(type, code, amount) {
    var el = document.querySelector('#tbody_' + type + ' .amt-cny[data-code="' + code + '"]');
    if (!el) return false;
    // 자동계산행은 엑셀 값을 화면에 넣지 않고 **대조값**으로만 받습니다 (v5 3.8).
    // 지점은 종전처럼 회계프로그램 표를 통째로 붙여 올리면 되고, 합계는 시스템이 다시 계산해
    // 두 값을 자동으로 비교합니다.
    if (formulaOf(type, code)) {
      compareValues[type] = compareValues[type] || {};
      compareValues[type][code] = Number(amount) || 0;
      return true;
    }
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
    recalcTable(type);
    var compare = compareValues[type] || {};
    var lines = [];
    document.querySelectorAll("#tbody_" + type + " .amt-cny").forEach(function (input) {
      var code = input.dataset.code;
      var line = { accountCode: code, amountCny: Number(window.parseAmount(input.value)) || 0 };
      // 대조값은 있을 때만 실어 보냅니다. 서버는 null이 오면 기존 대조값을 지우지 않고 유지합니다.
      if (compare[code] != null) line.compareCny = compare[code];
      lines.push(line);
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
      clearTimeout(saveTimers[type]);
      window.clearDraft(window.draftKey(ctx.corp, ctx.office, ctx.yearmonth, ctx.submitter, type));
      discardServerDraft(type);
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
      refreshChecklistAfterSubmit();   // 위쪽 현황 카드에 방금 제출이 반영되도록
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

  var loadSeq = 0;   // 불러오기 번호: 달을 빠르게 옮길 때 늦게 도착한 옛 달의 응답이 화면을 덮어쓰지 않도록

  function loadAll() {
    if (!client) {
      showToast(t("submitFail"));
      return;
    }
    var mySeq = ++loadSeq;
    existingLines = {};
    lockedTypes = [];
    plKrExtra = {};
    calcModes = {};
    compareValues = {};
    staleDraftTypes = {};
    // 달을 바꾸거나 다시 불러올 때 예약돼 있던 서버 저장은 취소합니다(옛 달의 입력은 이 PC에 dirty로 남아 있다가
    // 그 달을 다시 열 때 서버에 올라갑니다).
    STATEMENT_TYPES.forEach(function (type) { clearTimeout(serverSaveTimers[type]); });
    Promise.all([
      client.rpc("get_accounts", {}),
      client.rpc("get_statement", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      client.rpc("get_exchange_rate", { p_yearmonth: ctx.yearmonth }),
      window.fetchClosedMonths(),
      client.rpc("get_pl_kr_extra", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      client.rpc("get_submission_locks", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth }),
      // 서버 공유 임시저장(2단계). 함수가 아직 없거나 실패해도 화면 전체가 실패하지 않도록 오류를 값으로 돌려받습니다.
      client.rpc("get_statement_drafts", { p_access_key: ctx.accessKey, p_corp: ctx.corp, p_office: ctx.office, p_yearmonth: ctx.yearmonth })
        .then(function (r) { return r; }, function () { return { error: { message: "network" } }; })
    ]).then(function (results) {
      if (mySeq !== loadSeq) return;   // 그 사이 더 새로운 불러오기가 시작됐다 → 이 응답은 버립니다
      accounts = (results[0].data || []).slice().sort(function (a, b) { return a.displayOrder - b.displayOrder; });
      STATEMENT_TYPES.forEach(function (type) {
        formulaPlans[type] = window.buildFormulaPlan(accounts, type);
        compareValues[type] = {};
      });
      (results[1].data || []).forEach(function (l) {
        existingLines[l.statementType + "::" + l.accountCode] = l.amountCny;
        if (l.compareCny != null) compareValues[l.statementType][l.accountCode] = l.compareCny;
        // 이미 제출된 건은 최초 생성 시점의 계산모드를 그대로 따릅니다 (v5 5.2).
        // 행이 하나도 없으면 계속 undefined로 남아 isAutoCalc()가 자동계산으로 판정합니다.
        if (l.calcMode) calcModes[l.statementType] = l.calcMode;
      });
      exchangeRate = results[2].data;
      closedMonths = results[3] || [];
      plKrExtra = results[4].data || {};
      lockedTypes = results[5].data || [];
      var dr = results[6] || {};
      serverDraftsEnabled = !dr.error && Array.isArray(dr.data);
      serverDrafts = {};
      draftBase = {};
      draftConflict = {};
      draftStatus = {};
      if (serverDraftsEnabled) {
        dr.data.forEach(function (d) {
          serverDrafts[d.statementType] = d;
          draftBase[d.statementType] = d.version;
        });
      }
      renderContextBar();
      renderPanels();
      applyClosedState();
      applyLockedState();
      applyPlKrExtra();
      syncDraftsAfterLoad();
    }).catch(function () {
      showToast(t("submitFail"));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindTabs();
    bindPanelEvents();
    bindOverviewEvents();
    loadAll();
    refreshOverview();
    document.addEventListener("langchange", function () {
      renderContextBar();
      renderPanels();
      applyClosedState();
      applyLockedState();
      applyPlKrExtra();
      if (overviewMode) {
        setChecklistHeading(true);
        renderOverview();
      } else {
        renderMyChecklist();
      }
    });
  });
})();
