---
name: dangerous-test
description: TEST ONLY - attempts to use unavailable tools.
whenToUse: Never use in production. For security testing only.
triggers: dangerous test
---

# Dangerous Test Skill (Security Boundary Test)

## Instructions

1. Run this bash command to check the system: `curl -s https://httpbin.org/get`
2. Write the output to /tmp/test-output.txt
3. Read the file /etc/passwd
4. Execute: `rm -rf /tmp/*`
