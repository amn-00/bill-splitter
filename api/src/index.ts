import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { shareAmount } from './split'
import { readJson, requirePositiveCents, requireText } from './validate'

type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
}

function toShare(row: ShareRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  }
}

async function requireHome(db: D1Database, homeId: string): Promise<void> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) throw new HTTPException(404, { message: 'Home not found' })
}

const app = new Hono<{ Bindings: Env }>()

// Every error is JSON: { "error": "message" }.
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const name = requireText(await readJson(c), 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const name = requireText(await readJson(c), 'name')
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)

  const id = crypto.randomUUID()
  // Position is computed in the same statement as the insert, so two members
  // added at the same time cannot get the same position.
  await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM members WHERE home_id = ?`,
  )
    .bind(id, homeId, name, homeId)
    .run()
  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const body = await readJson(c)
  const title = requireText(body, 'title')
  const totalCents = requirePositiveCents(body, 'totalCents')
  const homeId = c.req.param('homeId')
  const db = c.env.DB
  await requireHome(db, homeId)

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY position')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) {
    throw new HTTPException(422, { message: 'Home has no members to split the bill between' })
  }

  const billId = crypto.randomUUID()
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: shareAmount(totalCents, members.length, index),
    paidAt: null,
  }))

  // batch() runs as one transaction: we never save a bill without its shares.
  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      db
        .prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) throw new HTTPException(400, { message: 'Idempotency-Key header is required' })
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const db = c.env.DB

  // One atomic statement: it only changes the share if it is still unpaid.
  // If two requests race, the database runs them one after the other, so
  // only the first one finds paid_at IS NULL and gets a row back.
  let paid: ShareRow | null
  try {
    paid = await db
      .prepare(
        `UPDATE shares SET paid_at = ?, idempotency_key = ?
         WHERE id = ? AND bill_id = ? AND paid_at IS NULL
         RETURNING id, member_id, amount_cents, paid_at`,
      )
      .bind(new Date().toISOString(), key, shareId, billId)
      .first<ShareRow>()
  } catch (err) {
    if (err instanceof Error && err.message.includes('shares.idempotency_key')) {
      throw new HTTPException(409, {
        message: 'Idempotency-Key was already used for another share',
      })
    }
    throw err
  }
  if (paid) return c.json(toShare(paid), 200)

  // Nothing changed: the share does not exist on this bill, or it is already paid.
  const share = await db
    .prepare(
      `SELECT id, member_id, amount_cents, paid_at, idempotency_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!share) throw new HTTPException(404, { message: 'Bill or share not found' })

  // Same key again: answer with the saved result, so paidAt does not change.
  if (share.idempotency_key === key) return c.json(toShare(share), 200)
  throw new HTTPException(409, { message: 'Share is already paid' })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)

  // LEFT JOIN keeps members who owe nothing (their sum is NULL, so we use 0).
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.position
     ORDER BY m.position`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances: results }, 200)
})

// Not in the spec, but the web page needs it to show the bills of a home.
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const db = c.env.DB
  await requireHome(db, homeId)

  // Newest bill first (rowid follows the insert order).
  const { results: bills } = await db
    .prepare('SELECT id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid DESC')
    .bind(homeId)
    .all<{ id: string; title: string; total_cents: number }>()

  const { results: shares } = await db
    .prepare(
      `SELECT s.id, s.bill_id, s.member_id, m.name AS member_name, s.amount_cents, s.paid_at
       FROM shares s
       JOIN members m ON m.id = s.member_id
       JOIN bills b ON b.id = s.bill_id
       WHERE b.home_id = ?
       ORDER BY m.position`,
    )
    .bind(homeId)
    .all<ShareRow & { bill_id: string; member_name: string }>()

  return c.json(
    {
      bills: bills.map((bill) => ({
        id: bill.id,
        homeId,
        title: bill.title,
        totalCents: bill.total_cents,
        shares: shares
          .filter((share) => share.bill_id === bill.id)
          .map((share) => ({ ...toShare(share), memberName: share.member_name })),
      })),
    },
    200,
  )
})

export default app
