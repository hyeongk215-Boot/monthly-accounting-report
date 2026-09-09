window.I18N = {
  ko: {
    appTitle: "회계관리 - 중국법인 재무제표 취합 시스템",
    langName: "한국어",
    navAdmin: "본사용: 관리자 화면",
    backBtn: "← 뒤로",

    indexHeading: "월별 재무제표 제출",
    indexDesc: "법인/지점/적용년도월/담당자 이름과 접근키를 입력한 뒤 입력을 시작합니다. 접근키는 본사에서 발급받으세요.",
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

    submitHeading: "재무제표 입력",
    tabPL: "손익계산서",
    tabPLKR: "손익계산서(한국)",
    tabBS: "재무상태표",
    tabCF: "현금흐름표",
    plKrExtraNote: "본사에 보고하는 한국회계기준 영업이익(영업이익 계정)의 기준 자료입니다. 인원수와 접대비 월간 합계(접대비 앱 기준)를 함께 입력해주세요.",
    headcountLabel: "인원수",
    entertainmentLabel: "접대비 월간 합계(CNY)",
    colAccount: "계정과목",
    colAmountCny: "금액 (CNY)",
    colAmountKrw: "환산액 (KRW, 참고용)",
    rateUnsetNote: "이 달의 환율이 아직 설정되지 않아 KRW 환산액이 표시되지 않습니다. 제출은 가능하며, 환율 설정 후 자동으로 반영됩니다.",
    draftSaveBtn: "임시저장",
    draftSavedAt: "마지막 임시저장",
    draftRestored: "임시저장된 내용을 불러왔습니다.",
    downloadTemplateBtn: "② 빈 업로드 양식 다운로드",
    uploadFileLabel: "작성한 파일 선택",
    uploadBtn: "업로드",
    uploadNoFile: "먼저 파일을 선택해주세요.",
    uploadSuccess: "{n}건이 반영되었습니다.",
    uploadFail: "파일을 읽는 중 문제가 발생했습니다. 업로드 양식을 다시 확인해주세요.",
    uploadTemplateFileName: "회계관리_업로드양식",
    uploadStandardBtn: "① 회계프로그램에서 다운로드한 파일 그대로 업로드",
    uploadStandardFileLabel: "PL/BS 파일 선택 (YJC 포워딩·상해물류센터 전용 양식)",
    uploadStandardNote: "이 버튼은 YJC 포워딩·상해물류센터가 쓰는 회계프로그램의 PL/BS 리포트 파일 형식 전용입니다. 다른 법인은 아래 ②번 빈 양식을 이용해주세요.",
    uploadStandardFail: "파일 형식을 인식하지 못했습니다. YJC 포워딩·상해물류센터 회계프로그램의 PL/BS 파일이 맞는지 확인해주세요.",
    submitTabBtn: "이 탭 제출",
    submitSuccess: "제출이 완료되었습니다.",
    submitFail: "제출에 실패했습니다. 접근키 또는 네트워크 상태를 확인해주세요.",
    submitFailClosed: "이 달은 마감되어 더 이상 제출할 수 없습니다.",
    monthClosedBanner: "⚠ {yearmonth} 은(는) 마감되었습니다. 더 이상 입력/제출할 수 없습니다. 본사 담당자에게 문의해주세요.",
    fileNamePrefix: "재무제표",

    adminHeading: "[본사용] 회계관리 관리자 화면",
    adminDesc: "접근키(system_admin 또는 finance)를 입력하면 월별 집계 조회, 제출현황 확인, 환율 설정, 월 마감, 계정과목 관리를 할 수 있습니다.",
    adminKeyLabel: "접근키",
    adminYm: "조회할 적용년도월",
    adminFetch: "조회",
    adminFetchFail: "조회에 실패했습니다. 접근키를 확인해주세요.",
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
    adminFilterHint: "법인을 클릭하면 해당 법인만 필터링됩니다 (다시 클릭하면 해제).",
    adminFilterAll: "전체 법인 보기",

    aggHeading: "집계 테이블",
    colCorp: "법인",
    colOffice: "지점",
    colStatementType: "제표구분",
    colSubmittedBy: "제출자",
    colSubmittedAt: "제출일시",
    colDelete: "선택",
    adminDownload: "집계 엑셀 다운로드",
    viewByOffice: "지점별 보기",
    viewConsolidated: "법인 통합 보기",
    consolidatedOfficeCount: "지점 수",
    consolidatedDesc: "선택한 법인의 모든 지점 데이터를 계정별로 합산한 통합 재무제표입니다.",
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
    appTitle: "会计管理 - 中国法人财务报表汇总系统",
    langName: "中文",
    navAdmin: "总部用：管理员页面",
    backBtn: "← 返回",

    indexHeading: "月度财务报表填报",
    indexDesc: "请填写法人/分公司/适用年月/负责人姓名及接入密钥后开始填报。接入密钥请向总部申请。",
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

    submitHeading: "财务报表填报",
    tabPL: "损益表",
    tabPLKR: "损益表(韩国)",
    tabBS: "资产负债表",
    tabCF: "现金流量表",
    plKrExtraNote: "此为向总部报告的韩国会计准则营业利润(营业利润科目)的基础数据。请一并填写人员数和当月招待费合计(以招待费应用为准)。",
    headcountLabel: "人员数",
    entertainmentLabel: "当月招待费合计(CNY)",
    colAccount: "科目",
    colAmountCny: "金额 (CNY)",
    colAmountKrw: "折合金额 (KRW，仅供参考)",
    rateUnsetNote: "本月汇率尚未设置，暂不显示折合KRW金额。仍可正常提交，设置汇率后会自动补算。",
    draftSaveBtn: "暂存草稿",
    draftSavedAt: "上次暂存时间",
    draftRestored: "已恢复暂存的草稿内容。",
    downloadTemplateBtn: "② 下载空白上传模板",
    uploadFileLabel: "选择已填写的文件",
    uploadBtn: "上传",
    uploadNoFile: "请先选择文件。",
    uploadSuccess: "已应用{n}条数据。",
    uploadFail: "读取文件时出现问题，请重新检查上传模板。",
    uploadTemplateFileName: "会计管理_上传模板",
    uploadStandardBtn: "① 直接上传财务系统导出的文件",
    uploadStandardFileLabel: "选择PL/BS文件（仅限裕佳昌货代・上海物流中心格式）",
    uploadStandardNote: "此按钮仅适用于裕佳昌货代・上海物流中心所用财务系统导出的PL/BS报表格式。其他法人请使用下方②空白模板。",
    uploadStandardFail: "无法识别文件格式，请确认是否为裕佳昌货代・上海物流中心财务系统的PL/BS文件。",
    submitTabBtn: "提交本页",
    submitSuccess: "提交成功。",
    submitFail: "提交失败，请检查接入密钥或网络状态。",
    submitFailClosed: "该月已截止，无法再提交。",
    monthClosedBanner: "⚠ {yearmonth} 已截止，无法再填报/提交。如有疑问请联系总部负责人。",
    fileNamePrefix: "财务报表",

    adminHeading: "【总部用】会计管理管理员页面",
    adminDesc: "输入接入密钥（system_admin 或 finance）后可查询月度汇总、查看提交情况、设置汇率、月结、管理科目。",
    adminKeyLabel: "接入密钥",
    adminYm: "要查询的适用年月",
    adminFetch: "查询",
    adminFetchFail: "查询失败，请检查接入密钥。",
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
    adminFilterHint: "点击法人可只筛选该法人（再次点击取消筛选）。",
    adminFilterAll: "查看全部法人",

    aggHeading: "汇总表",
    colCorp: "法人",
    colOffice: "分公司",
    colStatementType: "报表类型",
    colSubmittedBy: "提交人",
    colSubmittedAt: "提交时间",
    colDelete: "选择",
    adminDownload: "下载汇总Excel",
    viewByOffice: "按分公司查看",
    viewConsolidated: "法人合并查看",
    consolidatedOfficeCount: "分公司数",
    consolidatedDesc: "所选法人下所有分公司数据按科目合并后的合并财务报表。",
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
