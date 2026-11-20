import type {
  ProofWorkerConcurrencyAdmission,
  ProofWorkerMessage,
  ProofWorkerResourceAdmissionDecision,
  ProofWorkerResponse,
  ProofWorkerThreadAdmission,
  WorkerStatus,
} from './proof.worker.types';
import { ProofWorkerLogger } from './proof-worker-logger';
import { validateCSPPolicy, isOriginAllowed, createCSPHeaders } from './csp-policy';
import {
  evaluateProofWorkerMemoryAdmission,
  type ProofWorkerMemoryUsage,
} from '../proofWorkerMemory';

const logger = new ProofWorkerLogger({ enabled: true });
const MAX_WASM_THREADS = 8;
const DEFAULT_MAX_CONCURRENT_PROOFS = 1;

export interface ProofWorkerResourceAdmissionInput {
  usage?: ProofWorkerMemoryUsage;
  deviceMemoryGB?: number | null;
  crossOriginIsolated?: boolean;
  hardwareConcurrency?: number;
  activeProofs?: number;
  maxConcurrentProofs?: number;
}

export class ProofWorkerManager {
  private worker: Worker | null = null;
  private cspConfig: ReturnType<typeof validateCSPPolicy>;
  private messageHandlers: Map<string, (response: ProofWorkerResponse) => void> = new Map();
  private isInitialized = false;

  constructor(config?: Partial<ReturnType<typeof validateCSPPolicy>>) {
    this.cspConfig = validateCSPPolicy(config || {});
  }

  async init(origin?: string): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Worker already initialized');
      return;
    }

    if (origin && !isOriginAllowed(origin, this.cspConfig)) {
      throw new Error(`Origin not allowed: ${origin}`);
    }

    try {
      // In a real implementation, this would load the worker from a URL
      // For now, we simulate the initialization
      this.isInitialized = true;
      logger.info('Worker manager initialized', { cspConfig: this.cspConfig });
    } catch (error) {
      logger.error('Failed to initialize worker manager', { error });
      throw error;
    }
  }

  async verifyProof(
    evidence: string,
    proof: string,
    contract: string,
    timeout?: number
  ): Promise<ProofWorkerResponse> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error('Verification timed out'));
      }, timeout || this.cspConfig.maxExecutionTimeMs);

      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeoutId);
        this.messageHandlers.delete(messageId);
        resolve(response);
      });

      const message: ProofWorkerMessage = {
        type: 'verify',
        payload: {
          evidence,
          proof,
          contract,
          timeout,
        },
        id: messageId,
      };

      logger.info('Sending verify message', { id: messageId });
      // In a real implementation, this would post to the actual worker
      // this.worker?.postMessage(message);
    });
  }

  async cancelProof(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const messageId = `cancel_${Date.now()}`;

    const message: ProofWorkerMessage = {
      type: 'cancel',
      id: messageId,
    };

    logger.info('Sending cancel message', { id: messageId });
    // In a real implementation, this would post to the actual worker
    // this.worker?.postMessage(message);
  }

  getStatus(): WorkerStatus {
    return {
      isRunning: false, // In a real implementation, this would check the actual worker state
      currentTaskId: undefined,
      memoryUsage: undefined,
    };
  }

  getCSPHeaders(): Record<string, string> {
    return createCSPHeaders(this.cspConfig);
  }

  getResourceAdmission(
    input: ProofWorkerResourceAdmissionInput = {},
  ): ProofWorkerResourceAdmissionDecision {
    const detectedDeviceMemory =
      typeof navigator !== 'undefined' && 'deviceMemory' in navigator
        ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
        : null;
    const deviceMemoryGB =
      input.deviceMemoryGB !== undefined ? input.deviceMemoryGB : detectedDeviceMemory;

    const memory = evaluateProofWorkerMemoryAdmission({
      usage: input.usage,
      maxMemoryMB: this.cspConfig.maxMemoryMB,
      deviceMemoryGB,
    });

    const crossOriginIsolated =
      input.crossOriginIsolated !== undefined
        ? input.crossOriginIsolated
        : typeof self !== 'undefined' && typeof self.crossOriginIsolated === 'boolean'
          ? self.crossOriginIsolated
          : false;

    const rawHardwareConcurrency =
      input.hardwareConcurrency !== undefined
        ? input.hardwareConcurrency
        : typeof navigator !== 'undefined'
          ? navigator.hardwareConcurrency
          : 0;
    const hardwareConcurrency =
      Number.isFinite(rawHardwareConcurrency) && rawHardwareConcurrency > 0
        ? Math.floor(rawHardwareConcurrency)
        : 0;

    let threads: ProofWorkerThreadAdmission;
    if (!crossOriginIsolated) {
      threads = {
        allocated: 1,
        maxAllowed: MAX_WASM_THREADS,
        crossOriginIsolated: false,
        hardwareConcurrency,
        fallbackToSingleThread: true,
        reason: 'not_cross_origin_isolated',
        explanation:
          'Cross-origin isolation is unavailable (no SharedArrayBuffer); falling back to 1 thread.',
      };
    } else if (memory.constrained) {
      threads = {
        allocated: 1,
        maxAllowed: MAX_WASM_THREADS,
        crossOriginIsolated: true,
        hardwareConcurrency,
        fallbackToSingleThread: true,
        reason: 'constrained_device_memory',
        explanation:
          'Constrained device memory detected; capping proving to 1 thread to prevent out-of-memory failures.',
      };
    } else if (hardwareConcurrency <= 1) {
      threads = {
        allocated: 1,
        maxAllowed: MAX_WASM_THREADS,
        crossOriginIsolated: true,
        hardwareConcurrency,
        fallbackToSingleThread: true,
        reason: 'single_core_hardware',
        explanation:
          'Browser reports 1 or fewer hardware threads; running in 1-thread fallback mode.',
      };
    } else {
      const allocated = Math.max(1, Math.min(hardwareConcurrency, MAX_WASM_THREADS));
      const clamped = hardwareConcurrency > MAX_WASM_THREADS;
      threads = {
        allocated,
        maxAllowed: MAX_WASM_THREADS,
        crossOriginIsolated: true,
        hardwareConcurrency,
        fallbackToSingleThread: false,
        reason: clamped ? 'multi_threaded_clamped' : 'multi_threaded_isolated',
        explanation: clamped
          ? `Multi-threaded proving admitted with ${allocated} threads (clamped from ${hardwareConcurrency} to max ${MAX_WASM_THREADS}).`
          : `Multi-threaded proving admitted with ${allocated} threads.`,
      };
    }

    const maxConcurrentProofs =
      input.maxConcurrentProofs !== undefined
        ? Number.isInteger(input.maxConcurrentProofs) && input.maxConcurrentProofs >= 1
          ? input.maxConcurrentProofs
          : 0
        : DEFAULT_MAX_CONCURRENT_PROOFS;
    const activeProofs =
      input.activeProofs !== undefined ? Math.max(0, Math.floor(input.activeProofs)) : this.messageHandlers.size;
    const concurrencyAllowed = maxConcurrentProofs >= 1 && activeProofs < maxConcurrentProofs;
    const concurrency: ProofWorkerConcurrencyAdmission = {
      allowed: concurrencyAllowed,
      activeProofs,
      maxConcurrentProofs,
      reason: concurrencyAllowed ? 'within_concurrency_limit' : 'concurrency_limit_reached',
      explanation: concurrencyAllowed
        ? `Concurrency within limit (${activeProofs}/${maxConcurrentProofs} active proofs).`
        : `Concurrency limit reached (${activeProofs}/${maxConcurrentProofs} active proofs); wait for the active proof to finish.`,
    };

    const admitted = memory.allowed && concurrency.allowed;
    const executionMode = !admitted
      ? 'rejected'
      : threads.fallbackToSingleThread
        ? 'single-threaded-fallback'
        : 'multi-threaded';
    const fallbackApplied = admitted && threads.fallbackToSingleThread;
    const reasons = [memory.reason, threads.reason, concurrency.reason];
    const summary = `${memory.explanation} ${threads.explanation} ${concurrency.explanation}`;

    return {
      admitted,
      executionMode,
      fallbackApplied,
      reasons,
      summary,
      memory,
      threads,
      concurrency,
    };
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.messageHandlers.clear();
    this.isInitialized = false;
    logger.info('Worker manager destroyed');
  }
}