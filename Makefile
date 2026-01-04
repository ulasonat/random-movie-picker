.PHONY: build run

build:
	python3 scripts/build_data.py

run: build
	open local.html

run-global: build
	open index.html
