// 공통 유틸 함수 모음 (접대비 docs/js/common.js 구조를 재사용/축소)

// ===== Supabase 클라이언트 =====
window.getSupabaseClient = function () {
  var cfg = window.APP_CONFIG;
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  if (!window._supabaseClient) {
    window._supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  return window._supabaseClient;
};

// 회계 데이터는 접대비와 달리 과거 월 백필이 필요할 수 있어 하한선을 넉넉히 잡습니다.
window.MIN_YEARMONTH = "2024-01";

window.generateYearMonths = function (back, forward) {
  back = back == null ? 36 : back;
  forward = forward == null ? 1 : forward;
  var now = new Date();
  var list = [];
  for (var i = -back; i <= forward; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    var ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (ym < window.MIN_YEARMONTH) continue;
    list.push(ym);
  }
  return list.reverse();
};

window.defaultYearMonth = function () {
  var now = new Date();
  var d = new Date(now.getFullYear(), now.getMonth() - 1, 1); // 전월
  var ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  return ym < window.MIN_YEARMONTH ? window.MIN_YEARMONTH : ym;
};

// ===== 월 마감 여부 조회 (공개 RPC) =====
// 실패 시 빈 배열 반환 - 실제 마감 강제는 서버(submit_statement RPC)에서도 다시 검사합니다.
window.fetchClosedMonths = function () {
  var client = window.getSupabaseClient();
  if (!client) return Promise.resolve([]);
  return client.rpc("get_closed_months", {}).then(function (res) {
    return (res.data || []);
  }).catch(function () {
    return [];
  });
};

// ===== 법인 라벨 (ko 값을 저장/조회 기준으로 쓰고, 화면 표시만 언어별로 바꿈) =====
function findByKo(list, koValue) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].ko === koValue) return list[i];
  }
  return null;
}
window.corpLabel = function (koValue, lang) {
  var item = findByKo(window.APP_CONFIG.CORPORATIONS, koValue);
  if (!item) return koValue;
  return item[lang || getLang()] || item.ko;
};
window.officeLabel = function (koValue, lang) {
  var item = findByKo(window.APP_CONFIG.OFFICES, koValue);
  if (!item) return koValue;
  return item[lang || getLang()] || item.ko;
};

// ===== localStorage 임시저장 (지점+제표 종류별로 draft 분리) =====
window.draftKey = function (corp, office, yearmonth, submitter, statementType) {
  return "draft::" + corp + "::" + office + "::" + yearmonth + "::" + (submitter || "") + "::" + statementType;
};
window.saveDraft = function (key, data) {
  data._savedAt = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(data));
  return data._savedAt;
};
window.loadDraft = function (key) {
  var raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};
window.clearDraft = function (key) {
  localStorage.removeItem(key);
};

// ===== 세션 컨텍스트 (법인/년월/담당자/접근키/역할) =====
// 접근키는 로그인 유지 목적으로만 sessionStorage에 두고(탭 닫으면 사라짐), localStorage에는 저장하지 않습니다.
window.saveContext = function (ctx) {
  sessionStorage.setItem("acctContext", JSON.stringify(ctx));
};
window.loadContext = function () {
  var raw = sessionStorage.getItem("acctContext");
  return raw ? JSON.parse(raw) : null;
};
window.clearContext = function () {
  sessionStorage.removeItem("acctContext");
};

// ===== 재무제표 업로드 템플릿 내보내기/가져오기 =====
// 컬럼: [계정코드, 계정과목명, 금액(CNY)] - 업로드 시 계정코드로 매칭하고 이름은 참고용입니다.
window.buildStatementTemplate = function (accounts, statementType, lang) {
  var header = [t("colAccount") + " Code", t("colAccount"), t("colAmountCny"), t("colLineNo")];
  var aoa = [header];
  accounts
    .filter(function (a) { return a.statementType === statementType; })
    .forEach(function (a) {
      aoa.push([a.code, lang === "zh" ? a.nameZh : a.nameKo, "", a.lineNo || ""]);
    });
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 8 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, statementType);
  return wb;
};
window.downloadWorkbook = function (wb, filename) {
  XLSX.writeFile(wb, filename);
};

// 업로드 파일 파싱: 위치 기준(0=코드, 1=이름(무시), 2=금액)으로 읽어 {accountCode, amountCny} 배열 반환
window.parseStatementFile = function (file) {
  return file.arrayBuffer().then(function (buf) {
    var wb = XLSX.read(buf, { type: "array" });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    var rows = [];
    for (var i = 1; i < aoa.length; i++) {
      var r = aoa[i];
      if (!r || !r[0]) continue;
      if (r[2] === undefined || r[2] === "") continue;
      rows.push({ accountCode: String(r[0]).trim(), amountCny: Number(r[2]) || 0 });
    }
    return rows;
  });
};

// ===== 계정과목(COA) 관리자 엑셀 내보내기/가져오기 =====
window.buildAccountsWorkbook = function (accounts) {
  var header = ["code", "nameKo", "nameZh", "statementType", "category", "displayOrder", "isSubtotal", "lineNo"];
  var aoa = [header];
  accounts.forEach(function (a) {
    aoa.push([a.code, a.nameKo, a.nameZh, a.statementType, a.category, a.displayOrder, a.isSubtotal ? "TRUE" : "FALSE", a.lineNo || ""]);
  });
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "accounts");
  return wb;
};
window.parseAccountsFile = function (file) {
  return file.arrayBuffer().then(function (buf) {
    var wb = XLSX.read(buf, { type: "array" });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    var rows = [];
    for (var i = 1; i < aoa.length; i++) {
      var r = aoa[i];
      if (!r || !r[0]) continue;
      rows.push({
        code: String(r[0]).trim(),
        nameKo: r[1] || "",
        nameZh: r[2] || "",
        statementType: r[3] || "",
        category: r[4] || "",
        displayOrder: Number(r[5]) || 0,
        isSubtotal: String(r[6]).toUpperCase() === "TRUE",
        lineNo: r[7] || ""
      });
    }
    return rows;
  });
};
