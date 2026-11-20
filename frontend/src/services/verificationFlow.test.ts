import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVerificationRevisionGuard,
  runVerificationFlow,
  verifyUploadedVideo,
} from './verificationFlow'

vi.mock('./verificationService', () => ({
  extractMetadata: vi.fn(),
  fetchProofEventsByVideo: vi.fn(),
  getOnChainProof: vi.fn(),
}))

async function getServiceMocks() {
  const mod = await import('./verificationService')
  return mod as unknown as {
    extractMetadata: ReturnType<typeof vi.fn>
    fetchProofEventsByVideo: ReturnType<typeof vi.fn>
    getOnChainProof: ReturnType<typeof vi.fn>
  }
}

const HASH_A = 'a'.repeat(64)

describe('services/verificationFlow', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const mocks = await getServiceMocks()
    mocks.extractMetadata.mockResolvedValue({ hasHarpocratesMetadata: true })
    mocks.fetchProofEventsByVideo.mockResolvedValue([])
    mocks.getOnChainProof.mockResolvedValue(null)
  })

  it('tracks monotonically increasing request revisions', () => {
    const guard = createVerificationRevisionGuard()
    expect(guard.current()).toBe(0)

    const rev1 = guard.next()
    expect(rev1).toBe(1)
    expect(guard.isCurrent(rev1)).toBe(true)

    const rev2 = guard.next()
    expect(rev2).toBe(2)
    expect(guard.isCurrent(rev1)).toBe(false)
    expect(guard.isCurrent(rev2)).toBe(true)
  })

  it('binds the request revision to runVerificationFlow results', async () => {
    const result = await runVerificationFlow(HASH_A, { revision: 3 })
    expect(result.videoHash).toBe(HASH_A)
    expect(result.revision).toBe(3)
  })

  it('aborts runVerificationFlow before on-chain lookup when cancelled mid-flight', async () => {
    const mocks = await getServiceMocks()
    const controller = new AbortController()
    mocks.fetchProofEventsByVideo.mockImplementation(async () => {
      controller.abort()
      return []
    })

    await expect(
      runVerificationFlow(HASH_A, { signal: controller.signal, revision: 1 }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mocks.getOnChainProof).not.toHaveBeenCalled()
  })

  it('aborts verifyUploadedVideo when signal is already aborted', async () => {
    const mocks = await getServiceMocks()
    const controller = new AbortController()
    controller.abort()
    const file = new File(['abc'], 'sample.mp4', { type: 'video/mp4' })

    await expect(
      verifyUploadedVideo(file, HASH_A, { signal: controller.signal, revision: 2 }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mocks.extractMetadata).not.toHaveBeenCalled()
    expect(mocks.fetchProofEventsByVideo).not.toHaveBeenCalled()
  })
})
