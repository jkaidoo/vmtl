import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaManager } from './PwaManager'
import * as pwa from '../lib/pwa'

// Drive the component through the pwa lib boundary: registerServiceWorker's
// callback is what surfaces (or withholds) the "new version" prompt.
vi.mock('../lib/pwa', () => ({
  registerServiceWorker: vi.fn(),
  applyUpdate: vi.fn(),
  syncExistingSubscription: vi.fn(),
}))

const mocked = vi.mocked(pwa)

afterEach(() => {
  vi.clearAllMocks()
})

describe('PwaManager', () => {
  it('renders nothing while no update is waiting', () => {
    mocked.registerServiceWorker.mockImplementation(() => {})
    const { container } = render(<PwaManager />)
    expect(container).toBeEmptyDOMElement()
    expect(mocked.syncExistingSubscription).toHaveBeenCalledOnce()
  })

  it('shows the refresh prompt when a worker is waiting', () => {
    const worker = {} as ServiceWorker
    mocked.registerServiceWorker.mockImplementation((onUpdate) => onUpdate(worker))
    render(<PwaManager />)
    expect(screen.getByText(/new version is available/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('applies the update when Refresh is clicked', async () => {
    const worker = {} as ServiceWorker
    mocked.registerServiceWorker.mockImplementation((onUpdate) => onUpdate(worker))
    render(<PwaManager />)

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(mocked.applyUpdate).toHaveBeenCalledWith(worker)
  })
})
