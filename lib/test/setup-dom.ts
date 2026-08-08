// Global vitest setup. Registers the jest-dom matchers (toBeInTheDocument,
// toBeDisabled, …) so component tests can assert against the rendered DOM.
//
// This file runs for EVERY test file, including the node-environment route
// tests. Importing the matcher pack is safe there — it only calls
// expect.extend and never touches `document`. Testing Library's automatic
// cleanup registers itself through vitest's global afterEach, so component
// tests do not need to unmount by hand.
import '@testing-library/jest-dom/vitest';

// jsdom implements neither object-URL function. Anything rendering a preview of
// a file the customer just picked needs both — createObjectURL to show it, and
// revokeObjectURL to release the blob when the list changes — and a component
// that leaked its URLs would pass a suite that only stubbed the first.
//
// Stubbed here rather than per test file: this is a gap in the environment, not
// a fact about any one component. Harmless in the node-environment route tests,
// which never touch it.
if (typeof URL.createObjectURL !== 'function') {
  let n = 0;
  URL.createObjectURL = () => `blob:test-${++n}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}
