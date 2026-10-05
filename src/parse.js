// Turns raw OCR text from a till slip into structured fields.
//
// OCR output is never clean: "0" and "O" swap, decimal points become commas or vanish, and lines
// get merged. So every field here is found by looking for several clues and keeping the most
// believable answer, and the result says how confident it is.

const MONEY = /(?:R\s?)?(-?\d{1,3}(?:[ ,]\d{3})*|\d+)[.,](\d{2})(?!\d)/g;

const TOTAL_LABELS = [
  /\b(?:amount\s+due|total\s+due|grand\s+total|balance\s+due|to\s?pay)\b/i,
  /\btotal\b(?!\s*(?:items?|qty|savings?|vat|tax|disc))/i,
];
const VAT_LABEL = /\b(?:vat|tax)\b/i;
const SUBTOTAL_LABEL = /\bsub[\s-]?total\b/i;
const CHANGE_LABEL = /\b(?:change|cash\s+tendered|tendered|card|cash)\b/i;
const SKIP_ITEM = /\b(?:total|vat|tax|change|tender|cash|card|balance|savings|rounding|subtotal|sub total|tel|reg no|vat no)\b/i;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Common OCR misreads inside numbers: O for 0, l/I/| for 1, S for 5. Only applied to tokens that are
// already mostly numeric, so words like "SOLD" are left alone.
function fixDigits(line) {
  return line.replace(/(?<![A-Za-z])[\dOoIl|S.,:]+(?![A-Za-z])/g, token =>
    /\d/.test(token) ? token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5') : token);
}

export function amountsIn(line) {
  const out = [];
  for (const m of fixDigits(line).matchAll(MONEY)) {
    out.push(Number(`${m[1].replace(/[ ,]/g, '')}.${m[2]}`));
  }
  return out;
}

function lastAmount(line) {
  const a = amountsIn(line);
  return a.length ? a[a.length - 1] : null;
}

export function findDate(text) {
  text = text.split('\n').map(fixDigits).join('\n');
  const patterns = [
    [/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/, m => [m[1], m[2], m[3]]],         // 2026-10-05
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})(?!\d)/, m => [m[3], m[2], m[1]]],         // 05/10/2026 (day first, SA)
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?!\d)/, m => ['20' + m[3], m[2], m[1]]],    // 05/10/26
    [/\b(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*(20\d{2})\b/, m => [m[3], MONTHS[m[2].toLowerCase()], m[1]]], // 5 Oct 2026
  ];
  for (const [re, pick] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const [y, mo, d] = pick(m).map(Number);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function findMerchant(lines) {
  // First line near the top that looks like a name: mostly letters, not an address or phone number
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && letters / line.length > 0.6 && !/\b(tel|vat|reg|www|street|st\b|road|rd\b|tax invoice)/i.test(line)) {
      return line.replace(/\s{2,}/g, ' ').trim();
    }
  }
  return null;
}

function findItems(lines) {
  const items = [];
  for (const line of lines) {
    if (SKIP_ITEM.test(line)) continue;
    const amounts = amountsIn(line);
    if (!amounts.length) continue;
    const description = fixDigits(line).replace(MONEY, '').replace(/\b\d+\s*[x@]\s*/i, '').replace(/[*#]+/g, '').trim();
    if ((description.match(/[A-Za-z]/g) || []).length < 2) continue;
    const qty = Number((line.match(/\b(\d+)\s*[x@]/i) || [])[1] || 1);
    items.push({ description: description.replace(/\s{2,}/g, ' '), qty, amount: amounts[amounts.length - 1] });
  }
  return items;
}

export function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const notes = [];

  let total = null;
  for (const label of TOTAL_LABELS) {
    // Search from the bottom: the real total is below any subtotal
    for (let i = lines.length - 1; i >= 0 && total === null; i--) {
      if (label.test(lines[i]) && !SUBTOTAL_LABEL.test(lines[i]) && !VAT_LABEL.test(lines[i])) {
        total = lastAmount(lines[i]) ?? (i + 1 < lines.length ? lastAmount(lines[i + 1]) : null);
      }
    }
    if (total !== null) break;
  }

  let vat = null;
  for (const line of lines) {
    if (VAT_LABEL.test(line) && !/vat\s*(no|reg|number)/i.test(line)) {
      const a = amountsIn(line).filter(x => x !== 15);
      if (a.length) vat = a[a.length - 1];
    }
  }

  const subtotalLine = lines.find(l => SUBTOTAL_LABEL.test(l));
  const subtotal = subtotalLine ? lastAmount(subtotalLine) : null;
  const items = findItems(lines.filter(l => !CHANGE_LABEL.test(l)));

  if (total === null) {
    // No label found: the biggest amount on the slip is usually the total
    const all = lines.filter(l => !CHANGE_LABEL.test(l)).flatMap(amountsIn);
    if (all.length) {
      total = Math.max(...all);
      notes.push('total guessed from the largest amount');
    }
  }

  // Cross-checks, used to score confidence
  let confidence = 0;
  if (total !== null) confidence += 0.4;
  const itemSum = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  if (total !== null && Math.abs(itemSum - total) < 0.02) confidence += 0.3;
  else if (items.length && total !== null) {
    const gap = Math.round((total - itemSum) * 100) / 100;
    notes.push(`items add up to ${itemSum.toFixed(2)}, ${Math.abs(gap).toFixed(2)} ${gap > 0 ? 'short of' : 'over'} the total`);
  }
  if (vat !== null && total !== null) {
    // SA VAT is 15% inclusive, so VAT = total * 15/115
    const expected = Math.round(total * 15 / 115 * 100) / 100;
    if (Math.abs(expected - vat) <= 0.05) confidence += 0.2;
    else notes.push(`VAT ${vat.toFixed(2)} doesn't match 15% of ${total.toFixed(2)} (${expected.toFixed(2)})`);
  }
  const date = findDate(text);
  if (date) confidence += 0.1;

  return {
    merchant: findMerchant(lines),
    date,
    total,
    subtotal,
    vat,
    items,
    confidence: Math.round(confidence * 100) / 100,
    notes,
  };
}
