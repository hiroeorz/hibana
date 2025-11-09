SHELL := /bin/bash
.PHONY: all build install uninstall test clean deps publish check-version bump-version publish-runtime publish-cli check-clean versions

VERSION ?=
CLI_VERSION ?=
RUNTIME_VERSION ?=
TAG ?= latest
ALLOW_DIRTY ?=

all: build

deps:
	npm run deps

build:
	npm run build:all

test:
	npm run test:all

install:
	npm run install:local

uninstall:
	npm run uninstall:local

clean:
	npm run clean

versions:
	npm run versions

publish: check-version check-clean bump-version
	npm run deps
	npm run test:all
	npm run build:all
	$(MAKE) publish-runtime
	$(MAKE) publish-cli

check-version:
	@if [ -z "$(VERSION)" ] && { [ -z "$(CLI_VERSION)" ] || [ -z "$(RUNTIME_VERSION)" ]; }; then \
		echo "Set VERSION or both CLI_VERSION and RUNTIME_VERSION"; \
		exit 1; \
	fi

check-clean:
	@if [ -z "$(ALLOW_DIRTY)" ]; then \
		if [ -n "$$(git status --porcelain)" ]; then \
			echo "Working tree is dirty. Commit or stash changes, or set ALLOW_DIRTY=1"; \
			exit 1; \
		fi; \
	fi

bump-version:
	@if [ -z "$(RUNTIME_TARGET_VERSION)" ] || [ -z "$(CLI_TARGET_VERSION)" ]; then \
		echo "Unable to determine versions to bump"; \
		exit 1; \
	fi
	node scripts/bump-version.mjs --runtime=$(RUNTIME_TARGET_VERSION) --cli=$(CLI_TARGET_VERSION)

publish-runtime:
	cd packages/runtime && npm publish --access public --tag $(TAG)

publish-cli:
	cd packages/cli && npm publish --access public --tag $(TAG)

RUNTIME_TARGET_VERSION = $(if $(RUNTIME_VERSION),$(RUNTIME_VERSION),$(VERSION))
CLI_TARGET_VERSION = $(if $(CLI_VERSION),$(CLI_VERSION),$(VERSION))
