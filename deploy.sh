#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
DOCKER_CONFIG="${DOCKER_CONFIG:-${ROOT_DIR}/.docker}"

mkdir -p "${DOCKER_CONFIG}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[ERROR] Missing required env file at ${ENV_FILE}." >&2
  exit 1
fi

COMPOSE_FILES=(
  -f "${ROOT_DIR}/docker-compose.yml"
)

if [[ -f "${ROOT_DIR}/docker-compose.nginx-certbot.yml" ]]; then
  COMPOSE_FILES+=(-f "${ROOT_DIR}/docker-compose.nginx-certbot.yml")
fi

compose() {
  DOCKER_CONFIG="${DOCKER_CONFIG}" docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" "$@"
}

if [[ ${1-} == "--status" ]]; then
  compose ps
  exit 0
fi

if [[ ${1-} == "--logs" ]]; then
  SERVICE="${2:-api}"
  compose logs --tail 200 -f "${SERVICE}"
  exit 0
fi

CLEAN_ONLY=0
REBUILD=0
WIPE_VOLUMES=0
RUN_CERTBOT=0
SKIP_PULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean-only) CLEAN_ONLY=1; shift ;;
    --rebuild) REBUILD=1; shift ;;
    --wipe-volumes) WIPE_VOLUMES=1; shift ;;
    --certbot) RUN_CERTBOT=1; shift ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    --status|--logs)
      break
      ;;
    *)
      break
      ;;
  esac
done

update_repo() {
  if ! git -C "${ROOT_DIR}" diff --quiet || ! git -C "${ROOT_DIR}" diff --cached --quiet; then
    echo "[WARN] Working tree is dirty; skipping git pull."
    return 0
  fi
  echo "[INFO] Updating repo (git pull --ff-only)."
  git -C "${ROOT_DIR}" fetch --prune
  git -C "${ROOT_DIR}" pull --ff-only
}

clean_images() {
  echo "[INFO] Stopping and removing compose-managed containers and images."
  if [[ "${WIPE_VOLUMES}" -eq 1 ]]; then
    echo "[WARN] --wipe-volumes specified: volumes WILL be removed (this may delete DB/data)."
    compose down --rmi all --volumes --remove-orphans || true
  else
    compose down --rmi all --remove-orphans || true
  fi

  echo "[INFO] Pruning builder cache (may free many GBs)."
  docker builder prune --all --force || true

  echo "[INFO] Pruning dangling images."
  docker image prune -f || true

  echo "[OK] Clean step complete."
}

rebuild_images() {
  echo "[INFO] Performing clean rebuild (remove images + build --no-cache)."
  clean_images

  echo "[INFO] Building images (no cache) for api, celery, frontend, and nginx."
  compose build --no-cache api celery frontend nginx
  echo "[OK] Build complete."
}

pull_images() {
  if [[ "${SKIP_PULL}" -eq 1 ]]; then
    echo "[INFO] --skip-pull specified; skipping docker pull."
    return 0
  fi
  echo "[INFO] Pulling base images."
  compose pull postgres redis certbot || true
}

run_migrations() {
  echo "[INFO] Running database migrations."
  compose exec -T api bash -lc "alembic upgrade head"
}

wait_for_readiness() {
  echo "[INFO] Waiting for API readiness (timeout: 60s)."
  local deadline=$((SECONDS + 60))

  while (( SECONDS < deadline )); do
    if compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).read()" >/dev/null 2>&1; then
      echo "[OK] API is ready."
      return 0
    fi
    sleep 2
  done

  echo "[WARN] API failed readiness check within 60s."
  echo "[INFO] Recent api logs (last 50 lines):"
  compose logs --tail 50 api || true
}

run_certbot() {
  if [[ "${RUN_CERTBOT}" -ne 1 ]]; then
    return 0
  fi
  echo "[INFO] Running certbot."
  compose run --rm certbot
  echo "[INFO] Restarting nginx after certbot."
  compose restart nginx
}

print_summary() {
  echo "[SUMMARY] Container status"
  compose ps

  echo "[SUMMARY] API /readyz"
  if READYZ_OUTPUT=$(compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).read().decode())" 2>/dev/null); then
    echo "  readyz: OK"
    echo "  payload: ${READYZ_OUTPUT}"
  else
    echo "  readyz: FAILED"
  fi
}

if [[ "${CLEAN_ONLY}" -eq 1 && "${REBUILD}" -eq 0 ]]; then
  clean_images
  exit 0
fi

update_repo
pull_images

if [[ "${REBUILD}" -eq 1 ]]; then
  rebuild_images
fi

echo "[STEP] Starting services."
compose up -d --remove-orphans

run_migrations
wait_for_readiness
run_certbot

GIT_SHA="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
printf "GIT_SHA=%s\n" "${GIT_SHA}" > "${ROOT_DIR}/.deployed_tag"
echo "[OK] Deploy complete. Tag info recorded in ${ROOT_DIR}/.deployed_tag"

print_summary
