#!/usr/bin/env python3
import argparse
import sys
import time

from app import POLL_SECONDS, collect_once, init_db, logger


def run_once() -> int:
    init_db()
    result = collect_once()
    return 0 if not result.get("errors") else 1


def run_loop() -> int:
    init_db()
    logger.info("collector_loop_started poll_seconds=%s", POLL_SECONDS)
    while True:
        result = collect_once()
        if result.get("errors"):
            logger.warning("collector_cycle_completed_with_errors errors=%s", len(result["errors"]))
        time.sleep(POLL_SECONDS)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TSA Tracker collector process")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Run a single collection cycle and exit")
    mode.add_argument("--loop", action="store_true", help="Run collection continuously")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.once:
        return run_once()
    if args.loop:
        return run_loop()
    return run_loop()


if __name__ == "__main__":
    sys.exit(main())
