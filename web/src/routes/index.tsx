import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { type Bill, createSampleHome, getBills, payShare, type Share } from '../api'

export const Route = createFileRoute('/')({
  // The home to show comes from the URL: /?homeId=...
  validateSearch: (search: Record<string, unknown>): { homeId?: string } => ({
    homeId: typeof search.homeId === 'string' && search.homeId !== '' ? search.homeId : undefined,
  }),
  component: Page,
})

// Amounts are in paise (100 paise = 1 rupee), shown as rupees with Indian commas: ₹1,00,000.00.
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

function formatCents(cents: number) {
  return rupees.format(cents / 100)
}

function Page() {
  const { homeId } = Route.useSearch()
  const navigate = useNavigate()
  // Changing the key remounts <Bills>, which loads the data again.
  const [attempt, setAttempt] = useState(0)

  return (
    <main>
      <h1>Bill Splitter</h1>
      {homeId ? (
        <>
          <button type="button" className="link" onClick={() => navigate({ to: '/', search: {} })}>
            ← Choose another home
          </button>
          <Bills
            key={`${homeId}-${attempt}`}
            homeId={homeId}
            onRetry={() => setAttempt(attempt + 1)}
          />
        </>
      ) : (
        <ChooseHome onChoose={(id) => navigate({ to: '/', search: { homeId: id } })} />
      )}
    </main>
  )
}

function ChooseHome({ onChoose }: { onChoose: (homeId: string) => void }) {
  const [homeId, setHomeId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (homeId.trim()) onChoose(homeId.trim())
  }

  async function handleCreateSample() {
    setCreating(true)
    setError(null)
    const result = await createSampleHome()
    setCreating(false)
    if (result.ok) onChoose(result.data)
    else setError(result.error)
  }

  return (
    <section className="card">
      <form onSubmit={handleSubmit}>
        <label htmlFor="home-id">Home ID</label>
        <div className="row">
          <input id="home-id" value={homeId} onChange={(e) => setHomeId(e.target.value)} />
          <button type="submit">Open</button>
        </div>
      </form>
      <p className="muted">or</p>
      <button type="button" onClick={handleCreateSample} disabled={creating}>
        {creating ? 'Creating…' : 'Create a sample home'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bills: Bill[] }

function Bills({ homeId, onRetry }: { homeId: string; onRetry: () => void }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    // Ignore the answer if the component is gone (or the home changed) before it arrives.
    let active = true
    getBills(homeId).then((result) => {
      if (!active) return
      setState(
        result.ok
          ? { status: 'ready', bills: result.data.bills }
          : { status: 'error', message: result.error },
      )
    })
    return () => {
      active = false
    }
  }, [homeId])

  // Only the share the server confirmed as paid changes.
  function markPaid(billId: string, paid: Pick<Share, 'id' | 'paidAt'>) {
    setState((current) => {
      if (current.status !== 'ready') return current
      const bills = current.bills.map((bill) =>
        bill.id !== billId
          ? bill
          : {
              ...bill,
              shares: bill.shares.map((share) =>
                share.id === paid.id ? { ...share, paidAt: paid.paidAt } : share,
              ),
            },
      )
      return { status: 'ready', bills }
    })
  }

  if (state.status === 'loading') {
    return (
      <p className="muted" role="status">
        Loading bills…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="card">
        <p className="error" role="alert">
          Could not load the bills: {state.message}
        </p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }

  if (state.bills.length === 0) return <p className="muted">This home has no bills yet.</p>

  return (
    <>
      {state.bills.map((bill) => (
        <section key={bill.id} className="card">
          <div className="bill-header">
            <h2>{bill.title}</h2>
            <span className="amount">{formatCents(bill.totalCents)}</span>
          </div>
          <p className="muted progress">
            {bill.shares.filter((share) => share.paidAt !== null).length} of {bill.shares.length}{' '}
            paid
          </p>
          <ul>
            {bill.shares.map((share) => (
              <ShareItem
                key={share.id}
                billId={bill.id}
                share={share}
                onPaid={(paid) => markPaid(bill.id, paid)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function ShareItem({
  billId,
  share,
  onPaid,
}: {
  billId: string
  share: Share
  onPaid: (paid: Pick<Share, 'id' | 'paidAt'>) => void
}) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per share, reused when the user retries. If the first request
  // reached the server but the answer was lost, the retry cannot pay twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function handlePay() {
    setPaying(true)
    setError(null)
    const result = await payShare(billId, share.id, idempotencyKey)
    setPaying(false)
    if (result.ok) onPaid(result.data)
    else setError(result.error)
  }

  return (
    <li className={share.paidAt ? 'paid-row' : undefined}>
      <div className="row">
        <span>{share.memberName}</span>
        <span className="amount">{formatCents(share.amountCents)}</span>
        {share.paidAt ? (
          <span className="paid">Paid</span>
        ) : (
          <button type="button" onClick={handlePay} disabled={paying}>
            {paying ? 'Paying…' : 'Pay'}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          Payment failed: {error}
        </p>
      )}
    </li>
  )
}
