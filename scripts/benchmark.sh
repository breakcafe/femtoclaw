#!/usr/bin/env bash
# benchmark.sh — Compare Node.js vs Bun runtime performance
# Usage: ./scripts/benchmark.sh [node|bun|both]
#
# Measures: image size, startup time, /health latency, /chat throughput,
#           memory usage under load
set -euo pipefail

RUNTIME=${1:-both}
RESULTS_DIR="$(dirname "$0")/../benchmark-results"
mkdir -p "$RESULTS_DIR"

NODE_IMAGE="femtoclaw:node"
BUN_IMAGE="femtoclaw:bun"
PORT_NODE=9100
PORT_BUN=9101
WARMUP_REQUESTS=3
BENCH_REQUESTS=20

log() { echo "==> $*"; }

cleanup() {
  docker rm -f fc-node-bench fc-bun-bench 2>/dev/null || true
}
trap cleanup EXIT

# ─── Build images ───
build_images() {
  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "node" ]]; then
    log "Building Node.js image..."
    time docker build --platform linux/amd64 -t "$NODE_IMAGE" -f Dockerfile . 2>&1 | tail -3
  fi
  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "bun" ]]; then
    log "Building Bun image..."
    time docker build --platform linux/amd64 -t "$BUN_IMAGE" -f Dockerfile.bun . 2>&1 | tail -3
  fi
}

# ─── Image sizes ───
image_sizes() {
  log "Image sizes:"
  docker images --format "  {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep femtoclaw || true
}

# ─── Startup time ───
measure_startup() {
  local name=$1 image=$2 port=$3
  log "Measuring $name startup time..."

  local start_ns
  start_ns=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')

  docker run -d --name "$name" --platform linux/amd64 \
    -p "$port:9000" \
    -e ANTHROPIC_API_KEY=sk-placeholder \
    -e LOG_LEVEL=warn \
    "$image" >/dev/null

  # Wait for health endpoint
  local attempts=0
  while ! curl -sf "http://localhost:$port/health" >/dev/null 2>&1; do
    sleep 0.1
    attempts=$((attempts + 1))
    if [[ $attempts -ge 100 ]]; then
      echo "  TIMEOUT: $name failed to start within 10s"
      return 1
    fi
  done

  local end_ns
  end_ns=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  local ms=$(( (end_ns - start_ns) / 1000000 ))
  echo "  $name startup: ${ms}ms"
  echo "$name startup_ms $ms" >> "$RESULTS_DIR/raw.txt"
}

# ─── Health endpoint latency ───
measure_health_latency() {
  local name=$1 port=$2
  log "Measuring $name /health latency (${BENCH_REQUESTS} requests)..."

  # Warmup
  for i in $(seq 1 $WARMUP_REQUESTS); do
    curl -sf "http://localhost:$port/health" >/dev/null
  done

  local total_ms=0
  local min_ms=999999
  local max_ms=0

  for i in $(seq 1 $BENCH_REQUESTS); do
    local time_ms
    time_ms=$(curl -sf -o /dev/null -w '%{time_total}' "http://localhost:$port/health")
    # Convert seconds to ms (integer)
    local ms
    ms=$(python3 -c "print(int(float('$time_ms') * 1000))")
    total_ms=$((total_ms + ms))
    [[ $ms -lt $min_ms ]] && min_ms=$ms
    [[ $ms -gt $max_ms ]] && max_ms=$ms
  done

  local avg_ms=$((total_ms / BENCH_REQUESTS))
  echo "  $name /health: avg=${avg_ms}ms min=${min_ms}ms max=${max_ms}ms"
  echo "$name health_avg_ms $avg_ms" >> "$RESULTS_DIR/raw.txt"
  echo "$name health_min_ms $min_ms" >> "$RESULTS_DIR/raw.txt"
  echo "$name health_max_ms $max_ms" >> "$RESULTS_DIR/raw.txt"
}

# ─── Chat validation latency (non-streaming, no API key so expect 200 on /skills) ───
measure_api_latency() {
  local name=$1 port=$2
  log "Measuring $name API latency (GET /skills, GET /chat, ${BENCH_REQUESTS} requests each)..."

  local total_ms=0
  for i in $(seq 1 $BENCH_REQUESTS); do
    local time_ms
    time_ms=$(curl -sf -o /dev/null -w '%{time_total}' "http://localhost:$port/skills")
    local ms
    ms=$(python3 -c "print(int(float('$time_ms') * 1000))")
    total_ms=$((total_ms + ms))
  done
  local avg_ms=$((total_ms / BENCH_REQUESTS))
  echo "  $name GET /skills: avg=${avg_ms}ms"
  echo "$name skills_avg_ms $avg_ms" >> "$RESULTS_DIR/raw.txt"

  total_ms=0
  for i in $(seq 1 $BENCH_REQUESTS); do
    local time_ms
    time_ms=$(curl -sf -o /dev/null -w '%{time_total}' \
      -H "X-User-Id: bench-user" \
      "http://localhost:$port/chat")
    local ms
    ms=$(python3 -c "print(int(float('$time_ms') * 1000))")
    total_ms=$((total_ms + ms))
  done
  avg_ms=$((total_ms / BENCH_REQUESTS))
  echo "  $name GET /chat: avg=${avg_ms}ms"
  echo "$name chat_list_avg_ms $avg_ms" >> "$RESULTS_DIR/raw.txt"
}

# ─── Memory usage ───
measure_memory() {
  local name=$1
  log "Measuring $name memory usage..."

  local mem
  mem=$(docker stats --no-stream --format "{{.MemUsage}}" "$name" 2>/dev/null | awk -F/ '{print $1}' | xargs)
  echo "  $name memory: $mem"
  echo "$name memory $mem" >> "$RESULTS_DIR/raw.txt"
}

# ─── Concurrent request throughput ───
measure_throughput() {
  local name=$1 port=$2
  log "Measuring $name throughput (50 concurrent /health)..."

  # Use background curl processes for concurrency
  local start_ns
  start_ns=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')

  local pids=()
  for i in $(seq 1 50); do
    curl -sf -o /dev/null "http://localhost:$port/health" &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

  local end_ns
  end_ns=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  local ms=$(( (end_ns - start_ns) / 1000000 ))
  local rps=$((50 * 1000 / (ms + 1)))
  echo "  $name throughput: 50 reqs in ${ms}ms (~${rps} rps)"
  echo "$name throughput_50_ms $ms" >> "$RESULTS_DIR/raw.txt"
  echo "$name throughput_rps $rps" >> "$RESULTS_DIR/raw.txt"
}

# ─── Main ───
main() {
  echo "Femtoclaw Node.js vs Bun Performance Benchmark"
  echo "================================================"
  echo ""

  > "$RESULTS_DIR/raw.txt"

  build_images
  echo ""
  image_sizes
  echo ""

  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "node" ]]; then
    measure_startup "fc-node-bench" "$NODE_IMAGE" $PORT_NODE
  fi
  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "bun" ]]; then
    measure_startup "fc-bun-bench" "$BUN_IMAGE" $PORT_BUN
  fi
  echo ""

  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "node" ]]; then
    measure_health_latency "fc-node-bench" $PORT_NODE
    measure_api_latency "fc-node-bench" $PORT_NODE
    measure_throughput "fc-node-bench" $PORT_NODE
    measure_memory "fc-node-bench"
  fi
  echo ""

  if [[ "$RUNTIME" == "both" || "$RUNTIME" == "bun" ]]; then
    measure_health_latency "fc-bun-bench" $PORT_BUN
    measure_api_latency "fc-bun-bench" $PORT_BUN
    measure_throughput "fc-bun-bench" $PORT_BUN
    measure_memory "fc-bun-bench"
  fi
  echo ""

  log "Raw results saved to $RESULTS_DIR/raw.txt"
  echo ""
  cat "$RESULTS_DIR/raw.txt"
}

main
