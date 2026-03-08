#!/bin/bash
# Stop hook: Claude 응답 완료 시 src/ 또는 test/ 변경이 있으면 단위 테스트 실행
# cli-smoke.test.js는 API 비용이 들므로 제외

cd "$CLAUDE_PROJECT_DIR" || exit 0

# src/ 또는 test/ 파일에 변경(unstaged)이 있는지 확인
CHANGED=$(git diff --name-only -- 'src/' 'test/' 2>/dev/null | head -1)
if [ -z "$CHANGED" ]; then
  exit 0
fi

# 단위 테스트만 실행 (cli-smoke 제외)
node --test $(find test -name '*.test.js' ! -name 'cli-smoke.test.js' | sort) 2>&1 | tail -10
