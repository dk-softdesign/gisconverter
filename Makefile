.DEFAULT_GOAL := help

IMAGE_NAME    ?= gisconverter
IMAGE_TAG     ?= latest
IMAGE         := $(IMAGE_NAME):$(IMAGE_TAG)
CONTAINER_NAME ?= gisconverter
PORT          ?= 3000
REGISTRY      ?= dockerrepo.softdesign.dk:5000

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- App (no Docker) ---

.PHONY: install
install: ## Install dependencies (npm ci)
	npm ci

.PHONY: dev
dev: ## Run the dev server
	npm run dev

.PHONY: build
build: ## Production build into .output/ (npm run build)
	npm run build

.PHONY: lint
lint: ## Lint with oxlint
	npm run lint

.PHONY: format
format: ## Format with oxfmt
	npm run format

.PHONY: format-check
format-check: ## Check formatting without writing
	npm run format:check

.PHONY: typecheck
typecheck: ## Type-check with tsc
	npm run typecheck

.PHONY: check
check: ## lint + format-check + typecheck
	npm run check

.PHONY: clean
clean: ## Remove local build artifacts (.output, .nitro, .tanstack, dist, dist-ssr)
	rm -rf .output .nitro .tanstack dist dist-ssr

.PHONY: clean-all
clean-all: clean ## clean, plus node_modules (forces a full reinstall next time)
	rm -rf node_modules

## --- Docker ---

.PHONY: image
image: ## Build the Docker image (override name/tag via IMAGE_NAME/IMAGE_TAG)
	docker build -t $(IMAGE) .

.PHONY: run
run: image ## Build (if needed) and run the image (override port via PORT, default 3000)
	docker run --rm -d --name $(CONTAINER_NAME) -p $(PORT):3000 $(IMAGE)
	@echo "Running at http://localhost:$(PORT) — logs: make logs, stop: make stop"

.PHONY: stop
stop: ## Stop the running container (started via `make run`)
	docker stop $(CONTAINER_NAME) 2>/dev/null || true

.PHONY: logs
logs: ## Follow logs from the running container
	docker logs -f $(CONTAINER_NAME)

.PHONY: shell
shell: ## Open a shell inside the running container
	docker exec -it $(CONTAINER_NAME) sh

.PHONY: push
push: image ## Push the image to REGISTRY (default: dockerrepo.softdesign.dk:5000; override with REGISTRY=...)
	@if [ -z "$(REGISTRY)" ]; then \
		echo "REGISTRY is not set, e.g.: REGISTRY=ghcr.io/your-org make push" >&2; \
		exit 1; \
	fi
	docker tag $(IMAGE) $(REGISTRY)/$(IMAGE)
	docker push $(REGISTRY)/$(IMAGE)

.PHONY: image-clean
image-clean: ## Remove the local Docker image
	docker rmi $(IMAGE) 2>/dev/null || true
