# Vendored frontend dependencies

## source-map-js 1.2.2

- Source: <https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2>
- Security fix: <https://github.com/7rulnik/source-map-js/commit/cf7658058ceeaa8619d5ae0ec90be6905209d016>
- Advisory: <https://github.com/advisories/GHSA-68fv-2mgg-jv7q>
- Archive: `source-map-js-1.2.2.tgz`
- SHA-256: `05c8cf8e7c3a6b56cada7668fe9342b10f4b625efc92aba9ba05b9e8fe4d71a3`
- License: BSD-3-Clause; the upstream `LICENSE` file is included in the archive.

The configured npm proxy did not yet publish `source-map-js@1.2.2`, so the
official upstream release archive is pinned locally through npm `overrides`.
Replace this override with the registry package after the configured registry
publishes the same patched version.
