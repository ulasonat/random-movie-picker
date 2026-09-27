.PHONY: build run run-global

build:
	python3 scripts/build_data.py

run:
	open -a "Google Chrome" local.html

run-global:
	open -a "Google Chrome" index.html
