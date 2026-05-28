#!/bin/sh
# 首次启动种子注入：如果挂卷上的 /data 为空（或缺关键文件），
# 把镜像内 /seed/ 的初始数据拷过去，再正常起 uvicorn。
# 已经有数据则不动，避免覆盖用户增量。
set -e

SEED_DIR=${SEED_DIR:-/seed}
DATA_DIR=${DATA_DIR:-/data}

mkdir -p "$DATA_DIR"

if [ -d "$SEED_DIR" ] && [ ! -f "$DATA_DIR/app.db" ]; then
  echo "[entrypoint] /data is empty, seeding from $SEED_DIR ..."
  cp -a "$SEED_DIR"/. "$DATA_DIR"/
  # 清掉 Milvus Lite 的 LOCK 残留（dump 时持有的旧 flock 目标，runtime 应该重新创建）
  find "$DATA_DIR" -name LOCK -type f -delete 2>/dev/null || true
  echo "[entrypoint] seed copied."
else
  echo "[entrypoint] /data already has app.db, skip seeding."
fi

# uploads 单独做一次：app.db 可能存在但 uploads 子目录还没建（比如老镜像升级）
# 镜像里的 /seed/uploads 只有 products/ 子目录（封面图），KB 文档需要 admin 重新上传
if [ -d "$SEED_DIR/uploads" ] && [ ! -d "$DATA_DIR/uploads" ]; then
  echo "[entrypoint] seeding uploads from $SEED_DIR/uploads ..."
  mkdir -p "$DATA_DIR/uploads"
  cp -a "$SEED_DIR/uploads/." "$DATA_DIR/uploads/"
  echo "[entrypoint] uploads seeded."
fi

exec "$@"
