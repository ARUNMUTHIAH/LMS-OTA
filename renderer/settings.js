'use strict';
// Settings page: users, loan duration, backup and restore, automatic backup.
// Used by: renderer/index.html, which loads it with <script src="settings.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, start.js. Keep that order in index.html when adding or renaming a file.

/* ================= Settings ================= */
async function loadSettings() {
  const [s, info] = await Promise.all([rpc('getSettings'), rpc('appInfo')]);
  state.settings = s;
  clearFieldErrors($('#page-settings'));
  $('#set-duration').value = s.defaultDuration;
  $('#data-file').textContent = `${info.dataFile}  ·  Version ${info.version}`;
  renderAutoBackup(await rpc('getAutoBackup'));
  await loadUsers();
}

/* ----- Users ----- */
async function loadUsers() {
  state.users = await rpc('listUsers');
  renderUsers();
}

function renderUsers() {
  const users = state.users;
  const q = ($('#users-search').value || '').trim().toLowerCase();
  const shown = q ? users.filter((u) => u.username.toLowerCase().includes(q)) : users;
  $('#users-count').textContent = users.length;
  const others = shown.filter((u) => !u.me).length;
  setHtml($('#users-table'), shown.length
    ? `<table class="table users-table"><thead><tr>
      <th class="check"><input type="checkbox" id="users-all" title="Select all" /></th>
      <th class="idx">#</th><th>Username</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>
    ${shown
      .map(
        (u, i) => `<tr class="${u.me ? 'me' : ''}">
        <td class="check"><input type="checkbox" data-user-check="${u.id}" ${u.me ? 'disabled title="You cannot delete your own account"' : ''} /></td>
        <td class="idx muted">${i + 1}</td>
        <td><div class="user-cell"><div class="avatar-sm ${u.active ? '' : 'off'}">${esc(u.username.charAt(0).toUpperCase())}</div><strong>${esc(u.username)}</strong>${u.me ? '<span class="you-tag">You</span>' : ''}</div></td>
        <td>${u.active ? '<span class="badge badge-active"><i></i>Active</span>' : '<span class="badge badge-inactive"><i></i>Inactive</span>'}</td>
        <td class="actions">
          <button class="icon-btn" data-user-edit="${u.id}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn danger" data-user-del="${u.id}" ${u.me ? 'disabled title="You cannot delete your own account"' : 'title="Delete"'}>${icon('trash')}</button>
        </td></tr>`
      )
      .join('')}</tbody></table>`
    : emptyState('search', 'No users match your search.'));
  if ($('#users-all')) $('#users-all').disabled = !others;
  updateUserSelection();
}

function selectedUserIds() {
  return $$('[data-user-check]:checked', $('#users-table')).map((c) => Number(c.dataset.userCheck));
}

// Keeps the "select all" box and the Delete Selected button in step with the row checkboxes.
function updateUserSelection() {
  const boxes = $$('[data-user-check]:not(:disabled)', $('#users-table'));
  const n = selectedUserIds().length;
  const all = $('#users-all');
  if (all) {
    all.checked = boxes.length > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  }
  $$('tr', $('#users-table')).forEach((tr) => {
    const c = $('[data-user-check]', tr);
    tr.classList.toggle('selected', !!(c && c.checked));
  });
  const btn = $('#delete-users-btn');
  btn.disabled = n === 0;
  $('span', btn).textContent = n ? `Delete Selected (${n})` : 'Delete Selected';
}

function syncSignedInName(username) {
  state.user.username = username;
  state.settings.username = username;
  $('#who-name').textContent = username;
  $('#avatar').textContent = username.charAt(0);
}

function openUserForm(user = null) {
  const isEdit = !!user;
  const m = openModal({
    title: isEdit ? `Edit User “${user.username}”` : 'Add User',
    iconName: isEdit ? 'edit' : 'plus',
    size: 'small',
    body: `<form method="post" id="user-form" autocomplete="off" novalidate>
      <label class="field"><span>Username <em>*</em></span><input name="username" maxlength="30" spellcheck="false" value="${esc(isEdit ? user.username : '')}" />
        <span class="hint">3–30 characters: letters, numbers, . _ - (no spaces).</span></label>
      <label class="field"><span>Password${isEdit ? '' : ' <em>*</em>'}</span><input name="password" type="password" maxlength="64" ${isEdit ? 'placeholder="Leave blank to keep the current password"' : ''} />
        <span class="hint">At least 4 characters.</span></label>
      <div class="field"><span>Status</span>
        <div class="segmented" role="radiogroup" aria-label="Status">
          <label class="seg seg-active"><input type="radio" name="active" value="1" ${!isEdit || user.active ? 'checked' : ''} /><span><i></i>Active</span></label>
          <label class="seg seg-inactive"><input type="radio" name="active" value="0" ${isEdit && !user.active ? 'checked' : ''} ${isEdit && user.me ? 'disabled' : ''} /><span><i></i>Inactive</span></label>
        </div>
        <span class="hint">${isEdit && user.me ? 'You cannot make your own account inactive.' : 'Inactive users cannot sign in. Their records are kept.'}</span>
      </div>
      <div class="form-error" hidden></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>${isEdit ? 'Save Changes' : 'Create User'}</button>`,
  });
  const form = $('#user-form', m.el);
  const errBox = $('.form-error', form);
  enhancePasswords(form);
  if (!isEdit) enterMovesTo(form.username, form.password); // password is optional when editing
  setTimeout(() => form.username.focus(), 30);

  async function save() {
    errBox.hidden = true;
    const password = form.password.value;
    const valid = validateFields([
      [form.username, RULES.username],
      [form.password, (v) => (!isEdit && !v ? 'Password is required.' : RULES.newPassword(v))],
    ]);
    if (!valid) return;
    const payload = { username: form.username.value.trim(), password, active: form.active.value === '1' };
    const res = isEdit ? await window.api.updateUser(user.id, payload) : await window.api.createUser(payload);
    if (!res.ok) {
      if (/username/i.test(res.error)) showFieldError(form.username, res.error);
      else {
        errBox.textContent = res.error;
        errBox.hidden = false;
      }
      return;
    }
    if (isEdit && user.me) syncSignedInName(res.data.username);
    toast(isEdit ? `User “${res.data.username}” updated.` : `User “${res.data.username}” created.`);
    m.close();
    attempt(loadSettings);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  $('[data-save]', m.el).addEventListener('click', save);
}

$('#add-user-btn').addEventListener('click', () => openUserForm());
$('#users-search').addEventListener('input', debounce(renderUsers, 150));
$('#users-table').addEventListener('change', (e) => {
  if (e.target.id === 'users-all') {
    $$('[data-user-check]:not(:disabled)', $('#users-table')).forEach((c) => (c.checked = e.target.checked));
  }
  updateUserSelection();
});
$('#delete-users-btn').addEventListener('click', async () => {
  const ids = selectedUserIds();
  if (!ids.length) return;
  const names = state.users.filter((u) => ids.includes(u.id)).map((u) => u.username);
  const ok = await confirmDialog({
    title: `Delete ${plural(ids.length, 'user')}?`,
    message: `${names.join(', ')} will no longer be able to sign in. Library records are not affected.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    const n = await rpc('deleteUsers', ids);
    toast(`${plural(n, 'user')} deleted.`);
    await loadUsers();
  });
});
$('#users-table').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-user-edit]');
  const del = e.target.closest('[data-user-del]');
  if (edit) {
    const user = state.users.find((u) => u.id === Number(edit.dataset.userEdit));
    if (user) openUserForm(user);
  } else if (del && !del.disabled) {
    const user = state.users.find((u) => u.id === Number(del.dataset.userDel));
    if (!user) return;
    const ok = await confirmDialog({
      title: 'Delete this user?',
      message: `“${user.username}” will no longer be able to sign in. Library records are not affected.`,
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await attempt(async () => {
      await rpc('deleteUser', user.id);
      toast(`User “${user.username}” deleted.`);
      await loadUsers();
    });
  }
});

// Copyright footer opens the 2CQR website in the default browser.
$$('[data-website]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openWebsite();
  })
);

$('#duration-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateFields([[$('#set-duration'), RULES.duration]])) return;
  attempt(async () => {
    state.settings = await rpc('setDefaultDuration', Number($('#set-duration').value));
    toast(`Default loan duration set to ${plural(state.settings.defaultDuration, 'day')}.`);
  });
});

$('#backup-btn').addEventListener('click', (e) =>
  withBusy(e.currentTarget, async () => {
    const p = await rpc('backup');
    if (p) savedToast('Backup', p);
  })
);

$('#restore-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Restore from backup?',
    message: 'All current books and circulation records will be replaced by the backup file. A safety copy of the current data is kept automatically.',
    okLabel: 'Choose backup file',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    const p = await rpc('restore');
    if (!p) return;
    await showLogin();
    toast('Backup restored. Please sign in again.');
  });
});

/* ----- Automatic backup ----- */
function renderAutoBackup(ab) {
  state.autoBackup = ab;
  $('#ab-enabled').checked = ab.enabled;
  $('#ab-folder').value = ab.folder;
  $('#ab-folder').title = ab.folder;
  $('#ab-keep').value = ab.keep;
  const last = ab.last ? `Last automatic backup: ${fmtDate(ab.last)}` : 'No automatic backup yet.';
  $('#ab-status').textContent = ab.error ? `${last}  ·  Last attempt failed (${ab.error})` : last;
}

const saveAutoBackup = () =>
  attempt(async () => {
    renderAutoBackup(await rpc('setAutoBackup', { enabled: $('#ab-enabled').checked, keep: Number($('#ab-keep').value) }));
    toast(state.autoBackup.enabled ? 'Automatic backup is on.' : 'Automatic backup is off.');
  });

$('#ab-enabled').addEventListener('change', () => {
  if (validateFields([[$('#ab-keep'), RULES.backupKeep]])) saveAutoBackup();
});

$('#autobackup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (validateFields([[$('#ab-keep'), RULES.backupKeep]])) saveAutoBackup();
});

$('#ab-choose').addEventListener('click', (e) =>
  withBusy(e.currentTarget, async () => {
    const ab = await rpc('chooseBackupFolder');
    if (!ab) return;
    renderAutoBackup(ab);
    toast('Backup folder changed.');
  })
);

$('#ab-now').addEventListener('click', (e) =>
  withBusy(e.currentTarget, async () => {
    const res = await rpc('runAutoBackup');
    renderAutoBackup(res);
    savedToast('Backup', res.file);
  })
);

$('#ab-open').addEventListener('click', () => attempt(() => rpc('openFile', $('#ab-folder').value)));
