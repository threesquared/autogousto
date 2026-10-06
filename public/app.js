const runBtn = document.getElementById('run-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderVariations(deliveryDate, variations) {
  resultsEl.innerHTML = `
    <h2 style="margin-top:32px;">Picks for ${escapeHtml(deliveryDate)}</h2>
    <div class="variations">
      ${variations.map((v, i) => `
        <div class="variation">
          <h2>Option ${i + 1}</h2>
          <p class="summary">${escapeHtml(v.summary)}</p>
          ${v.picks.map((p) => `
            <div class="pick">
              ${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">` : ''}
              <h3>${escapeHtml(p.name)}</h3>
              <p>${escapeHtml(p.reason)}</p>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  statusEl.classList.remove('error');
  statusEl.textContent = 'Running — fetching this week\'s menu and generating picks. This can take a minute or two...';
  resultsEl.innerHTML = '';

  try {
    const res = await fetch('/api/run', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    statusEl.textContent = 'Done.';
    renderVariations(data.deliveryDate, data.variations);
  } catch (err) {
    statusEl.classList.add('error');
    statusEl.textContent = err.message;
  } finally {
    runBtn.disabled = false;
  }
});
