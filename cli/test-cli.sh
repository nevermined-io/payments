#!/bin/bash
echo "=== CLI Version ==="
./bin/run.js --version

echo -e "\n=== Main Help ==="
./bin/run.js --help | head -20

echo -e "\n=== Config Commands ==="
./bin/run.js config --help

echo -e "\n=== Plans Commands ==="
./bin/run.js plans --help

echo -e "\n=== Agents Commands ==="
./bin/run.js agents --help

echo -e "\n=== X402 Commands ==="
./bin/run.js x402 --help

echo -e "\n=== Configuration Test ==="
./bin/run.js config show

echo -e "\n=== CLI Test Complete ==="
