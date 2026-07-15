const DEFAULT_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbywKuHtyE9Q6twPYjRftw1PIt_IA80QEXNY6PRN19kWbCNWs7XoliWZTTo1V2mbMQKY8w/exec';

const STORAGE_KEYS = {
  endpoint: 'blackamoor_endpoint_url',
  queue: 'blackamoor_upload_queue',
  recent: 'blackamoor_recent_entries'
};

const state = {
  currentInput: '',
  syncing: false
};

function nowIso() {
  return new Date().toISOString();
}

function clockTimeFromIso(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour12: false
  });
}

/*
Uses an endpoint saved through the Settings page if one exists.

Otherwise, it automatically uses the permanent Blackamoor
Apps Script URL above.
*/
function getEndpoint() {
  return (
    localStorage.getItem(STORAGE_KEYS.endpoint) ||
    DEFAULT_ENDPOINT
  );
}

/*
Saving a blank URL removes the local override and returns the
device to the built-in default endpoint.
*/
function setEndpoint(url) {
  const cleanedUrl = String(url || '').trim();

  if (!cleanedUrl || cleanedUrl === DEFAULT_ENDPOINT) {
    localStorage.removeItem(STORAGE_KEYS.endpoint);
    return;
  }

  localStorage.setItem(STORAGE_KEYS.endpoint, cleanedUrl);
}

function getQueue() {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEYS.queue) || '[]'
    );
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(
    STORAGE_KEYS.queue,
    JSON.stringify(queue)
  );

  updateSyncStatus();
}

function getRecent() {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEYS.recent) || '[]'
    );
  } catch {
    return [];
  }
}

function saveRecent(recent) {
  localStorage.setItem(
    STORAGE_KEYS.recent,
    JSON.stringify(recent.slice(0, 30))
  );
}

function addRecent(entry) {
  const recent = getRecent();
  recent.unshift(entry);
  saveRecent(recent);
  renderRecent();
}

function enqueue(payload, label) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'pending',
    label,
    payload,
    createdAt: nowIso(),
    attempts: 0
  };

  const queue = getQueue();
  queue.unshift(item);

  saveQueue(queue);
  addRecent(item);
  syncQueueSoon();

  return item;
}

function updateQueueItem(id, patch) {
  const queue = getQueue();

  const next = queue.map(item =>
    item.id === id
      ? { ...item, ...patch }
      : item
  );

  saveQueue(next);
  saveRecent(next.slice(0, 30));
  renderRecent();
}

function updateSyncStatus() {
  const status = document.getElementById('sync-status');

  if (!status) {
    return;
  }

  const queue = getQueue();

  const pending = queue.filter(
    item => item.status !== 'uploaded'
  ).length;

  status.textContent = pending
    ? `${pending} pending`
    : 'Synced';
}

function setMessage(text, type = '') {
  const element = document.getElementById('message');

  if (!element) {
    return;
  }

  element.textContent = text;
  element.className =
    `status-message ${type}`.trim();
}

function syncQueueSoon() {
  window.clearTimeout(window.__syncTimer);

  window.__syncTimer = window.setTimeout(
    syncQueue,
    100
  );
}

async function syncQueue() {
  if (state.syncing) {
    return;
  }

  const endpoint = getEndpoint();

  if (!endpoint) {
    updateSyncStatus();
    return;
  }

  state.syncing = true;

  const queue = getQueue();

  const pending = queue
  .filter(item => item.status === 'pending' || item.status === 'failed')
  .sort((a, b) => {
    const timeA = new Date(a.payload?.timestamp || a.createdAt).getTime();
    const timeB = new Date(b.payload?.timestamp || b.createdAt).getTime();
    return timeA - timeB;
  });

  for (const item of pending) {
    updateQueueItem(item.id, {
      status: 'syncing',
      attempts: (item.attempts || 0) + 1
    });

    try {
      /*
      no-cors avoids browser CORS blocking with Apps Script.

      Because no-cors responses cannot be read by JavaScript,
      "uploaded" means the browser successfully sent the request.
      */
      await fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(item.payload)
      });

      updateQueueItem(item.id, {
        status: 'uploaded',
        uploadedAt: nowIso()
      });
    } catch (error) {
      updateQueueItem(item.id, {
        status: 'failed',
        error: String(error)
      });

      break;
    }
  }

  state.syncing = false;
  updateSyncStatus();
}

function clearUploadedOlderThan(limit = 100) {
  const queue = getQueue();
  const keep = [];

  let uploadedSeen = 0;

  for (const item of queue) {
    if (item.status === 'uploaded') {
      uploadedSeen++;
    }

    if (
      item.status !== 'uploaded' ||
      uploadedSeen <= limit
    ) {
      keep.push(item);
    }
  }

  saveQueue(keep);
}

function renderRecent() {
  const list = document.getElementById('recent-list');

  if (!list) {
    return;
  }

  const recent = getQueue().slice(0, 20);

  if (!recent.length) {
    list.innerHTML =
      '<p class="muted">No local entries yet.</p>';

    return;
  }

  list.innerHTML = recent.map(item => {
    const payload = item.payload || {};
    const label =
      item.label ||
      payload.type ||
      'Entry';

    const bib = payload.bib
      ? `#${payload.bib}`
      : '';

    const time = payload.timestamp
      ? clockTimeFromIso(payload.timestamp)
      : '';

    return `
      <div class="recent-item">
        <div>
          <strong>${escapeHtml(bib || label)}</strong><br />
          <span>
            ${escapeHtml(label)}
            ${escapeHtml(time)}
          </span>
        </div>

        <span class="badge ${item.status}">
          ${item.status}
        </span>
      </div>
    `;
  }).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>"]/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[character])
  );
}

function buildKeypad(options = {}) {
  const keypad = document.getElementById('keypad');
  if (!keypad) return;

  const allowUncertain = options.allowUncertain === true;

  const keys = allowUncertain
    ? ['7','8','9','4','5','6','1','2','3','?','0','⌫','CLEAR']
    : ['7','8','9','4','5','6','1','2','3','⌫','0','CLEAR'];

  keypad.innerHTML = keys.map(k =>
    `<button class="key ${k === '?' ? 'uncertain-key' : ''}" data-key="${k}">${k}</button>`
  ).join('');

  keypad.addEventListener('click', event => {
    const button = event.target.closest('button[data-key]');
    if (!button) return;

    const key = button.dataset.key;

    if (/^\d$/.test(key)) {
      state.currentInput = state.currentInput.replace('?', '');
      state.currentInput += key;
    }

    if (key === '?') {
      if (!state.currentInput) return;

      if (state.currentInput.endsWith('?')) {
        state.currentInput = state.currentInput.slice(0, -1);
      } else {
        state.currentInput = state.currentInput.replace('?', '') + '?';
      }
    }

    if (key === '⌫') {
      state.currentInput = state.currentInput.slice(0, -1);
    }

    if (key === 'CLEAR') {
      state.currentInput = '';
    }

    updateDisplay();
  });
}

function updateDisplay() {
  const display = document.getElementById('display');

  if (display) {
    display.textContent =
      state.currentInput || '\u00a0';
  }
}

function setupCheckpointPage() {
  const params =
    new URLSearchParams(window.location.search);

  const location =
    params.get('location') || 'Blackamoor';

  const title =
    document.getElementById('screen-title');

  if (title) {
    title.textContent = location;
  }

  buildKeypad({ allowUncertain: true });
  renderRecent();
  updateSyncStatus();

  document.getElementById('submit-button')?.addEventListener('click', () => {
  const rawInput = state.currentInput.trim();
  const uncertain = rawInput.endsWith('?');
  const bibNumber = rawInput.replace(/\?/g, '').trim();

  if (!bibNumber) {
    return setMessage('Enter bib number first', 'warn');
  }

  const submittedBib = uncertain
    ? `${bibNumber}?`
    : bibNumber;

  const timestamp = nowIso();

  enqueue({
    type: 'checkpoint',
    location,
    bib: submittedBib,
    bibNumber,
    uncertain,
    timestamp,
    clockTime: clockTimeFromIso(timestamp)
  }, uncertain ? `${location} uncertain checkpoint` : `${location} checkpoint`);

  state.currentInput = '';
  updateDisplay();

  setMessage(
    uncertain
      ? `✓ ${submittedBib} queued as uncertain`
      : `✓ ${submittedBib} queued`,
    uncertain ? 'warn' : 'good'
  );
});
}

function setupTimerPage() {
  renderRecent();
  updateSyncStatus();

  document
    .getElementById('finish-button')
    ?.addEventListener('click', () => {
      const timestamp = nowIso();

      enqueue({
        type: 'finish-timer',
        timestamp,
        clockTime: clockTimeFromIso(timestamp)
      }, 'Finish time');

      setMessage(
        `✓ finish time queued ${clockTimeFromIso(timestamp)}`,
        'good'
      );
    });
}

function setupFinishPage() {
  buildKeypad();
  renderRecent();
  updateSyncStatus();

  document
    .getElementById('submit-button')
    ?.addEventListener('click', () => {
      const bib = state.currentInput.trim();

      if (!bib) {
        return setMessage(
          'Enter bib number first',
          'warn'
        );
      }

      const timestamp = nowIso();

      enqueue({
        type: 'finish-recorder',
        bib,
        timestamp,
        clockTime: clockTimeFromIso(timestamp)
      }, 'Finish recorder');

      state.currentInput = '';
      updateDisplay();

      setMessage(
        `✓ ${bib} queued`,
        'good'
      );
    });
}

function setupSettingsPage() {
  const endpointInput =
    document.getElementById('endpoint');

  /*
  Shows the built-in endpoint when there is no browser-specific
  override saved.
  */
  if (endpointInput) {
    endpointInput.value = getEndpoint();
  }

  updateSyncStatus();

  document
    .getElementById('save-settings')
    ?.addEventListener('click', () => {
      const enteredUrl =
        endpointInput?.value.trim() || '';

      setEndpoint(enteredUrl);

      if (endpointInput) {
        endpointInput.value = getEndpoint();
      }

      setMessage(
        'Settings saved',
        'good'
      );

      syncQueueSoon();
    });

  document
    .getElementById('test-connection')
    ?.addEventListener('click', async () => {
      const endpoint =
        endpointInput?.value.trim() ||
        getEndpoint();

      if (!endpoint) {
        return setMessage(
          'No endpoint URL available',
          'warn'
        );
      }

      try {
        const response = await fetch(endpoint);
        const text = await response.text();

        const looksGood =
          text.toLowerCase().includes('live') ||
          text.toLowerCase().includes('ok');

        setMessage(
          looksGood
            ? 'Connection looks good'
            : 'Endpoint responded',
          'good'
        );
      } catch (error) {
        setMessage(
          `Connection test failed: ${error.message}`,
          'bad'
        );
      }
    });

  document
    .getElementById('clear-local')
    ?.addEventListener('click', clearLocalData);
}

function setupRecentPage() {
  renderRecent();
  updateSyncStatus();

  document
    .getElementById('sync-now')
    ?.addEventListener('click', syncQueueSoon);

  document
    .getElementById('clear-local')
    ?.addEventListener('click', clearLocalData);
}

function clearLocalData() {
  const confirmed = confirm(
    'Clear local queue and recent entries on this device? ' +
    'This will not delete rows already written to Google Sheets.'
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.queue);
  localStorage.removeItem(STORAGE_KEYS.recent);

  renderRecent();
  updateSyncStatus();

  setMessage(
    'Local queue cleared',
    'good'
  );
}

function setupStartPage() {
  renderRecent();
  updateSyncStatus();

  const startButton = document.getElementById('start-race-button');

  startButton?.addEventListener('click', () => {
    /*
    Capture the race start time immediately on the button press.
    Do not show a confirmation first, because that delays the timestamp.
    */
    const timestamp = nowIso();
    const clockTime = clockTimeFromIso(timestamp);

    enqueue({
      type: 'race-start',
      timestamp,
      clockTime
    }, 'Race start');

    startButton.disabled = true;
    startButton.textContent = 'RACE STARTED';

    setMessage(
      `✓ official start time recorded: ${clockTime}`,
      'good'
    );
  });
}
   

function init() {
  const page = document.body.dataset.page;

if (page === 'checkpoint') {
  setupCheckpointPage();
}

if (page === 'timer') {
  setupTimerPage();
}

if (page === 'finish') {
  setupFinishPage();
}

if (page === 'start') {
  setupStartPage();
}

if (page === 'settings') {
  setupSettingsPage();
}

if (page === 'recent') {
  setupRecentPage();
}

  clearUploadedOlderThan(100);
  syncQueueSoon();

  window.addEventListener(
    'online',
    syncQueueSoon
  );
}

document.addEventListener(
  'DOMContentLoaded',
  init
);
