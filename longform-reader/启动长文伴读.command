#!/bin/zsh
set -eu
cd "${0:A:h}"

reader_url='http://127.0.0.1:4173/'
if /usr/bin/curl --silent --fail --max-time 2 "${reader_url}api/health" >/dev/null 2>&1; then
  /usr/bin/open "$reader_url"
  exit 0
fi

(
  for attempt in {1..60}; do
    if /usr/bin/curl --silent --fail --max-time 1 "${reader_url}api/health" >/dev/null 2>&1; then
      /usr/bin/open "$reader_url"
      exit 0
    fi
    /bin/sleep 0.25
  done
) &

print '长文伴读本地版正在启动。使用期间请保持这个窗口打开，按 Control-C 停止。'
exec /usr/bin/env "PATH=/usr/local/bin:$PATH" PORT=4173 VERCEL=0 STORAGE_PROVIDER=local READING_SPACES=1 CODEX_MODEL=gpt-6.1-sol CODEX_REASONING_EFFORT=low APP_PASSWORD= /usr/local/bin/node server.mjs
