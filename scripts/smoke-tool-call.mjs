/** Standalone helpers also embedded verbatim in the real-host verifier. */
export async function executeSmokeTool(tools, callId, name, args, signal) {
  // setExecutor is the public provider seam in the batch API (0.2.2-alpha.2).
  // Select before dispatch: retrying a failed mutation with another shape is unsafe.
  const batchApi = typeof tools.setExecutor === 'function'
  let result
  if (batchApi) {
    const batch = await tools.execute({
      calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
      signal,
    })
    if (!Array.isArray(batch?.results) || batch.results.length !== 1) {
      throw new Error('Smoke batch must return exactly one result')
    }
    if (batch.results[0]?.callId !== callId) {
      throw new Error('Smoke batch returned a mismatched callId')
    }
    result = batch.results[0].result
  } else {
    result = await tools.execute({ callId, name, arguments: args, signal })
  }
  if (!result || typeof result !== 'object' || typeof result.isError !== 'boolean') {
    throw new Error('Smoke call must return a ToolExecutionResult with boolean isError')
  }
  return result
}

export function describeSmokeError(error, depth = 0) {
  const summary = {
    name: error?.name ?? typeof error,
    message: String(error?.message ?? error).slice(0, 500),
    code: error?.code ?? null,
    violations: Array.isArray(error?.violations) ? error.violations : null,
  }
  if (error?.cause !== undefined && depth < 2) {
    summary.cause = describeSmokeError(error.cause, depth + 1)
  }
  if (Array.isArray(error?.partial?.results)) {
    // Preserve settlement identities, without dumping tool payloads or context.
    summary.partial = { callIds: error.partial.results.map(item => item.callId) }
  }
  return summary
}
