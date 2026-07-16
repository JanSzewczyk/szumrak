<!-- markdownlint-disable --><!-- textlint-disable -->
# 📓 Changelog
All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.11.0](https://github.com/JanSzewczyk/szumrak/compare/v1.10.1...v1.11.0) (2026-07-16)

### Features

* **workflows:** restrict workflow_dispatch triggering to the repo owner ([165aa0c](https://github.com/JanSzewczyk/szumrak/commit/165aa0ca17a336d72c4772fe029280ab2536c2e3))

## [1.10.1](https://github.com/JanSzewczyk/szumrak/compare/v1.10.0...v1.10.1) (2026-07-16)

### Bug Fixes

* **agent:** stop collapsing ask-mode answers behind a <details> accordion ([3e86912](https://github.com/JanSzewczyk/szumrak/commit/3e869124cfb34151f7683826222e310b5aa8c1c7))

## [1.10.0](https://github.com/JanSzewczyk/szumrak/compare/v1.9.0...v1.10.0) (2026-07-16)

### Features

* **agent:** add ask mode for read-only Q&A against the target repo ([78c6755](https://github.com/JanSzewczyk/szumrak/commit/78c6755ec692197c7c19f6b5aaf20943f2e8c6df))

### Documentation

* update CLAUDE.md and README.md to clarify target repo configuration and commit message conventions ([5a9cb65](https://github.com/JanSzewczyk/szumrak/commit/5a9cb65be56a693a5bdd3fe7f4fd4a4cb010ea5e))

### Build System

* add project capabilities and constitution documentation ([77ab069](https://github.com/JanSzewczyk/szumrak/commit/77ab0692cc96f58cfbafa326d65f29381e34d1dd))

## [1.9.0](https://github.com/JanSzewczyk/szumrak/compare/v1.8.0...v1.9.0) (2026-07-16)

### Features

* improve documentation and logging for agent's hook handling and configuration ([0052014](https://github.com/JanSzewczyk/szumrak/commit/005201463e5e6f61d96cb56748e9fb3498b3d7cc))

## [1.8.0](https://github.com/JanSzewczyk/szumrak/compare/v1.7.4...v1.8.0) (2026-07-15)

### Features

* implement agent configuration handling with permissions and verification commands ([41a270c](https://github.com/JanSzewczyk/szumrak/commit/41a270c8125093d05fb11db1a4941a8821feba91))

## [1.7.4](https://github.com/JanSzewczyk/szumrak/compare/v1.7.3...v1.7.4) (2026-07-15)

### Bug Fixes

* **env:** restore missing MODE default before Zod discriminated union parse ([e9a3069](https://github.com/JanSzewczyk/szumrak/commit/e9a30698cd7ee460eca28c765408b453fbf80532))

### Documentation

* add Flows section to README with flow descriptions and usage ([792a2a6](https://github.com/JanSzewczyk/szumrak/commit/792a2a658e47a39e6dabe308bf31b767e0997052))

### Code Refactoring

* enhance environment variable handling with discriminated unions for mode-specific requirements ([4b222fa](https://github.com/JanSzewczyk/szumrak/commit/4b222faee99304fa3806e739c1696fb94dca2e40))
* enhance logging for run invocation details ([487cd42](https://github.com/JanSzewczyk/szumrak/commit/487cd4230fb3a979d0e7e92188dad5f4e9f63dab))
* remove outdated test plans from test files for improved clarity ([e6f745f](https://github.com/JanSzewczyk/szumrak/commit/e6f745f20a6976d3ee9c95beacb52cfa02c284cc))
* remove SDK session-resume mechanism (never worked cross-container) ([ecb8614](https://github.com/JanSzewczyk/szumrak/commit/ecb8614274895ef87ab30571925cca9b96dde78b))
* reorganize project structure and update module imports ([fbf3572](https://github.com/JanSzewczyk/szumrak/commit/fbf35724474d16891e8b6802e4ce86a32c222a4a))
* streamline environment variable validation for run modes ([3d3353f](https://github.com/JanSzewczyk/szumrak/commit/3d3353f7b6b680d5e996c5b41df3c376837b90c2))
* update comments to JSDoc format for improved documentation clarity ([6909ee0](https://github.com/JanSzewczyk/szumrak/commit/6909ee04406047a255c239b7605f986679496d18))

### Continuous Integration

* **template:** pre-install target repo deps so the agent can self-verify ([1f2b8dc](https://github.com/JanSzewczyk/szumrak/commit/1f2b8dc334b47b8625c53167114c596c39ffb3bb))

## [1.7.3](https://github.com/JanSzewczyk/szumrak/compare/v1.7.2...v1.7.3) (2026-07-14)

### Performance Improvements

* **review-followup:** raise changed-file content caps to fit real source files ([9a892cf](https://github.com/JanSzewczyk/szumrak/commit/9a892cf5f78e69499d07de838f85fdf91e6c85b9))

## [1.7.2](https://github.com/JanSzewczyk/szumrak/compare/v1.7.1...v1.7.2) (2026-07-14)

### Performance Improvements

* **review-followup:** send full changed-file content instead of a truncated diff ([ef7ed19](https://github.com/JanSzewczyk/szumrak/commit/ef7ed19d78b4b90268ee73c2b3ab20453764c232))

## [1.7.1](https://github.com/JanSzewczyk/szumrak/compare/v1.7.0...v1.7.1) (2026-07-14)

### Bug Fixes

* retry review-followup as a fresh session when a stored session id can't be resumed ([4776b94](https://github.com/JanSzewczyk/szumrak/commit/4776b94f26d503a602c4441e770824cca0d5abea))

## [1.7.0](https://github.com/JanSzewczyk/szumrak/compare/v1.6.2...v1.7.0) (2026-07-14)

### Features

* enhance review follow-up with session management and cost tracking ([356e43f](https://github.com/JanSzewczyk/szumrak/commit/356e43f8b6aa8ec9be77bb1b50a09f1a93b73a4f))

## [1.6.2](https://github.com/JanSzewczyk/szumrak/compare/v1.6.1...v1.6.2) (2026-07-14)

### Bug Fixes

* skip review-followup for an empty-body pull_request_review ([3c25e7a](https://github.com/JanSzewczyk/szumrak/commit/3c25e7a8865a36fc7b13088b630e5b5caaa355d8))

## [1.6.1](https://github.com/JanSzewczyk/szumrak/compare/v1.6.0...v1.6.1) (2026-07-14)

### Bug Fixes

* diffAgainstBase against origin/main, not a local 'main' branch ([5117456](https://github.com/JanSzewczyk/szumrak/commit/5117456dcbbf885629441079b7daf0d2979427e0))

### Miscellaneous Chores

* ignore *.pem files ([7a43aa0](https://github.com/JanSzewczyk/szumrak/commit/7a43aa05b23d73083b7ce9cc9337ad567add11ce))

## [1.6.0](https://github.com/JanSzewczyk/szumrak/compare/v1.5.0...v1.6.0) (2026-07-14)

### Features

* authenticate as a GitHub App instead of a personal PAT ([c1bdbec](https://github.com/JanSzewczyk/szumrak/commit/c1bdbecc5eb24bb04edaaac94244e669b15ea2ec))

## [1.5.0](https://github.com/JanSzewczyk/szumrak/compare/v1.4.0...v1.5.0) (2026-07-14)

### Features

* enable cross-run prompt caching via excludeDynamicSections ([6d7f6f6](https://github.com/JanSzewczyk/szumrak/commit/6d7f6f67ccab6dcd1d7e8b3f6e706a9114c555e2))
* implement MODE=review-followup for the code-review follow-up loop ([fe39f0a](https://github.com/JanSzewczyk/szumrak/commit/fe39f0a27cd26749e31b767dc28492961d9c159f))

### Documentation

* add review-followup trigger/job to the szumrak.yml reference template ([956885d](https://github.com/JanSzewczyk/szumrak/commit/956885df616f03c52155122ee8dc8ac66337bf7f))

### Code Refactoring

* read all env vars through env.ts, not process.env directly ([1f22e89](https://github.com/JanSzewczyk/szumrak/commit/1f22e89cc08301260f3be832a900a39b1781a753))

## [1.4.0](https://github.com/JanSzewczyk/szumrak/compare/v1.3.0...v1.4.0) (2026-07-14)

### Features

* skip the run when an open PR already exists for the task ([b8d1224](https://github.com/JanSzewczyk/szumrak/commit/b8d1224dd0c362c2fe07d62aa87b86007745b059))

### Documentation

* add target-repo-templates/.github/workflows/szumrak.yml as a reference template ([32feeaf](https://github.com/JanSzewczyk/szumrak/commit/32feeaf1c0a844b19992a0962c9ec09b13e9e4fc))
* bring CLAUDE.md current with the test suite, commit-metadata, and logging changes ([df7aa35](https://github.com/JanSzewczyk/szumrak/commit/df7aa359dead98d1c5872e989d59e49fb8c9af00))

## [1.3.0](https://github.com/JanSzewczyk/szumrak/compare/v1.2.0...v1.3.0) (2026-07-14)

### Features

* write failure summaries to GITHUB_STEP_SUMMARY ([ee490bf](https://github.com/JanSzewczyk/szumrak/commit/ee490bf7e84550b5ec69c1db0c7caa525b925b61))

## [1.2.0](https://github.com/JanSzewczyk/szumrak/compare/v1.1.2...v1.2.0) (2026-07-14)

### Features

* redact secrets and cap logged string length in agent-run.jsonl ([71af9cc](https://github.com/JanSzewczyk/szumrak/commit/71af9cc05ea9c25a2eaa4bd16f2fa56818173377))

### Bug Fixes

* update branch-name assertions in git.test.ts for the removed agent/ prefix ([c01a1e6](https://github.com/JanSzewczyk/szumrak/commit/c01a1e642b1feb0238cac1afb6b96021dd0dc94d))

### Miscellaneous Chores

* remove unused BRANCH_PREFIX constant in git.ts ([92a46bc](https://github.com/JanSzewczyk/szumrak/commit/92a46bc42f616f5ef40bb9348b17f7fed09e1cf4))

## [1.1.2](https://github.com/JanSzewczyk/szumrak/compare/v1.1.1...v1.1.2) (2026-07-13)

### Bug Fixes

* simplify branch name generation by removing prefix for commits without metadata ([f8405f4](https://github.com/JanSzewczyk/szumrak/commit/f8405f4a85acc2da94939b5ace0157b958132e1f))

## [1.1.1](https://github.com/JanSzewczyk/szumrak/compare/v1.1.0...v1.1.1) (2026-07-13)

### Bug Fixes

* tolerate the model collapsing type/subject into one commit-block line ([3663b95](https://github.com/JanSzewczyk/szumrak/commit/3663b952d31978d0513b94121f60d70a4ef96cc4))

## [1.1.0](https://github.com/JanSzewczyk/szumrak/compare/v1.0.3...v1.1.0) (2026-07-13)

### Features

* derive branch names and commit messages from the agent's own changes ([43494c3](https://github.com/JanSzewczyk/szumrak/commit/43494c3aa237d8f71972b4ea8b0eee88211c9658))

## [1.0.3](https://github.com/JanSzewczyk/szumrak/compare/v1.0.2...v1.0.3) (2026-07-13)

### Bug Fixes

* authenticate git push with an explicit token-embedded remote URL ([204dd46](https://github.com/JanSzewczyk/szumrak/commit/204dd465e3b2ebccc329d7447de2866d249ea862))

## [1.0.2](https://github.com/JanSzewczyk/szumrak/compare/v1.0.1...v1.0.2) (2026-07-13)

### Bug Fixes

* configure a git bot identity in the agent image ([4061ee0](https://github.com/JanSzewczyk/szumrak/commit/4061ee0fd9d93748d0a08b756d45b8d433ce5c4e))

## [1.0.1](https://github.com/JanSzewczyk/szumrak/compare/v1.0.0...v1.0.1) (2026-07-13)

### Bug Fixes

* update type annotations to use ReadonlyArray and Array for consistency ([83e1b1d](https://github.com/JanSzewczyk/szumrak/commit/83e1b1d536efc92f5398e351e8ba211f7882bcf4))

## 1.0.0 (2026-07-13)

### Features

* add AGENT_MODEL configuration to .env.example and update README.md ([073623c](https://github.com/JanSzewczyk/szumrak/commit/073623c01d635c64230b4a87765fb9625f0cb379))
* add Biome configuration and update project structure for TypeScript execution ([b936363](https://github.com/JanSzewczyk/szumrak/commit/b9363636f061838b1c32bed60df510f116c49c10))
* add example environment variables for Szumrak configuration ([cf842c7](https://github.com/JanSzewczyk/szumrak/commit/cf842c7af6dd3cc1cac4dde503930efeeb7f2afd))
* **init:** standardize import paths and update README for run-agent ([0412e4d](https://github.com/JanSzewczyk/szumrak/commit/0412e4d8bd883a2852d58a905c23c46a8109c47d))
* read TARGET_REPO_PATH from validated env instead of a shell export ([8b5e516](https://github.com/JanSzewczyk/szumrak/commit/8b5e516737c3298b2da59bc26cf4e71102e2c483))
* refactor configuration management to use env-driven setup and improve validation ([4bb73a9](https://github.com/JanSzewczyk/szumrak/commit/4bb73a95783a131ff12ccbb4c9e153f326a1c2bd))
* rename settings.json to agent-permissions.json and implement permissions loading in run-agent ([5c9a8a7](https://github.com/JanSzewczyk/szumrak/commit/5c9a8a7406626ba1b251ed070599ed9e23f4d5be))
* szkielet silnika Szumraka (Faza 0-1-2-4 planu wdrożenia) ([a339365](https://github.com/JanSzewczyk/szumrak/commit/a339365328a60665537c43a3560198b0dabb0f43))
* update biome configuration and improve project structure for TypeScript compatibility ([c1279a6](https://github.com/JanSzewczyk/szumrak/commit/c1279a6196f3e567250e3eff97b44791a21626b4))
* update CLAUDE.md to clarify command descriptions and build process ([0c5f99a](https://github.com/JanSzewczyk/szumrak/commit/0c5f99a1a9156c5944632f583b28e98910211a8f))
* update linter configuration to use preset for recommended rules ([634bd09](https://github.com/JanSzewczyk/szumrak/commit/634bd0927c94b53dd16c88e8ad8081e1b96ef799))
* update Node.js version to 24 in Dockerfile and README.md, enhance logging in run-agent.ts ([38ed9f9](https://github.com/JanSzewczyk/szumrak/commit/38ed9f9c68b54012f05d81282bf6556a86a0d49d))

### Bug Fixes

* configure Git to trust mounted directories and load CLAUDE.md in run-agent ([4739878](https://github.com/JanSzewczyk/szumrak/commit/4739878de07f999c3694da7761a295b41c4142fb))
* make dev:run cross-platform by replacing shell $VAR expansion ([23bb70e](https://github.com/JanSzewczyk/szumrak/commit/23bb70ea8b5abdedb13d646ae7ebc481d6ccbca7))

### Documentation

* update README.md to clarify build process and CI workflow requirements ([61cdc20](https://github.com/JanSzewczyk/szumrak/commit/61cdc20fc835e2a24eeb7cc470b2a9f98575fd7c))
* update README.md to enhance project description and clarify usage instructions ([2347fc9](https://github.com/JanSzewczyk/szumrak/commit/2347fc969d54b99c7753abb5bfa0230716f72d13))

### Code Refactoring

* English-only codebase, drop skills layer, harden git flow ([ea2fd9b](https://github.com/JanSzewczyk/szumrak/commit/ea2fd9b27202122d6a3683677a60339013932f96))

### Tests

* add unit tests for commitAndOpenPR and runAgent functions ([ef5f429](https://github.com/JanSzewczyk/szumrak/commit/ef5f429537a3082ab458b20f68cb02b9427b459b))
* add Vitest configuration for testing and update .gitignore to include coverage ([17ffbf3](https://github.com/JanSzewczyk/szumrak/commit/17ffbf372e1c01df3914c5e43b9b7ba5b712f80d))
* enhance environment validation and add Vitest configuration for testing ([7d611a9](https://github.com/JanSzewczyk/szumrak/commit/7d611a960b8a945b0af92a8ac0c7c2aee3248ca6))

### Build System

* **deps:** bump actions/checkout in the github-dependencies group ([49fb869](https://github.com/JanSzewczyk/szumrak/commit/49fb86913b4759eb83f39b88eb7166e79c924dd9))

### Continuous Integration

* add GitHub Actions workflows for CodeQL analysis, dependency review, and release process ([628598f](https://github.com/JanSzewczyk/szumrak/commit/628598f965e60e85c71d22cd9aae34f815ac390e))
* add release configuration and enable semantic-release in CI ([cdfe586](https://github.com/JanSzewczyk/szumrak/commit/cdfe5867bf115712d5e1b6c11fc9a9cfb54ed1fe))
