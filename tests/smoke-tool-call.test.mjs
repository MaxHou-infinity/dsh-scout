import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { executeSmokeTool, describeSmokeError } from '../scripts/smoke-tool-call.mjs'

// The host receives source text, not imports. Exercise that exact boundary too.
const invoke = runInNewContext(`(${executeSmokeTool.toString()})`)
const describe = runInNewContext(`(${describeSmokeError.toString()})`)
const signal = new AbortController().signal
const args = { text: '中文 "quote"', count: 2 }
const ok = { isError: false, value: args, content: [] }

test('legacy host receives one object-argument call with its original signal', async () => {
  let calls = 0
  const result = await invoke({ execute: async input => {
    calls++
    assert.equal(input.callId, 'id-1')
    assert.equal(input.name, 'scout_start')
    assert.equal(input.arguments, args)
    assert.equal(input.signal, signal)
    assert.equal(input.calls, undefined)
    return ok
  } }, 'id-1', 'scout_start', args, signal)
  assert.equal(result, ok)
  assert.equal(calls, 1)
})

test('batch host receives a raw JSON call and unwraps its correlated result', async () => {
  const tools = { setExecutor() {}, execute: async input => {
    assert.equal(input.calls.length, 1)
    const call = input.calls[0]
    assert.equal(call.type, 'tool-call')
    assert.equal(call.id, 'id-1')
    assert.equal(call.name, 'scout_start')
    assert.deepEqual(JSON.parse(call.arguments), args)
    assert.equal(input.signal, signal)
    return { results: [{ callId: 'id-1', result: ok }] }
  } }
  assert.equal(await invoke(tools, 'id-1', 'scout_start', args, signal), ok)
})

test('batch cardinality, correlation and malformed results fail closed without retry', async () => {
  for (const response of [
    {}, { results: [] },
    { results: [{ callId: 'wrong', result: ok }] },
    { results: [{ callId: 'id-1', result: ok }, { callId: 'id-2', result: ok }] },
    { results: [{ callId: 'id-1', result: {} }] },
  ]) {
    let calls = 0
    await assert.rejects(invoke({ setExecutor() {}, execute: async () => {
      calls++
      return response
    } }, 'id-1', 'scout_start', args, signal), /Smoke/)
    assert.equal(calls, 1)
  }
})

test('tool error results stay errors on both APIs', async () => {
  const errorResult = { isError: true, error: { message: 'schema rejected' } }
  for (const batch of [false, true]) {
    const tools = { execute: async () => batch
      ? { results: [{ callId: 'id-1', result: errorResult }] } : errorResult }
    if (batch) tools.setExecutor = () => {}
    assert.equal(await invoke(tools, 'id-1', 'probe', {}, signal), errorResult)
  }
})

test('infrastructure rejection is never retried or turned into success', async () => {
  for (const batch of [false, true]) {
    let calls = 0
    const failure = new Error('batch aborted')
    const tools = { execute: async () => { calls++; throw failure } }
    if (batch) tools.setExecutor = () => {}
    await assert.rejects(invoke(tools, 'id-1', 'scout_start', args, signal), e => e === failure)
    assert.equal(calls, 1)
  }
})

test('diagnostics bound recursive causes and omit partial tool payloads', () => {
  const error = new Error('outer', { cause: new TypeError('missing calls') })
  error.partial = { results: [{ callId: 'id-1', result: { value: 'private payload' } }] }
  error.cause.cause = error
  const result = describe(error)
  assert.equal(result.cause.message, 'missing calls')
  assert.equal(result.cause.cause.cause, undefined)
  assert.equal(result.partial.callIds[0], 'id-1')
  assert.equal(JSON.stringify(result).includes('private payload'), false)
  assert.equal(describe(new Error('x'.repeat(1000))).message.length, 500)
})
