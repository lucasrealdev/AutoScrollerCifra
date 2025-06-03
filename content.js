// Este script será injetado nas páginas do CifraClub
// Ele destaca todos os acordes e notas encontrados na cifra

function getChordsWithoutTablature() {
  // Seleciona todos os <b> dentro de .cifra_cnt que NÃO estejam dentro de .tablatura
  const all = document.querySelectorAll('.cifra_cnt b');
  return Array.from(all).filter(b => !b.closest('.tablatura'));
}

function highlightChords() {
  const chords = getChordsWithoutTablature();
  chords.forEach(chord => {
    chord.style.backgroundColor = '#1565c0'; // azul forte
    chord.style.color = '#fff'; // texto branco
    chord.style.borderRadius = '4px';
    chord.style.padding = '0px 4px';
  });
}

function removeHighlightChords() {
  const chords = getChordsWithoutTablature();
  chords.forEach(chord => {
    chord.style.backgroundColor = '';
    chord.style.color = '';
    chord.style.borderRadius = '';
    chord.style.padding = '';
  });
}

// Aplica ou remove destaque conforme status salvo
chrome.storage.sync.get(['autoScrollerActive'], r => {
  r.autoScrollerActive ? highlightChords() : removeHighlightChords();
});

// Escuta mensagens do popup para ativar/desativar em tempo real
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_STATUS') {
    msg.active ? highlightChords() : removeHighlightChords();
  }
}); 