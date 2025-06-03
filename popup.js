const btn = document.getElementById('toggle');
const statusLabel = document.getElementById('status');
let active = false;

// Função para atualizar o status visual
function updateStatus(active) {
  statusLabel.textContent = 'Status: ' + (active ? 'Active' : 'Inactive');
  btn.textContent = active ? 'Deactivate' : 'Activate';
}

// Ler status salvo ao abrir o popup
chrome.storage.sync.get(['autoScrollerActive'], r => {
  active = !!r.autoScrollerActive;
  updateStatus(active);
});

btn.onclick = () => {
  active = !active;
  chrome.storage.sync.set({ autoScrollerActive: active });
  updateStatus(active);
  // Envia mensagem para o content script na aba ativa
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_STATUS', active }, () => {
      if (chrome.runtime.lastError) {
        statusLabel.textContent = 'No content script found on this page.';
      }
    });
  });
}; 