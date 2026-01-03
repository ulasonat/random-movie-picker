.PHONY: build run

build:
	python3 scripts/build_data.py

run: build
	open index.html
