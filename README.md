# receipt-ocr

Reads till slips: merchant, date, total, VAT and line items. It has two OCR back ends:

- **Tesseract.js**: runs locally, in Node or in the browser. Nothing is uploaded, and it works offline once the
  English language data has been downloaded and cached.
- **Google Cloud Vision**: much better on crumpled, faded thermal paper, but the image goes to Google and
  each call costs money.

The OCR step is the easy part. The real work is in `src/parse.js`, which turns messy OCR text into numbers you
can trust, or tells you when you can't.

## Why there's a confidence score

OCR on receipts gets things wrong in small ways that matter: `0` read as `O`, a decimal point that
disappears, the cents column split off from the rands. A parser that just grabs whatever follows "TOTAL" will be
confidently wrong some of the time. So the parser checks its own work:

- **Line items should add up to the total.** If they don't, it says by how much.
- **VAT should be 15/115 of the total** (SA VAT is 15%, included in the price).
- It looks for the total from the bottom up, skipping SUBTOTAL, "VAT incl", CASH TENDERED and CHANGE.
  If there's no total line at all, it falls back to the largest amount and *says it guessed*.

Each check that passes adds to `confidence`, and every one that fails adds a note. A downstream process can
auto-accept anything at 1.0 and send the rest to a person.

Real output from `samples/grocery-slip.png` (Tesseract, a slightly rotated and blurred render):

```json
{
  "merchant": "KASI FRESH SUPERMARKET",
  "date": "2026-09-27",
  "total": 187.46,
  "subtotal": 187.46,
  "vat": 24.45,
  "items": [ ... 4 items ... ],
  "confidence": 0.7,
  "notes": ["items add up to 177.47, 9.99 short of the total"]
}
```

Tesseract read the last line, `SALT 500G 9.99`, as `SALT 5006 9599,`. The total and VAT are right, but the
item list is short by exactly 9.99, and the result says so instead of passing it off as clean.

Other things it handles:
- digit fixes inside numeric tokens only (`65O.OO` becomes `650.00`, `O2.1O.2026` becomes `02.10.2026`),
  leaving words alone
- `R1 234,50`, `R 87.50`, `87,50` and similar amount formats
- day-first SA dates (`05/10/2026`, `05.10.26`, `5 Oct 2026`) as well as ISO dates
- quantity lines like `2 @ 17.99 WHITE BREAD 35.98`

## Usage

```
npm install
node src/cli.js samples/grocery-slip.png
node src/cli.js samples/grocery-slip.png --text          # also print the raw OCR text
GOOGLE_VISION_API_KEY=... node src/cli.js slip.jpg --engine vision
```

Browser version, with drag and drop and everything kept client side:

```
npm start
```

Then open http://localhost:5173/web/.

One Tesseract setting made a big difference. With the default page segmentation, Tesseract treated the
right-aligned amounts as a separate column, and all the cents ended up at the bottom of the output. Page mode 6
(a single uniform block) keeps each line together.

## Tests

```
npm test
```

The parser tests run on OCR text fixtures (a clean grocery slip, a fuel slip full of O/0 mistakes, and a
restaurant bill with cash tendered and change), so they're fast and don't need Tesseract.
