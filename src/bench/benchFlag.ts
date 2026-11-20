/**
 * The search bench's switch. Always false in the repository: a normal build
 * never starts the bench runner. tools/search-bench/device/bench.js sets it
 * to true only while it builds a bench APK, then puts it back.
 */
export const BENCH_BUILD = false;
