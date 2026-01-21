All notable changes to this project will be documented in this file.

The format is based on [EZEZ Changelog](https://ezez.dev/changelog/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [UNRELEASED]
(nothing yet)

## [0.3.0] - 2026-01-21
### Changed
- added experimental compatibility with servers not following the @ezez/ws-* protocol (basic string/json messages)
### Added
- `onConnect` / `onDisconnect` callbacks
### Dev
- react is no longer a dependency, but a dev dependency like it should

## [0.2.0] - 2025-10-24
### Fixed
- auto reconnect
- broken messages with multi bytes characters
### Dev
- dev deps audit fixes

## [0.1.0] - 2025-05-26
### Added
- first version
