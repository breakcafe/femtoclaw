IMAGE_NAME := femtoclaw
IMAGE_TAG := latest
CONTAINER_NAME := femtoclaw-dev
PORT := 9000
RUNTIME := node

BUILD_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo unknown)
BUILD_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

GHCR_IMAGE := ghcr.io/breakcafe/femtoclaw
GIT_BRANCH := $(shell git branch --show-current 2>/dev/null || echo unknown)
IS_MAIN := $(filter main,$(GIT_BRANCH))
BRANCH_SLUG := $(shell echo "$(GIT_BRANCH)" | sed 's/[^a-zA-Z0-9]/-/g' | tr 'A-Z' 'a-z')

ifneq (,$(wildcard .env))
include .env
export
endif

# ── Build ────────────────────────────────────────────────

build-ts: ## Compile TypeScript to dist/
	npm run build

dev: build-ts ## Run from compiled dist/
	node dist/index.js

dev-watch: ## Run from source with tsx watch
	npx tsx --watch src/index.ts

# ── Docker ───────────────────────────────────────────────

docker-build: ## Build Docker image (RUNTIME=node|bun)
	docker build --platform linux/amd64 \
		--build-arg RUNTIME=$(RUNTIME) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg BUILD_COMMIT=$(BUILD_COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) .

docker-build-bun: ## Build Docker image with Bun runtime
	$(MAKE) docker-build RUNTIME=bun IMAGE_TAG=bun

docker-run: _ensure-data-dir ## Run container interactively
	docker run --rm -it \
		--name $(CONTAINER_NAME) \
		-p $(PORT):9000 \
		--env-file .env \
		-v $(CURDIR)/dev-data:/data \
		$(IMAGE_NAME):$(IMAGE_TAG)

docker-run-bg: _ensure-data-dir ## Run container in background
	docker run -d --rm \
		--name $(CONTAINER_NAME) \
		-p $(PORT):9000 \
		--env-file .env \
		-v $(CURDIR)/dev-data:/data \
		$(IMAGE_NAME):$(IMAGE_TAG)

docker-stop: ## Stop the running container
	docker stop $(CONTAINER_NAME) 2>/dev/null || true

docker-logs: ## Tail container logs
	docker logs -f $(CONTAINER_NAME)

# ── GHCR (Container Registry) ────────────────────────────

ghcr-login: ## Authenticate Docker to GHCR via gh CLI
	@gh auth token | docker login ghcr.io -u $(shell gh api user -q .login) --password-stdin

ghcr-build: ## Build image with GHCR tags (RUNTIME=node|bun)
ifdef IS_MAIN
	docker build --platform linux/amd64 \
		--build-arg RUNTIME=$(RUNTIME) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg BUILD_COMMIT=$(BUILD_COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		-t $(GHCR_IMAGE):latest \
		-t $(GHCR_IMAGE):$(BUILD_VERSION) \
		-t $(GHCR_IMAGE):$(BUILD_VERSION)-$(BUILD_COMMIT) .
else
	docker build --platform linux/amd64 \
		--build-arg RUNTIME=$(RUNTIME) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg BUILD_COMMIT=$(BUILD_COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		-t $(GHCR_IMAGE):dev \
		-t $(GHCR_IMAGE):dev-$(BUILD_COMMIT) \
		-t $(GHCR_IMAGE):dev-$(BRANCH_SLUG) .
endif

ghcr-push: ghcr-login ## Push image tags to GHCR
ifdef IS_MAIN
	docker push $(GHCR_IMAGE):latest
	docker push $(GHCR_IMAGE):$(BUILD_VERSION)
	docker push $(GHCR_IMAGE):$(BUILD_VERSION)-$(BUILD_COMMIT)
else
	docker push $(GHCR_IMAGE):dev
	docker push $(GHCR_IMAGE):dev-$(BUILD_COMMIT)
	docker push $(GHCR_IMAGE):dev-$(BRANCH_SLUG)
endif

ghcr-release: ghcr-build ghcr-push ## Build and push to GHCR

ghcr-make-public: ## One-time: set GHCR package visibility to public
	gh api -X PUT 'orgs/breakcafe/packages/container/femtoclaw/visibility' -f visibility=public \
		2>/dev/null || \
	gh api -X PUT 'users/breakcafe/packages/container/femtoclaw/visibility' -f visibility=public

# ── Test ─────────────────────────────────────────────────

test: ## Run unit tests
	npm test

test-health: ## Smoke test: GET /health
	@curl -s http://localhost:$(PORT)/health | python3 -m json.tool

test-chat: ## Smoke test: POST /chat
	@curl -s -X POST http://localhost:$(PORT)/chat \
		-H "Authorization: Bearer $(API_TOKEN)" \
		-H "Content-Type: application/json" \
		-H "X-User-Id: test-user" \
		-d '{"message":"Reply with exactly PONG","stream":false}' \
		| python3 -m json.tool

# ── Cleanup ──────────────────────────────────────────────

clean: docker-stop ## Stop container and remove images
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) 2>/dev/null || true
	docker rmi $(IMAGE_NAME):bun 2>/dev/null || true

clean-data: ## Remove local dev data
	rm -rf dev-data

# ── Internal ─────────────────────────────────────────────

_ensure-data-dir:
	@mkdir -p dev-data

_wait-ready:
	@for i in $$(seq 1 30); do \
		curl -sf http://localhost:$(PORT)/health > /dev/null 2>&1 && break; \
		sleep 1; \
	done
	@curl -sf http://localhost:$(PORT)/health > /dev/null 2>&1 \
		|| (echo "Server failed to start" && docker logs $(CONTAINER_NAME) && exit 1)

# ── Help ─────────────────────────────────────────────────

.DEFAULT_GOAL := help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: build-ts dev dev-watch docker-build docker-build-bun docker-run docker-run-bg \
	docker-stop docker-logs ghcr-login ghcr-build ghcr-push ghcr-release \
	ghcr-make-public test test-health test-chat clean clean-data \
	help _ensure-data-dir _wait-ready
