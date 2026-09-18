#!/usr/bin/env bash
#
# docs/*.html 안의 js/·css/ 태그에 붙은 ?v=... 값을 현재 시각으로 한꺼번에 갈아끼웁니다.
#
# 왜 필요한가:
#   GitHub Pages는 HTML과 JS를 똑같이 max-age=600으로 내려줍니다. 파일마다 캐시가 만료되는
#   시점이 제각각이라, 버전 표시가 없으면 브라우저가 "새 app-*.js + 옛 common.js"처럼
#   짝이 안 맞는 조합을 들고 있을 수 있습니다. 실제로 그렇게 되면 화면이 통째로 비고
#   엉뚱한 실패 메시지가 뜹니다.
#   ?v=가 붙어 있으면 HTML 한 벌이 참조하는 파일들이 항상 같은 버전으로 묶이므로,
#   최악의 경우도 "깨진 화면"이 아니라 "10분쯤 옛날 화면"에서 끝납니다.
#
# 언제 실행하나:
#   docs/ 아래 js 또는 css를 고쳤다면 **커밋하기 직전에** 한 번 돌리세요.
#   (Git Bash에서 실행: bash tools/bump-cache-version.sh)
#
# vendor/ 는 일부러 제외했습니다. 1MB가 넘는 외부 라이브러리라 배포할 때마다 다시
# 받게 만들 이유가 없고, 우리가 직접 교체할 때만 바뀌기 때문입니다.

set -euo pipefail
cd "$(dirname "$0")/.."

V="$(date +%Y%m%d%H%M)"

for f in docs/*.html; do
  sed -E -i \
    -e 's#(src="js/[^"?]+)(\?v=[^"]*)?"#\1?v='"$V"'"#g' \
    -e 's#(href="css/[^"?]+)(\?v=[^"]*)?"#\1?v='"$V"'"#g' \
    "$f"
done

echo "cache version -> $V"
grep -ho '?v=[0-9]*' docs/*.html | sort | uniq -c
