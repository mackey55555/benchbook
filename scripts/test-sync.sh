#!/bin/sh
# 手元の Supabase（supabase start 済み）を相手に、同期の通しテストを動かす
set -e
STATUS=$(supabase status -o json)
key() { echo "$STATUS" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
export SUPABASE_TEST_URL=$(key API_URL)
export SUPABASE_TEST_ANON=$(key ANON_KEY)
export SUPABASE_TEST_SERVICE=$(key SERVICE_ROLE_KEY)
exec npx jest --config jest.integration.config.js "$@"
