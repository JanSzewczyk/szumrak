<!-- markdownlint-disable --><!-- textlint-disable -->
# 📓 Changelog
All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
