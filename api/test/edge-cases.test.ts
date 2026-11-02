import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome, type Share } from './helpers'

async function setup() {
  const { homeId, members } = await createHome(['Asha', 'Ben'])
  const bill = await createBill(homeId, 1000)
  const [first, second] = bill.body.shares
  if (!first || !second) throw new Error('bill has no shares')
  return { homeId, members, billId: bill.body.id, first, second }
}

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

describe('paying at the same time', () => {
  it('lets only one of two different keys pay the same share', async () => {
    const { billId, first } = await setup()

    const results = await Promise.all([
      pay(billId, first.id, crypto.randomUUID()),
      pay(billId, first.id, crypto.randomUUID()),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })

  it('gives the same answer to two requests with the same key', async () => {
    const { billId, first } = await setup()
    const key = crypto.randomUUID()

    const [a, b] = await Promise.all([pay(billId, first.id, key), pay(billId, first.id, key)])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(b.body.paidAt).toBe(a.body.paidAt)
  })
})

describe('payment edge cases', () => {
  it('returns 404 for a real share on the wrong bill', async () => {
    const a = await setup()
    const b = await setup()

    const paid = await pay(b.billId, a.first.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
  })

  it('rejects one key used for two different shares', async () => {
    const { billId, first, second } = await setup()
    const key = crypto.randomUUID()
    await pay(billId, first.id, key)

    const reused = await pay(billId, second.id, key)

    expect(reused.status).toBe(409)
  })

  it('rejects an empty Idempotency-Key', async () => {
    const { billId, first } = await setup()

    const paid = await pay(billId, first.id, '   ')

    expect(paid.status).toBe(400)
  })
})

describe('input checks', () => {
  it('gives 0 cents to the last members when the total is smaller than the members', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 2)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 1, 0])
  })

  it.each([undefined, '', '   ', 42])('rejects the name %j', async (name) => {
    const home = await call('POST', '/api/homes', { body: { name } })

    expect(home.status).toBe(422)
  })

  it('rejects a bill with no title', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body: { totalCents: 100 } })

    expect(bill.status).toBe(422)
  })

  it('answers broken JSON with a JSON error', async () => {
    const response = await exports.default.fetch(
      new Request('http://localhost/api/homes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })

  it('answers an unknown route with a JSON error', async () => {
    const response = await call('GET', '/api/nothing-here')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })
})

describe('list bills (for the web page)', () => {
  it('returns the bills of a home with their shares', async () => {
    const { homeId, billId, first } = await setup()
    await pay(billId, first.id, crypto.randomUUID())

    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(list.status).toBe(200)
    expect(list.body.bills).toHaveLength(1)
    expect(list.body.bills[0]?.shares.map((share) => share.paidAt !== null)).toEqual([true, false])
  })

  it('returns 404 when the home does not exist', async () => {
    const list = await call('GET', '/api/homes/does-not-exist/bills')

    expect(list.status).toBe(404)
  })
})
