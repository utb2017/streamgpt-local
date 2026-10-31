# Optional GitHub Actions templates

These templates are inactive in `docs/workflows`. The publishing credential did not have GitHub's `workflow` scope, so automated CI has not been enabled or claimed as passing.

A repository maintainer with the appropriate GitHub permission can copy the YAML files into `.github/workflows/` to enable Windows checks and a manually triggered installer build. The release build uploads an artifact; it does not automatically publish a release.

The initial release was built and checked locally. See [validation](../VALIDATION.md).
