#!/usr/bin/env bash
set -euo pipefail

destination=/opt/apollo-rag/backups
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
archive="$destination/$stamp.tar.zst"

mkdir -p "$destination"
tar --zstd -cf "$archive.tmp" --exclude=shared/.uv-cache -C /opt/apollo-rag shared
mv "$archive.tmp" "$archive"
find "$destination" -maxdepth 1 -type f -name '*.tar.zst' -mtime +14 -delete
