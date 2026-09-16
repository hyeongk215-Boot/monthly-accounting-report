window.I18N = {
  ko: {
    moduleName: "회계관리",
    navSecMain: "조회",
    navSecAdmin: "관리",
    navQuery: "재무제표 조회",
    navSubmit: "재무제표 제출",
    navAdminShort: "관리자 화면",
    appTitle: "회계관리 - 중국법인 재무제표 취합 시스템",
    langName: "한국어",
    navAdmin: "본사용: 관리자 화면",
    navDashboard: "← 통합 대시보드",
    backBtn: "← 뒤로",

    indexHeading: "월별 재무제표 제출",
    indexDesc: "법인/지점/적용년도월과 접근키를 입력한 뒤 입력을 시작합니다. 제출자는 접근키에 등록된 이름으로 자동 표시됩니다. 접근키는 본사에서 발급받으세요.",
    corp: "법인",
    office: "지점",
    yearmonth: "적용년도월",
    submitterName: "담당자 이름",
    accessKeyLabel: "접근키",
    selectPlaceholder: "선택하세요",
    startBtn: "입력 시작",
    requiredWarning: "법인, 지점, 적용년도월, 담당자 이름, 접근키를 모두 입력해주세요.",
    invalidKey: "접근키가 올바르지 않습니다. 본사 담당자에게 확인해주세요.",
    keyMismatchBranch: "이 접근키는 {branch} 전용입니다. 법인 선택이 자동으로 변경되었습니다.",
    keyMismatchOffice: "이 접근키는 {office} 지점 전용입니다. 지점 선택이 자동으로 변경되었습니다.",

    myChecklistHeading: "나의 최근 3개월 제출 현황",
    checklistAllDone: "모두 제출완료",
    checklistMissingLabel: "미제출:",

    submitHeading: "재무제표 입력",
    tabPL: "손익계산서",
    tabPLKR: "손익계산서(한국)",
    tabBS: "재무상태표",
    tabCF: "현금흐름표",
    plKrExtraNote: "본사에 보고하는 한국회계기준 영업이익(영업이익 계정)의 기준 자료입니다. 인원수, 접대비 월간 합계(접대비 앱 기준), 출장비 월간 합계를 함께 입력해주세요.",
    headcountLabel: "인원수",
    entertainmentLabel: "접대비 월간 합계(CNY)",
    travelLabel: "출장비 월간 합계(CNY)",
    colAccount: "계정과목",
    colAmountCny: "금액 (CNY)",
    colAmountKrw: "환산액 (KRW, 참고용)",
    rateUnsetNote: "이 달의 환율이 아직 설정되지 않아 KRW 환산액이 표시되지 않습니다. 제출은 가능하며, 환율 설정 후 자동으로 반영됩니다.",
    draftSaveBtn: "임시저장",
    draftSavedAt: "마지막 임시저장",
    draftRestored: "임시저장된 내용을 불러왔습니다.",
    downloadTemplateBtn: "빈 업로드 양식 다운로드",
    uploadFileLabel: "작성한 파일 선택",
    uploadBtn: "업로드",
    uploadNoFile: "먼저 파일을 선택해주세요.",
    uploadSuccess: "{n}건이 반영되었습니다.",
    uploadFail: "파일을 읽는 중 문제가 발생했습니다. 업로드 양식을 다시 확인해주세요.",
    uploadTemplateFileName: "회계관리_업로드양식",
    submitTabBtn: "이 탭 제출",
    submitSuccess: "제출이 완료되었습니다.",
    submitFail: "제출에 실패했습니다. 접근키 또는 네트워크 상태를 확인해주세요.",
    submitFailClosed: "이 달은 마감되어 더 이상 제출할 수 없습니다.",
    monthClosedBanner: "⚠ {yearmonth} 은(는) 마감되었습니다. 더 이상 입력/제출할 수 없습니다. 본사 담당자에게 문의해주세요.",
    submitWarningConfirm: "제출 후에는 이 탭을 스스로 수정할 수 없습니다 (수정이 필요하면 본사에 마감 해제를 요청해야 합니다). 제출하시겠습니까?",
    submissionLockedBanner: "🔒 이 탭은 이미 제출되어 잠겼습니다. 수정이 필요하면 본사 담당자에게 마감 해제를 요청해주세요.",
    fileNamePrefix: "재무제표",

    adminHeading: "[본사용] 회계관리 관리자 화면",
    adminDesc: "접근키(system_admin 또는 finance)를 입력하면 월별 집계 조회, 제출현황 확인, 환율 설정, 월 마감, 계정과목 관리를 할 수 있습니다.",
    adminKeyLabel: "접근키",
    adminYm: "조회할 적용년도월",
    adminFetch: "조회",
    adminFetchFail: "조회에 실패했습니다. 접근키를 확인해주세요.",
    adminConsolFetchFail: "합병 재무제표 조회에 실패했습니다. Supabase에 최신 schema.sql이 적용되었는지 확인해주세요 (get_consolidated_flow_report/get_consolidated_bs_report 함수가 필요합니다).",
    adminKeyRequired: "접근키를 먼저 입력해주세요.",

    adminMonthStatus: "이 달 상태",
    adminMonthOpenBadge: "진행중",
    adminMonthClosedBadge: "마감됨",
    adminCloseMonthBtn: "이 달 마감하기",
    adminReopenMonthBtn: "마감 해제",
    adminCloseConfirm: "{yearmonth}을(를) 마감하시겠습니까? 마감 후에는 지점에서 이 달로 더 이상 제출할 수 없습니다.",
    adminReopenConfirm: "{yearmonth} 마감을 해제하시겠습니까?",
    adminCloseSuccess: "마감되었습니다.",
    adminReopenSuccess: "마감이 해제되었습니다.",
    adminCloseFail: "처리에 실패했습니다.",

    rateSectionHeading: "월별 고정환율 (CNY → KRW)",
    rateCurrentLabel: "현재 환율",
    rateNotSet: "설정되지 않음",
    rateInputLabel: "새 환율 입력 (1 CNY = ? KRW)",
    rateSetBtn: "환율 설정",
    rateSetSuccess: "환율이 설정되었고 기존 제출 데이터에 소급 반영되었습니다.",
    rateSetFail: "환율 설정에 실패했습니다.",

    adminStatusHeading: "법인별 제출 현황",
    adminSubmitted: "제출됨",
    adminNotSubmitted: "미제출",
    adminFilterHint: "법인×지점을 클릭하면 해당 지점만 필터링됩니다 (다시 클릭하면 해제). 아직 한 건도 제출하지 않은 지점도 목록에 표시됩니다.",
    adminFilterAll: "전체 보기",
    adminMissingOnlyLabel: "미제출 지점만 보기",
    adminUnlockBtn: "마감 해제",
    adminUnlockConfirm: "이 제표의 제출 잠금을 해제하시겠습니까? 해제하면 지점 담당자가 다시 수정/제출할 수 있습니다.",
    adminUnlockSuccess: "잠금이 해제되었습니다.",
    adminUnlockFail: "잠금 해제에 실패했습니다.",

    aggHeading: "집계 테이블",
    colCorp: "법인",
    colOffice: "지점",
    colStatementType: "제표구분",
    colSubmittedBy: "제출자",
    colSubmittedAt: "제출일시",
    colDelete: "선택",
    adminDownload: "집계 엑셀 다운로드",
    viewByOffice: "지점별 보기",
    viewConsolidated: "합병 재무제표",
    consolidatedDesc: "선택한 법인의 모든 지점을 계정별로 합산한 합병 재무제표입니다 (손익계산서/현금흐름표는 당월실적·당해누계, 재무상태표는 당월말·전기말 잔액 기준).",
    consolCurrentMonth: "당월실적 (CNY)",
    consolYtd: "당해 1~당월 누계 (CNY)",
    consolCurrentBalance: "당월말 잔액 (CNY)",
    consolPriorYearEnd: "전기말 잔액 (CNY)",
    colLineNo: "행차",
    reportPlTitle: "손 익 계 산 서 (합병)",
    reportBsTitle: "재 무 상 태 표 (합병)",
    reportCfTitle: "현 금 흐 름 표 (합병)",
    reportUnitNote: "단위: 元",
    adminDeleteSelectedBtn: "선택 삭제",
    adminDeleteSelectedNone: "삭제할 항목을 선택해주세요.",
    adminDeleteConfirm: "선택한 {n}건을 삭제하시겠습니까? 삭제 후에는 되돌릴 수 없습니다.",
    adminDeleteSuccess: "삭제되었습니다.",
    adminDeleteFail: "삭제에 실패했습니다.",

    coaHeading: "계정과목 관리",
    coaDesc: "현재 계정과목을 엑셀로 다운로드해 수정한 뒤 업로드하면 전체 계정과목을 교체합니다 (system_admin 전용). 새 목록에 없는 기존 코드는 삭제되지 않고 비활성화만 됩니다.",
    coaDownloadTemplateBtn: "현재 계정과목 다운로드",
    coaUploadFileLabel: "수정한 파일 선택",
    coaUploadBtn: "업로드하여 교체",
    coaUploadSuccess: "계정과목 {n}건이 반영되었습니다.",
    coaUploadFail: "계정과목 교체에 실패했습니다. system_admin 접근키인지 확인해주세요.",
    coaSystemAdminOnly: "이 기능은 system_admin 접근키로만 사용할 수 있습니다.",

    statementTypePL: "손익계산서",
    statementTypeBS: "재무상태표",
    statementTypeCF: "현금흐름표",

    totalRows: "총 항목 수",
    rowNumberCol: "번호"
  },
  zh: {
    moduleName: "会计管理",
    navSecMain: "查询",
    navSecAdmin: "管理",
    navQuery: "财务报表查询",
    navSubmit: "财务报表提交",
    navAdminShort: "管理员页面",
    appTitle: "会计管理 - 中国法人财务报表汇总系统",
    langName: "中文",
    navAdmin: "总部用：管理员页面",
    navDashboard: "← 开始页面",
    backBtn: "← 返回",

    indexHeading: "月度财务报表填报",
    indexDesc: "请填写法人/分公司/适用年月及接入密钥后开始填报。负责人将自动显示为接入密钥登记的姓名。接入密钥请向总部申请。",
    corp: "法人",
    office: "分公司",
    yearmonth: "适用年月",
    submitterName: "负责人姓名",
    accessKeyLabel: "接入密钥",
    selectPlaceholder: "请选择",
    startBtn: "开始填报",
    requiredWarning: "请填写法人、分公司、适用年月、负责人姓名和接入密钥。",
    invalidKey: "接入密钥不正确，请向总部负责人确认。",
    keyMismatchBranch: "该接入密钥仅限{branch}使用，已自动切换法人选择。",
    keyMismatchOffice: "该接入密钥仅限{office}分公司使用，已自动切换分公司选择。",

    myChecklistHeading: "我最近3个月的提交情况",
    checklistAllDone: "已全部提交",
    checklistMissingLabel: "未提交:",

    submitHeading: "财务报表填报",
    tabPL: "损益表",
    tabPLKR: "损益表(韩国)",
    tabBS: "资产负债表",
    tabCF: "现金流量表",
    plKrExtraNote: "此为向总部报告的韩国会计准则营业利润(营业利润科目)的基础数据。请一并填写人员数、当月招待费合计(以招待费应用为准)和当月差旅费合计。",
    headcountLabel: "人员数",
    entertainmentLabel: "当月招待费合计(CNY)",
    travelLabel: "当月差旅费合计(CNY)",
    colAccount: "科目",
    colAmountCny: "金额 (CNY)",
    colAmountKrw: "折合金额 (KRW，仅供参考)",
    rateUnsetNote: "本月汇率尚未设置，暂不显示折合KRW金额。仍可正常提交，设置汇率后会自动补算。",
    draftSaveBtn: "暂存草稿",
    draftSavedAt: "上次暂存时间",
    draftRestored: "已恢复暂存的草稿内容。",
    downloadTemplateBtn: "下载空白上传模板",
    uploadFileLabel: "选择已填写的文件",
    uploadBtn: "上传",
    uploadNoFile: "请先选择文件。",
    uploadSuccess: "已应用{n}条数据。",
    uploadFail: "读取文件时出现问题，请重新检查上传模板。",
    uploadTemplateFileName: "会计管理_上传模板",
    submitTabBtn: "提交本页",
    submitSuccess: "提交成功。",
    submitFail: "提交失败，请检查接入密钥或网络状态。",
    submitFailClosed: "该月已截止，无法再提交。",
    monthClosedBanner: "⚠ {yearmonth} 已截止，无法再填报/提交。如有疑问请联系总部负责人。",
    submitWarningConfirm: "提交后将无法自行修改本页（如需修改，须请总部解除锁定）。确定要提交吗？",
    submissionLockedBanner: "🔒 本页已提交并锁定。如需修改，请联系总部负责人解除锁定。",
    fileNamePrefix: "财务报表",

    adminHeading: "【总部用】会计管理管理员页面",
    adminDesc: "输入接入密钥（system_admin 或 finance）后可查询月度汇总、查看提交情况、设置汇率、月结、管理科目。",
    adminKeyLabel: "接入密钥",
    adminYm: "要查询的适用年月",
    adminFetch: "查询",
    adminFetchFail: "查询失败，请检查接入密钥。",
    adminConsolFetchFail: "合并财务报表查询失败，请确认Supabase是否已应用最新schema.sql（需要get_consolidated_flow_report/get_consolidated_bs_report函数）。",
    adminKeyRequired: "请先输入接入密钥。",

    adminMonthStatus: "本月状态",
    adminMonthOpenBadge: "进行中",
    adminMonthClosedBadge: "已截止",
    adminCloseMonthBtn: "截止本月",
    adminReopenMonthBtn: "解除截止",
    adminCloseConfirm: "确定要截止 {yearmonth} 吗？截止后分公司将无法再对该月提交。",
    adminReopenConfirm: "确定要解除 {yearmonth} 的截止状态吗？",
    adminCloseSuccess: "已截止。",
    adminReopenSuccess: "已解除截止。",
    adminCloseFail: "操作失败。",

    rateSectionHeading: "月度固定汇率 (CNY → KRW)",
    rateCurrentLabel: "当前汇率",
    rateNotSet: "尚未设置",
    rateInputLabel: "输入新汇率 (1 CNY = ? KRW)",
    rateSetBtn: "设置汇率",
    rateSetSuccess: "汇率已设置，并已追溯应用到已提交的数据。",
    rateSetFail: "设置汇率失败。",

    adminStatusHeading: "各法人提交情况",
    adminSubmitted: "已提交",
    adminNotSubmitted: "未提交",
    adminFilterHint: "点击法人×分公司可只筛选该分公司（再次点击取消筛选）。尚未提交任何数据的分公司也会显示在列表中。",
    adminFilterAll: "查看全部",
    adminMissingOnlyLabel: "只看未提交分公司",
    adminUnlockBtn: "解除锁定",
    adminUnlockConfirm: "确定要解除该报表的提交锁定吗？解除后分公司负责人可再次修改并提交。",
    adminUnlockSuccess: "已解除锁定。",
    adminUnlockFail: "解除锁定失败。",

    aggHeading: "汇总表",
    colCorp: "法人",
    colOffice: "分公司",
    colStatementType: "报表类型",
    colSubmittedBy: "提交人",
    colSubmittedAt: "提交时间",
    colDelete: "选择",
    adminDownload: "下载汇总Excel",
    viewByOffice: "按分公司查看",
    viewConsolidated: "合并财务报表",
    consolidatedDesc: "所选法人下所有分公司数据按科目合并的合并财务报表（损益表/现金流量表按本月实际数·本年累计数，资产负债表按期末余额·上年期末余额)。",
    consolCurrentMonth: "本月实际数 (CNY)",
    consolYtd: "本年1~本月累计数 (CNY)",
    consolCurrentBalance: "期末余额 (CNY)",
    consolPriorYearEnd: "上年期末余额 (CNY)",
    colLineNo: "行次",
    reportPlTitle: "利  润  表 （合并）",
    reportBsTitle: "资产负债表 （合并）",
    reportCfTitle: "现金流量表 （合并）",
    reportUnitNote: "单位：元",
    adminDeleteSelectedBtn: "删除所选",
    adminDeleteSelectedNone: "请先选择要删除的数据。",
    adminDeleteConfirm: "确定要删除所选的{n}条数据吗？删除后无法恢复。",
    adminDeleteSuccess: "已删除。",
    adminDeleteFail: "删除失败。",

    coaHeading: "科目管理",
    coaDesc: "下载当前科目表修改后重新上传，将整体替换科目表（仅限system_admin）。新列表中没有的旧科目不会被删除，只会被停用。",
    coaDownloadTemplateBtn: "下载当前科目表",
    coaUploadFileLabel: "选择修改后的文件",
    coaUploadBtn: "上传并替换",
    coaUploadSuccess: "已应用{n}条科目。",
    coaUploadFail: "替换科目失败，请确认是否为system_admin接入密钥。",
    coaSystemAdminOnly: "此功能仅限system_admin接入密钥使用。",

    statementTypePL: "损益表",
    statementTypeBS: "资产负债表",
    statementTypeCF: "现金流量表",

    totalRows: "总项目数",
    rowNumberCol: "编号"
  }
};

window.getLang = function () {
  return localStorage.getItem("appLang") || "ko";
};
window.setLang = function (lang) {
  localStorage.setItem("appLang", lang);
  applyI18n();
  document.dispatchEvent(new CustomEvent("langchange"));
};
window.t = function (key, vars) {
  var lang = getLang();
  var dict = window.I18N[lang] || window.I18N.ko;
  var str = dict[key] || window.I18N.ko[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (k) {
      str = str.split("{" + k + "}").join(vars[k]);
    });
  }
  return str;
};
window.applyI18n = function () {
  document.documentElement.lang = getLang();
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.title = t("appTitle");
  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.lang === getLang());
  });
};
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { setLang(btn.dataset.lang); });
  });
  applyI18n();
});
