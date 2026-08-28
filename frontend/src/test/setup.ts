// Vitest global setup: extend `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, …) and clean up the DOM between tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
