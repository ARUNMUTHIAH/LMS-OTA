'use strict';
// Book Entry page: book list, add/edit/delete, and bulk import from Excel.
// Used by: renderer/index.html, which loads it with <script src="books.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, start.js. Keep that order in index.html when adding or renaming a file.

/* ================= Books ================= */

async function loadBooksPage(opts = {}) {
  if (opts.status !== undefined) {
    state.books.status = opts.status;
    state.books.query = '';
    $('#book-search').value = '';
  }
  $('#book-filter-status').value = state.books.status;
  state.books.page = 1;
  await refreshBooks();
  if (opts.newBook) openBookForm();
  else $('#book-search').focus();
}

let booksSeq = 0;
async function refreshBooks() {
  const seq = ++booksSeq;
  const rows = await rpc('searchBooks', { query: state.books.query, status: state.books.status });
  if (seq !== booksSeq) return; // a newer search superseded this one
  state.books.rows = rows;
  renderBooks();
}

function renderBooks() {
  const { rows } = state.books;
  const { pages, start, slice } = pageSlice(rows, state.books);
  const filtered = state.books.query || state.books.status;

  setHtml($('#books-table'), slice.length
    ? `<table class="table"><thead><tr><th>Barcode No</th><th>LF</th><th>CAT</th><th>Description of Manual</th><th>LOC</th><th>Rack</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${slice
        .map(
          (b) => `<tr>
            <td class="mono">${esc(b.book_no)}</td>
            <td class="mono">${esc(b.lf) || '<span class="muted">—</span>'}</td>
            <td class="nowrap">${esc(b.category) || '<span class="muted">—</span>'}</td>
            <td class="strong wrap">${esc(b.name)}</td>
            <td class="nowrap">${esc(b.location) || '<span class="muted">—</span>'}</td>
            <td class="nowrap">${esc(b.rack) || '<span class="muted">—</span>'}</td>
            <td>${badge(b.status)}${b.status === 'Issued' ? `<div class="tiny muted">${esc(b.issue_user)} · due ${esc(fmtDate(b.due_date))}</div>` : ''}</td>
            <td class="actions">
              <button class="icon-btn" data-edit="${b.id}" title="Edit">${icon('edit')}</button>
              <button class="icon-btn danger" data-del="${b.id}" ${b.issue_id ? 'disabled title="Issued books cannot be deleted"' : 'title="Delete"'}>${icon('trash')}</button>
            </td></tr>`
        )
        .join('')}</tbody></table>`
    : filtered
      ? emptyState('search', 'No books match your search.')
      : emptyState('books', 'No books yet. Click “Add Book” to enter your first book.'));

  setHtml($('#books-pager'), pagerHtml(rows.length, state.books, pages, start, slice.length, 'book'));
}

$('#books-table').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (edit) {
    const book = state.books.rows.find((b) => b.id === Number(edit.dataset.edit));
    if (book) openBookForm(book);
  } else if (del && !del.disabled) {
    const book = state.books.rows.find((b) => b.id === Number(del.dataset.del));
    if (book) deleteBook(book);
  }
});
bindPager($('#books-pager'), state.books, renderBooks);
$('#book-search').addEventListener(
  'input',
  debounce(() => {
    state.books.query = $('#book-search').value;
    state.books.page = 1;
    attempt(refreshBooks);
  })
);
$('#book-filter-status').addEventListener('change', () => {
  state.books.status = $('#book-filter-status').value;
  state.books.page = 1;
  attempt(refreshBooks);
});
$('#add-book-btn').addEventListener('click', () => openBookForm());
$('#import-books-btn').addEventListener('click', () => openImportDialog());

/* ----- Bulk import from Excel ----- */
function openImportDialog() {
  const m = openModal({
    title: 'Import Books from Excel',
    iconName: 'sheet',
    size: 'import',
    body: '<div id="import-body"></div>',
    foot: '<div id="import-foot" class="import-foot"></div>',
  });
  const body = $('#import-body', m.el);
  const foot = $('#import-foot', m.el);
  // Forget the chosen file when the dialog closes (harmless after a successful import).
  m.onClose = () => window.api.importCancel();

  function showStart(error = '') {
    setHtml(body, `
      ${error ? `<div class="alert alert-danger import-alert">${icon('alert')}<div><strong>File not accepted</strong>${esc(error)}</div></div>` : ''}
      <ol class="import-steps">
        <li><strong>Download the template</strong><span>Columns: Barcode No, LF, CAT, Description of Manual, LOC, Rack. Barcode No and Description of Manual are required.</span></li>
        <li><strong>Fill in one book per row</strong><span>Keep the header row. Barcode Nos must be unique. Blank rows are skipped.</span></li>
        <li><strong>Choose the file</strong><span>Every row is checked first. Nothing is saved until you confirm.</span></li>
      </ol>`);
    setHtml(foot, `<button class="btn btn-ghost left" data-template>${icon('file')}Download Template</button>
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-choose>${icon('sheet')}Choose Excel File</button>`);
    $('[data-cancel]', foot).addEventListener('click', m.close);
    $('[data-template]', foot).addEventListener('click', (e) =>
      withBusy(e.currentTarget, async () => {
        const p = await rpc('importTemplate');
        if (p) savedToast('Template', p);
      })
    );
    $('[data-choose]', foot).addEventListener('click', choose);
  }

  async function choose(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await window.api.importPreview();
    btn.disabled = false;
    if (res.auth) return showLogin();
    if (!res.ok) return showStart(res.error);
    if (res.data) showPreview(res.data);
  }

  function showPreview(p) {
    const bad = p.errors.length;
    const notes = [];
    if (p.missingOptional.length) notes.push(`Columns not in the file (left blank): ${p.missingOptional.join(', ')}.`);
    if (p.ignored.length) notes.push(`Columns ignored: ${p.ignored.join(', ')}.`);
    const shown = p.errors.slice(0, 200);
    setHtml(body, `
      <div class="import-file">${icon('sheet')}<div><strong>${esc(p.fileName)}</strong><span>Sheet “${esc(p.sheet)}” · header on row ${p.headerRow}</span></div></div>
      <div class="import-stats">
        <div class="istat"><span>Rows found</span><strong>${p.total}</strong></div>
        <div class="istat ok"><span>Ready to import</span><strong>${p.readyCount}</strong></div>
        <div class="istat ${bad ? 'bad' : ''}"><span>Rows with errors</span><strong>${bad}</strong></div>
      </div>
      ${notes.length ? `<div class="alert alert-info import-alert">${icon('alert')}<div>${notes.map(esc).join('<br>')}</div></div>` : ''}
      ${
        bad
          ? `<div class="alert alert-warn import-alert">${icon('alert')}<div><strong>${plural(bad, 'row')} with errors will not be imported</strong>
              ${p.readyCount ? `The ${plural(p.readyCount, 'correct row')} will be saved. ` : ''}The wrong rows will be saved to a separate
              <b>“…_not_imported”</b> Excel file next to your file, with the problem written beside each row. Correct that file and import it again.</div></div>
            <div class="table-wrap import-errors"><table class="table"><thead><tr><th>Excel Row</th><th>Barcode No</th><th>Problem</th></tr></thead><tbody>
              ${shown
                .map(
                  (e) => `<tr><td class="num">${e.rowNumber}</td><td class="mono">${esc(e.book_no) || '<span class="muted">—</span>'}</td>
                    <td class="wrap">${e.messages.map(esc).join('<br>')}</td></tr>`
                )
                .join('')}
              ${bad > shown.length ? `<tr><td colspan="3" class="muted">…and ${bad - shown.length} more. Download the error report to see all.</td></tr>` : ''}
            </tbody></table></div>`
          : `<div class="alert alert-ok import-alert">${icon('check')}<div><strong>All rows are valid</strong>Ready to add ${plural(p.readyCount, 'book')} to the library.</div></div>`
      }`);
    const label = p.readyCount
      ? `Import ${plural(p.readyCount, 'Book')}${bad ? ' & Save Wrong Rows' : ''}`
      : 'Save Wrong Rows to Excel';
    setHtml(foot, `<span class="left"></span>
      <button class="btn btn-ghost" data-back>Choose Another File</button>
      <button class="btn btn-primary" data-import>${icon(p.readyCount ? 'plus' : 'sheet')}${label}</button>`);
    $('[data-back]', foot).addEventListener('click', choose);
    $('[data-import]', foot).addEventListener('click', (e) =>
      withBusy(e.currentTarget, async () => {
        const r = await rpc('importCommit');
        m.close();
        refreshLookups();
        if (state.page === 'books') await refreshBooks();
        const saved = r.imported ? `${plural(r.imported, 'book')} imported.` : 'No books imported.';
        if (!r.skipped) return toast(saved);
        if (!r.rejectsFile) return toast(`${saved} ${plural(r.skipped, 'wrong row')} could not be saved to a file.`, 'err');
        const name = r.rejectsFile.split(/[\\/]/).pop();
        toast(`${saved} ${plural(r.skipped, 'wrong row')} saved to “${name}” — correct it and import again.`, r.imported ? 'ok' : 'info', [
          { label: 'Open', run: () => attempt(() => rpc('openFile', r.rejectsFile)) },
          { label: 'Show in folder', run: () => attempt(() => rpc('showInFolder', r.rejectsFile)) },
        ]);
      })
    );
  }

  showStart();
}

function openBookForm(book = null, prefillNo = '') {
  const isEdit = !!book;
  const b = book || { book_no: prefillNo, lf: '', category: '', name: '', location: '', rack: '' };
  const m = openModal({
    title: isEdit ? 'Edit Book' : 'Add New Book',
    iconName: isEdit ? 'edit' : 'plus',
    body: `<form method="post" id="book-form" autocomplete="off" novalidate>
      <label class="field"><span>Barcode No <em>*</em></span><input name="book_no" maxlength="${LIMITS.bookNo}" spellcheck="false" value="${esc(b.book_no)}" placeholder="e.g. OTA-0001" />
        <span class="hint">Must be unique. Letters, numbers and - / _ . only.</span></label>
      <div class="row-2">
        <label class="field"><span>LF</span><input name="lf" maxlength="${LIMITS.lf}" spellcheck="false" value="${esc(b.lf)}" placeholder="e.g. 001-06" /></label>
        <label class="field"><span>CAT</span><input name="category" maxlength="${LIMITS.category}" spellcheck="false" value="${esc(b.category)}" placeholder="e.g. DOR-MM" /></label>
      </div>
      <label class="field"><span>Description of Manual <em>*</em></span><input name="name" maxlength="${LIMITS.bookName}" value="${esc(b.name)}" placeholder="e.g. Airplane Maintenance Manual Vol-I (CG-780)" /></label>
      <div class="row-2">
        <label class="field"><span>LOC</span><input name="location" maxlength="${LIMITS.location}" spellcheck="false" value="${esc(b.location)}" placeholder="e.g. B2" /></label>
        <label class="field"><span>Rack</span><input name="rack" maxlength="${LIMITS.rack}" spellcheck="false" value="${esc(b.rack)}" placeholder="e.g. 6" /></label>
      </div>
      <div class="form-error" hidden></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button>
      ${isEdit ? '' : '<button class="btn btn-soft" data-another>Save &amp; Add Another</button>'}
      <button class="btn btn-primary" data-save>${isEdit ? 'Save Changes' : 'Save Book'}</button>`,
  });
  const form = $('#book-form', m.el);
  attachSuggest(form.category, () => state.lookups.categories);
  const errBox = $('.form-error', form);
  const first = isEdit || !prefillNo ? form.book_no : form.name;
  setTimeout(() => first.focus(), 30);

  async function save(another) {
    errBox.hidden = true;
    const valid = validateFields([
      [form.book_no, RULES.bookNo],
      [form.lf, RULES.lf],
      [form.category, RULES.category],
      [form.name, RULES.bookName],
      [form.location, RULES.location],
      [form.rack, RULES.rack],
    ]);
    if (!valid) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (isEdit) data.id = book.id;
    const res = await window.api.saveBook(data);
    if (!res.ok) {
      if (/Barcode No/i.test(res.error)) {
        showFieldError(form.book_no, res.error);
        form.book_no.focus();
        form.book_no.select();
      } else {
        errBox.textContent = res.error;
        errBox.hidden = false;
      }
      return;
    }
    toast(isEdit ? `Book “${res.data.name}” updated.` : `Book “${res.data.name}” (${res.data.book_no}) added.`);
    refreshLookups();
    if (state.page === 'books') attempt(refreshBooks);
    if (another) {
      // Entries usually come in runs from the same shelf, so keep CAT / LOC / Rack.
      const keep = { category: form.category.value, location: form.location.value, rack: form.rack.value };
      form.reset();
      form.book_no.value = '';
      form.lf.value = '';
      form.name.value = '';
      form.category.value = keep.category;
      form.location.value = keep.location;
      form.rack.value = keep.rack;
      clearFieldErrors(form);
      form.book_no.focus();
    } else {
      m.close();
      if (m.afterSave) m.afterSave(res.data);
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(false);
  });
  $('[data-save]', m.el).addEventListener('click', () => save(false));
  const another = $('[data-another]', m.el);
  if (another) another.addEventListener('click', () => save(true));
  return m;
}

async function deleteBook(book) {
  const ok = await confirmDialog({
    title: 'Delete this book?',
    message: `“${book.name}” (${book.book_no}) will be removed from the catalogue. Past circulation records are kept in reports.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    await rpc('deleteBook', book.id);
    toast(`Book ${book.book_no} deleted.`);
    refreshLookups();
    await refreshBooks();
  });
}
