import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [caseInput, setCaseInput] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'error'|'warn'|'ok', text }
  const inputRef = useRef(null)
  const autoSubmitTimer = useRef(null)

  // Keep the input focused so a barcode scanner (which just types, no tapping needed) always lands here
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Mobile camera-scanner apps (and the on-screen keyboard closing after a scan) tend to steal
  // focus away from the page. Whenever that happens, grab it back automatically so the
  // supervisor never has to tap the field again between scans.
  useEffect(() => {
    function refocus() {
      if (loading) return
      // Don't steal focus from other inputs/buttons the user is actually using (e.g. typing a
      // confirm() dialog isn't covered by this, but remove/clear buttons are real clicks)
      const active = document.activeElement
      const isOtherInteractive =
        active && active !== document.body && active !== inputRef.current && active.tagName !== 'INPUT'
      if (isOtherInteractive) return
      inputRef.current?.focus()
    }

    // Coming back to the tab/app after a camera scan
    document.addEventListener('visibilitychange', refocus)
    window.addEventListener('focus', refocus)
    // Tapping anywhere on the page (in case the keyboard closed) brings focus back
    document.addEventListener('click', refocus)

    const interval = setInterval(refocus, 800)

    return () => {
      document.removeEventListener('visibilitychange', refocus)
      window.removeEventListener('focus', refocus)
      document.removeEventListener('click', refocus)
      clearInterval(interval)
    }
  }, [loading])

  // Auto-submit: most scanners fire a burst of keystrokes very fast, then stop.
  // We watch for that pause and submit automatically — no Enter key, no tapping "Add" needed.
  // If the scanner DOES send Enter, handleScan fires immediately via onKeyDown instead.
  useEffect(() => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
    if (!caseInput.trim() || loading) return

    autoSubmitTimer.current = setTimeout(() => {
      handleScan()
    }, 350)

    return () => clearTimeout(autoSubmitTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseInput, loading])

  // Load today's already-scanned cases on mount, so a page refresh doesn't lose the shift's data
  useEffect(() => {
    loadTodaysLog()
  }, [])

  async function loadTodaysLog() {
    const { data, error } = await supabase
      .from('supervisor_scan_log')
      .select('*')
      .eq('shift_date', todayStr())
      .order('created_at', { ascending: true })

    if (!error && data) {
      setRows(
        data.map((r) => ({
          id: r.id,
          caseNumber: r.case_number,
          panNumber: r.pan_number,
          account: r.account,
          productType: r.product_type,
          units: Number(r.units) || 0,
          price: Number(r.price) || 0,
        }))
      )
    }
  }

  async function handleScan(e) {
    if (e && e.preventDefault) e.preventDefault()
    const caseNumber = caseInput.trim()
    if (!caseNumber || loading) return
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)

    if (rows.some((r) => r.caseNumber.toLowerCase() === caseNumber.toLowerCase())) {
      setMessage({ type: 'warn', text: `Case ${caseNumber} is already on the list.` })
      setCaseInput('')
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      // 1. Pull the case header (pan number, account number, primary product, business unit)
      const { data: caseRows, error: caseErr } = await supabase
        .from('Cases')
        .select(
          '"Case Number","Pan Number","Account Number","Primary Product","Primary Product Number","Business Unit"'
        )
        .eq('Case Number', caseNumber)
        .limit(1)

      if (caseErr) throw caseErr
      if (!caseRows || caseRows.length === 0) {
        setMessage({ type: 'error', text: `Case ${caseNumber} was not found in Cases.` })
        setLoading(false)
        return
      }
      const c = caseRows[0]

      // 2. Pull line items. A case has several lines (shipping, fees, workflow stages, the
      // actual arch product) — only the line matching the case's Primary Product Number is
      // the real arch/unit count. Price is the total revenue across all billed lines.
      const { data: lineItems, error: liErr } = await supabase
        .from('Line Items')
        .select('"Product","Product Number","Units","Price Net"')
        .eq('Case Number', caseNumber)

      if (liErr) throw liErr

      const items = lineItems || []
      const primaryNumber = c['Primary Product Number']
      let primaryLine = items.find((li) => li['Product Number'] === primaryNumber)
      if (!primaryLine) {
        // Fallback: the line with the highest Units is almost always the actual arch product
        // (fees/shipping/workflow lines are typically 1, the arch product carries the real count)
        primaryLine = items.reduce(
          (best, li) => ((Number(li.Units) || 0) > (Number(best?.Units) || 0) ? li : best),
          null
        )
      }

      const units = primaryLine ? Number(primaryLine.Units) || 0 : 0
      const price = items.reduce((sum, li) => sum + (Number(li['Price Net']) || 0), 0)
      const productType = primaryLine?.Product || c['Primary Product'] || ''

      // 3. Pull the account / practice name
      let account = c['Account Number'] || ''
      if (c['Account Number']) {
        const { data: acctRows } = await supabase
          .from('Accounts')
          .select('"Practice Name"')
          .eq('Account Number', c['Account Number'])
          .limit(1)
        if (acctRows && acctRows.length > 0 && acctRows[0]['Practice Name']) {
          account = acctRows[0]['Practice Name']
        }
      }

      const newRow = {
        caseNumber,
        panNumber: c['Pan Number'] || '',
        account,
        productType,
        units,
        price,
      }

      setRows((prev) => [...prev, newRow])
      setMessage({ type: 'ok', text: `Added ${caseNumber}.` })

      // 4. Log it to Supabase so it survives a refresh / can be reviewed later
      supabase
        .from('supervisor_scan_log')
        .insert({
          case_number: caseNumber,
          pan_number: newRow.panNumber,
          account: newRow.account,
          product_type: newRow.productType,
          units: newRow.units,
          price: newRow.price,
          business_unit: c['Business Unit'] || null,
          shift_date: todayStr(),
        })
        .then(({ error }) => {
          if (error) console.error('Failed to log scan:', error)
        })
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: `Lookup failed: ${err.message}` })
    } finally {
      setLoading(false)
      setCaseInput('')
      inputRef.current?.focus()
    }
  }

  function removeRow(caseNumber) {
    setRows((prev) => prev.filter((r) => r.caseNumber !== caseNumber))
  }

  function clearSession() {
    if (!window.confirm('Clear all rows from this view? (The log in Supabase is kept.)')) return
    setRows([])
  }

  function exportToExcel() {
    const sheetData = rows.map((r) => ({
      'Case Number': r.caseNumber,
      'Pan Number': r.panNumber,
      Account: r.account,
      'Product Type': r.productType,
      Units: r.units,
      Price: r.price,
    }))
    sheetData.push({
      'Case Number': '',
      'Pan Number': '',
      Account: '',
      'Product Type': 'TOTAL',
      Units: totalUnits,
      Price: totalPrice,
    })

    const ws = XLSX.utils.json_to_sheet(sheetData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Case Log')
    XLSX.writeFile(wb, `case-scan-log-${todayStr()}.xlsx`)
  }

  const totalUnits = rows.reduce((s, r) => s + (r.units || 0), 0)
  const totalPrice = rows.reduce((s, r) => s + (r.price || 0), 0)

  return (
    <div className="page">
      <h1>Case Scan Log</h1>

      <form onSubmit={handleScan} className="scan-form">
        <input
          ref={inputRef}
          type="text"
          value={caseInput}
          onChange={(e) => setCaseInput(e.target.value)}
          placeholder="Scan case number — adds automatically"
          autoFocus
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Looking up...' : 'Add'}
        </button>
      </form>
      <p className="hint">Just scan — each case adds itself once scanning pauses. The "Add" button is only a manual fallback.</p>

      {message && <div className={`msg msg-${message.type}`}>{message.text}</div>}

      <div className="toolbar">
        <span>{rows.length} case(s) today</span>
        <div>
          <button onClick={exportToExcel} disabled={rows.length === 0}>
            Download Excel
          </button>
          <button onClick={clearSession} className="secondary">
            Clear view
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Case Number</th>
            <th>Pan Number</th>
            <th>Account</th>
            <th>Product Type</th>
            <th>Units</th>
            <th>Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.caseNumber}>
              <td>{r.caseNumber}</td>
              <td>{r.panNumber}</td>
              <td>{r.account}</td>
              <td>{r.productType}</td>
              <td>{r.units}</td>
              <td>${fmtMoney(r.price)}</td>
              <td>
                <button className="link" onClick={() => removeRow(r.caseNumber)}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>TOTAL</td>
            <td>{totalUnits}</td>
            <td>${fmtMoney(totalPrice)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
