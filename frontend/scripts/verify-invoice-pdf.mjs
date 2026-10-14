import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, '.invoice-pdf-check');
mkdirSync(output, { recursive: true });
const browser = process.env.INVOICE_PDF_BROWSER || 'google-chrome';
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
run(browser, ['--version']);
const vite = await createServer({ root, configFile: false, plugins: [react()], resolve: { alias: { '@': resolve(root, 'src') } }, server: { middlewareMode: true, hmr: false } });
try {
  const { InvoiceSheet } = await vite.ssrLoadModule('/src/components/app/InvoiceSheet.tsx');
  const { singlePageInvoiceScale } = await vite.ssrLoadModule('/src/lib/invoice-print.ts');
  const { PRINT_DEFAULTS } = await vite.ssrLoadModule('/src/lib/print-rules.ts');
  const styles = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
  const printStyles = styles.slice(styles.indexOf('@media screen { .print-document'), styles.indexOf('/* Keep wide tables'));
  const sheetStyles = readFileSync(resolve(root, 'src/components/app/invoice-sheet.css'), 'utf8');
  const settings = { legalName: 'PDF Test Business', tradeName: '', gstin: 'NA', address: 'Test address', phone: '', email: '', bankName: 'Test bank', bankAccount: '000000123456', ifsc: 'TEST0ABC123', invoiceTerms: 'PDF verification terms', jurisdiction: 'Test City' };
  for (const count of [8, 200]) {
    const invoice = { id: 'pdf-fixture', number: 'INV/26-27/00001', date: '2026-10-14', dueDate: '2026-11-13', customerId: 'test-party', customerName: 'PDF Test Customer', billingAddress: 'Test billing address', placeOfSupplyCode: '36', placeOfSupplyName: 'Telangana', supply: 'intra', challans: [], lines: Array.from({ length: count }, (_, index) => ({ soLineId: `line-${index}`, itemId: `item-${index}`, itemName: `PDF Item ${String(index + 1).padStart(3, '0')}`, hsn: '1234', uom: 'PCS', qty: 1, rate: 100, discountPct: 0, gstRate: 18, allocations: [] })), taxable: count * 100, cgst: count * 9, sgst: count * 9, igst: 0, roundOff: 0, grandTotal: count * 118, byRate: [], advances: [], paid: 0, balance: count * 118, status: 'awaiting_payment', createdBy: 'Test Owner' };
    const markup = renderToStaticMarkup(createElement(InvoiceSheet, { invoice, settings, profile: { ...PRINT_DEFAULTS.B, copies: 4 } }));
    const html = resolve(output, `invoice-${count}.html`), pdf = resolve(output, `invoice-${count}.pdf`);
    writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 12mm; } ${printStyles}\n${sheetStyles}</style></head><body><div class="print-document print-a4 invoice-single-page">${markup}</div><script>const scale = (${singlePageInvoiceScale.toString()}); function fit(){const sheet=document.querySelector('.invoice-sheet');sheet.style.zoom='1';sheet.style.zoom=String(scale(sheet.getBoundingClientRect().height));}window.addEventListener('beforeprint',fit);fit();</script></body></html>`);
    run(browser, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=1500', `--user-data-dir=${resolve(output, `browser-${count}`)}`, `--print-to-pdf=${pdf}`, `file://${html}`]);
    const info = run('pdfinfo', [pdf]);
    const text = run('pdftotext', ['-layout', pdf, '-']);
    if (!/^Pages:\s+1\s*$/m.test(info)) throw new Error(`${count}-item invoice is not a single page: ${info}\n${text}`);
    const bounds = run('pdftotext', ['-bbox', pdf, '-']);
    const page = bounds.match(/<page width="([\d.]+)" height="([\d.]+)">/);
    if (!page) throw new Error('Missing PDF page bounds');
    for (const word of bounds.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)) if (Number(word[1]) < -0.5 || Number(word[2]) < -0.5 || Number(word[3]) > Number(page[1]) + 0.5 || Number(word[4]) > Number(page[2]) + 0.5) throw new Error('Invoice text is outside the PDF page');
    for (const required of [`PDF Item ${String(count).padStart(3, '0')}`, 'Total Amount', 'Balance due', 'Authorised Signatory', 'PDF verification terms']) if (!text.includes(required)) throw new Error(`${count}-item PDF lost ${required}`);
    if ((text.match(/INV\/26-27\/00001/g) || []).length !== 1) throw new Error('Invoice copy was duplicated');
    console.log(`PASS: ${count} items, one original PDF page, last item and summary retained`);
  }
} finally { await vite.close(); }
