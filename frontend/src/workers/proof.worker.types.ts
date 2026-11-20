export interface ProofWorkerMessage {
  type: 'init' | 'verify' | 'cancel' | 'status';
  payload?: {
    evidence?: string;
    proof?: string;
    contract?: string;
    metadata?: Record<string, unknown>;
    timeout?: number;
  };
  id?: string;
}

export interface ProofWorkerResponse {
  type: 'success' | 'error' | 'status';
  id?: string;
  data?: {
    valid?: boolean;
    result?: unknown;
    message?: string;
  };
  error?: {
    code: string;
    message: string;
    privacySafe: boolean;
  };
}

export interface CSPPolicyConfig {
  maxMemoryMB: number;
  maxExecutionTimeMs: number;
  allowedOrigins: string[];
  sandbox: boolean;
}

export interface WorkerStatus {
  isRunning: boolean;
  currentTaskId?: string;
  memoryUsage?: number;
}

export type ProofWorkerExecutionMode =
  | 'multi-threaded'
  | 'single-threaded-fallback'
  | 'rejected';

export type ProofWorkerThreadReason =
  | 'multi_threaded_isolated'
  | 'multi_threaded_clamped'
  | 'not_cross_origin_isolated'
  | 'constrained_device_memory'
  | 'single_core_hardware';

export type ProofWorkerConcurrencyReason =
  | 'within_concurrency_limit'
  | 'concurrency_limit_reached';

export interface ProofWorkerThreadAdmission {
  allocated: number;
  maxAllowed: number;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  fallbackToSingleThread: boolean;
  reason: ProofWorkerThreadReason;
  explanation: string;
}

export interface ProofWorkerConcurrencyAdmission {
  allowed: boolean;
  activeProofs: number;
  maxConcurrentProofs: number;
  reason: ProofWorkerConcurrencyReason;
  explanation: string;
}

export interface ProofWorkerResourceAdmissionDecision {
  admitted: boolean;
  executionMode: ProofWorkerExecutionMode;
  fallbackApplied: boolean;
  reasons: string[];
  summary: string;
  memory: {
    allowed: boolean;
    constrained: boolean;
    reason: string;
    requiredBytes: number;
    limitBytes: number;
    configuredLimitBytes: number | null;
    deviceMemoryGB: number | null;
    explanation: string;
  };
  threads: ProofWorkerThreadAdmission;
  concurrency: ProofWorkerConcurrencyAdmission;
}