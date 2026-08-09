# ECC Baseline Assessment

**Assessment date:** 9 August 2026
**Private baseline:** `ArowuTest/ai-engineering-os`
**Accepted ECC source commit:** `51a6950bde756fe3ebc8879aa0c8ee49b9c53e78`

## Purpose

This record separates inherited ECC/toolchain findings from defects introduced by the private AI Engineering OS platform.

## Static ECC Verification

The following checks pass on the current Windows development machine:

- Unicode safety;
- all 67 agent definitions;
- all 284 skill directories;
- personal absolute-path validation;
- repository/documentation catalogue consistency;
- generated command registry consistency.

No ECC core source file was intentionally modified by the V1 platform foundation work.
## Environment Findings

Development toolchain observed during baseline verification:

- Node.js: `v22.15.0`;
- npm: `10.9.2`;
- Docker: `29.6.2`;
- Docker Compose: `v5.3.1`;
- Git: `2.49.0.windows.1`.

The inherited ECC dependency `ini@7.0.0` declares a Node engine floor above the installed Node 22 patch level. Installation succeeds, but this warning should be removed by upgrading the development Node runtime before production CI is finalised.

Desktop Commander sessions currently launch with an empty Windows `ComSpec`. npm lifecycle commands therefore require session-local `ComSpec=C:\Windows\System32\cmd.exe`. This is an execution-environment quirk, not an ECC or platform code defect.

No `python`, `python3`, or Windows `py` launcher was available during this assessment.
## Inherited Dependency Findings

`npm audit` on the imported ECC baseline reported two high-severity findings. One observed path involved `js-yaml` through the inherited markdown linting toolchain. npm's proposed remediation included a semver-major tool update.

No forced audit remediation was applied. These findings must be handled through the controlled ECC upstream/security update process so a security fix does not silently break ECC compatibility.

The private `platform/` workspace reported zero npm audit vulnerabilities at the time of the V1 foundation build.

## Inherited Test Limitation

A long-running ECC baseline test pass progressed successfully across the normal validators and many runtime suites. Four observation-entrypoint cases failed because their runtime path requires Python, which was not installed on this Windows host:

- `cli`;
- `sdk-ts`;
- `claude-desktop`;
- `claude-vscode`.

Denied-entrypoint cases passed and another Python-dependent security-monitor case skipped. The full ECC suite is therefore **not recorded as fully passing** on this machine. The finding is environmental and pre-dates the private platform implementation.