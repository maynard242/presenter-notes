#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database schema changes require a separate, explicitly reviewed migration.
