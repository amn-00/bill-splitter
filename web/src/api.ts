export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

// Every call returns a result instead of throwing, so the page always has
// something to show: the data, or an error message.
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let response: Response
  let body: unknown
  try {
    // Give up after TIMEOUT_MS so a slow server cannot leave the page loading forever.
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    body = await response.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, error: 'The server is taking too long. Please try again.' }
    }
    return { ok: false, error: 'Could not reach the server. Please try again.' }
  }

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : null
    return { ok: false, error: message ?? `Something went wrong (${response.status}).` }
  }
  // The data comes from our own API, which we trust to match these types.
  return { ok: true, data: body as T }
}

export function getBills(homeId: string) {
  return request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`)
}

export function payShare(billId: string, shareId: string, idempotencyKey: string) {
  return request<Omit<Share, 'memberName'>>(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

// Creates a home with members and two bills, so the page has data to show.
export async function createSampleHome(): Promise<Result<string>> {
  const home = await request<{ id: string }>('/api/homes', {
    method: 'POST',
    body: JSON.stringify({ name: 'Flat 4B' }),
  })
  if (!home.ok) return home

  const steps = [
    ...['Asha', 'Ben', 'Chitra'].map((name) => ({ path: 'members', body: { name } })),
    { path: 'bills', body: { title: 'Electricity', totalCents: 1000 } },
    { path: 'bills', body: { title: 'Internet', totalCents: 2999 } },
  ]
  for (const step of steps) {
    const result = await request(`/api/homes/${home.data.id}/${step.path}`, {
      method: 'POST',
      body: JSON.stringify(step.body),
    })
    if (!result.ok) return result
  }
  return { ok: true, data: home.data.id }
}
