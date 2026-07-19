// Global vitest setup. Registers the jest-dom matchers (toBeInTheDocument,
// toBeDisabled, …) so component tests can assert against the rendered DOM.
//
// This file runs for EVERY test file, including the node-environment route
// tests. Importing the matcher pack is safe there — it only calls
// expect.extend and never touches `document`. Testing Library's automatic
// cleanup registers itself through vitest's global afterEach, so component
// tests do not need to unmount by hand.
import '@testing-library/jest-dom/vitest';
