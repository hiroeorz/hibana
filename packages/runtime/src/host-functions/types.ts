export type HostGlobals = typeof globalThis & {
  tsCallBinding?: (
    binding: string,
    method: string,
    args: unknown[],
  ) => Promise<unknown>
  tsRunD1Query?: (
    binding: string,
    sql: string,
    bindings: unknown[],
    action: "first" | "all" | "run",
  ) => Promise<string>
  tsHttpFetch?: (payloadJson: string) => Promise<string>
  tsWorkersAiInvoke?: (payloadJson: string) => Promise<string>
  tsVectorizeInvoke?: (payloadJson: string) => Promise<string>
  tsReportRubyError?: (payloadJson: string) => Promise<void>
  tsHtmlRewriterTransform?: (payloadJson: string) => Promise<string>
  tsDurableObjectStorageOp?: (
    stateHandle: string,
    payloadJson: string,
  ) => Promise<string>
  tsDurableObjectAlarmOp?: (
    stateHandle: string,
    payloadJson: string,
  ) => Promise<string>
  tsDurableObjectStubFetch?: (payloadJson: string) => Promise<string>
  tsQueueMessageOp?: (payloadJson: string) => Promise<string>
  tsQueueBatchOp?: (payloadJson: string) => Promise<string>
}

export function assignHostFnOnce<K extends keyof HostGlobals>(
  host: HostGlobals,
  key: K,
  factory: () => NonNullable<HostGlobals[K]>,
): void {
  if (typeof host[key] === "function") {
    return
  }
  host[key] = factory() as HostGlobals[K]
}
