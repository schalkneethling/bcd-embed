# Contributing to bcd-embed

Thank you for helping improve bcd-embed. Install the package manager version
declared in `package.json`, run `pnpm install`, and run `pnpm check` before
submitting a pull request.

## Normalization code and licensing

The normalization logic in `@bcd-embed/core` must be independently implemented
from the published `@mdn/browser-compat-data` data, types, and schema. Those are
the defining sources for accepted input and are available under CC0-1.0.

Do not copy or adapt implementation code from MDN Fred. Fred is MPL-2.0
licensed, while this repository is MIT licensed. Documentation may describe
observable behavior and tests may encode expected results, but contributions
must not introduce Fred source code or close translations of it.

When adding a transform, cite the BCD field or type that defines its input in
the pull request and add a focused failing test before the implementation.
