#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/github run build
pnpm --filter @workspace/repo-agent run build
pnpm --filter @workspace/db run push
