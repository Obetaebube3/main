/**
 * verificationFlow — orchestrates the verification portal flow.
 *
 * Responsibility: combine the Flask extraction, NeonDB lookup, and the
 * Soroban on-chain registry into a single result. No React state.
 */

import type { ChainProofRecord } from '../stellarTypes'
import type { ProofEvent } from '../types'
import { assertValidVideoHash } from './videoHash'
import {
  extractMetadata,
  fetchProofEventsByVideo,
  getOnChainProof,
} from './verificationService'

export type VerificationResult = {
  videoHash: string
  hasHarpocratesMetadata: boolean
  events: ProofEvent[]
  onChain: ChainProofRecord | null
  /** Request revision that produced this result, when bound by the caller. */
  revision?: number
}

export type VerificationFlowOptions = {
  signal?: AbortSignal
  sourceAddress?: string
  /** Monotonically increasing request revision used to discard stale results. */
  revision?: number
}

export type VerificationRevisionGuard = {
  /** Advance and return a new monotonically increasing request revision. */
  next: () => number
  /** Return the currently active request revision. */
  current: () => number
  /** Return true only when `revision` still matches the active request revision. */
  isCurrent: (revision: number) => boolean
}

/**
 * Create a lightweight monotonic revision guard for binding asynchronous
 * verification results to the latest evidence selection.
 */
export function createVerificationRevisionGuard(): VerificationRevisionGuard {
  let revision = 0
  return {
    next: () => {
      revision += 1
      return revision
    },
    current: () => revision,
    isCurrent: (candidate: number) => candidate === revision,
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/**
 * Run the verification flow for an already-computed video hash.
 *
 * The hash is validated before any network call is made so a malformed value
 * (from a share link or manifest) cannot inject path segments or query strings.
 */
export async function runVerificationFlow(
  videoHash: string,
  options: VerificationFlowOptions = {},
): Promise<VerificationResult> {
  const safeHash = assertValidVideoHash(videoHash)
  throwIfAborted(options.signal)

  const events = await fetchProofEventsByVideo(safeHash, options.signal)
  throwIfAborted(options.signal)

  const onChain = await getOnChainProof(safeHash, options.sourceAddress)
  throwIfAborted(options.signal)

  return {
    videoHash: safeHash,
    hasHarpocratesMetadata: events.length > 0,
    events,
    onChain,
    ...(options.revision !== undefined ? { revision: options.revision } : {}),
  }
}

/**
 * Convenience helper: extract metadata from an uploaded file and then run the
 * verification flow for the supplied video hash.
 */
export async function verifyUploadedVideo(
  file: File,
  videoHash: string,
  options: VerificationFlowOptions = {},
): Promise<VerificationResult> {
  // Validate before hitting the network at all.
  const safeHash = assertValidVideoHash(videoHash)
  throwIfAborted(options.signal)
  const extract = await extractMetadata(file, options.signal)
  throwIfAborted(options.signal)
  const result = await runVerificationFlow(safeHash, options)
  return { ...result, hasHarpocratesMetadata: extract.hasHarpocratesMetadata }
}
