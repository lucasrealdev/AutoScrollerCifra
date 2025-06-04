// ===================== INÍCIO Chromagram.js =====================
class Chromagram {
  constructor(analyserNode, sampleRate = 44100) {
    this.referenceFrequency = 130.81278265;
    this.bufferSize = 8192;
    this.numHarmonics = 2;
    this.numOctaves = 2;
    this.numBinsToSearch = 2;
    this.chromaCalculationInterval = 4096;
    this.noteFrequencies = Array.from({ length: 12 }, (_, i) => this.referenceFrequency * Math.pow(2, i / 12));
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferWritePos = 0;
    this.numSamplesSinceLastCalculation = 0;
    this.fftSize = this.bufferSize;
    this.fft = new FFT(this.fftSize);
    this.magnitudeSpectrum = new Float32Array((this.bufferSize / 2) + 1);
    this.window = new Float32Array(this.bufferSize);
    this.makeHammingWindow();
    this.chromagram = new Array(12).fill(0);
    this.chromaReady = false;
    this.inputAudioFrameSize = analyserNode.fftSize;
    this.downsampleFactor = 4;
    this.downsampledInputAudioFrame = new Float32Array(Math.floor(this.inputAudioFrameSize / this.downsampleFactor));
    this.downSampledAudioFrameSize = this.downsampledInputAudioFrame.length;
    this.iirCoeffs = { b0: 0.2929, b1: 0.5858, b2: 0.2929, a1: -0.0000, a2: 0.1716 };
    this.iirState = { x_1: 0, x_2: 0, y_1: 0, y_2: 0 };
    this.analyser = analyserNode;
    this.samplingFrequency = sampleRate;
    this.tempInputBuffer = new Float32Array(this.inputAudioFrameSize);
  }
  update() {
    this.analyser.getFloatTimeDomainData(this.tempInputBuffer);
    this.processAudioFrame(this.tempInputBuffer);
  }
  processAudioFrame(inputAudioFrame) {
    this.chromaReady = false;
    this.downSampleFrame(inputAudioFrame);
    const shift = this.downSampledAudioFrameSize;
    for (let i = 0; i < this.bufferSize - shift; i++) {
      this.buffer[i] = this.buffer[i + shift];
    }
    for (let i = 0; i < shift; i++) {
      this.buffer[this.bufferSize - shift + i] = this.downsampledInputAudioFrame[i];
    }
    this.numSamplesSinceLastCalculation += inputAudioFrame.length;
    if (this.numSamplesSinceLastCalculation >= this.chromaCalculationInterval) {
      this.calculateChromagram();
      this.numSamplesSinceLastCalculation = 0;
    }
  }
  downSampleFrame(inputAudioFrame) {
    const { b0, b1, b2, a1, a2 } = this.iirCoeffs;
    let { x_1, x_2, y_1, y_2 } = this.iirState;
    const filteredFrame = new Float32Array(this.inputAudioFrameSize);
    for (let i = 0; i < this.inputAudioFrameSize; i++) {
      filteredFrame[i] = inputAudioFrame[i] * b0 + x_1 * b1 + x_2 * b2 - y_1 * a1 - y_2 * a2;
      x_2 = x_1;
      x_1 = inputAudioFrame[i];
      y_2 = y_1;
      y_1 = filteredFrame[i];
    }
    this.iirState = { x_1, x_2, y_1, y_2 };
    for (let i = 0; i < this.downsampledInputAudioFrame.length; i++) {
      this.downsampledInputAudioFrame[i] = filteredFrame[i * this.downsampleFactor];
    }
  }
  calculateChromagram() {
    this.calculateMagnitudeSpectrum();
    const divisorRatio = (this.samplingFrequency / this.downsampleFactor) / this.bufferSize;
    for (let n = 0; n < 12; n++) {
      let chromaSum = 0;
      for (let octave = 1; octave <= this.numOctaves; octave++) {
        let noteSum = 0;
        for (let harmonic = 1; harmonic <= this.numHarmonics; harmonic++) {
          const centerBin = this.round((this.noteFrequencies[n] * octave * harmonic) / divisorRatio);
          const minBin = centerBin - (this.numBinsToSearch * harmonic);
          const maxBin = centerBin + (this.numBinsToSearch * harmonic);
          let maxVal = 0;
          for (let k = minBin; k < maxBin; k++) {
            if (k >= 0 && k < this.magnitudeSpectrum.length) {
              if (this.magnitudeSpectrum[k] > maxVal) {
                maxVal = this.magnitudeSpectrum[k];
              }
            }
          }
          noteSum += maxVal / harmonic;
        }
        chromaSum += noteSum;
      }
      this.chromagram[n] = chromaSum;
    }
    this.chromaReady = true;
  }
  calculateMagnitudeSpectrum() {
    const windowed = new Float32Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize; i++) {
      windowed[i] = this.buffer[i] * this.window[i];
    }
    const { real, imag } = this.fft.forward(windowed);
    for (let i = 0; i < this.magnitudeSpectrum.length; i++) {
      this.magnitudeSpectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
  }
  makeHammingWindow() {
    for (let n = 0; n < this.bufferSize; n++) {
      this.window[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / this.bufferSize);
    }
  }
  round(val) {
    return Math.floor(val + 0.5);
  }
  getChromagram() {
    return this.chromagram;
  }
  isReady() {
    return this.chromaReady;
  }
}
// ===================== FIM Chromagram.js =====================

// ===================== INÍCIO FFT (usado por Chromagram) =====================
class FFT {
  constructor(bufferSize) {
    this.bufferSize = bufferSize;
    this.spectrum = new Float32Array(bufferSize / 2);
    this.real = new Float32Array(bufferSize);
    this.imag = new Float32Array(bufferSize);
    this.reverseTable = new Uint32Array(bufferSize);
    this.buildReverseTable();
    this.sinTable = new Float32Array(bufferSize);
    this.cosTable = new Float32Array(bufferSize);
    for (let i = 0; i < bufferSize; i++) {
      this.sinTable[i] = Math.sin(-Math.PI / i);
      this.cosTable[i] = Math.cos(-Math.PI / i);
    }
  }
  buildReverseTable() {
    const bufferSize = this.bufferSize;
    let limit = 1;
    let bit = bufferSize >> 1;
    while (limit < bufferSize) {
      for (let i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit;
      }
      limit = limit << 1;
      bit = bit >> 1;
    }
  }
  forward(buffer) {
    const bufferSize = this.bufferSize;
    const real = this.real;
    const imag = this.imag;
    for (let i = 0; i < bufferSize; i++) {
      real[i] = buffer[this.reverseTable[i]];
      imag[i] = 0;
    }
    let halfSize = 1;
    while (halfSize < bufferSize) {
      const phaseShiftStepReal = Math.cos(-Math.PI / halfSize);
      const phaseShiftStepImag = Math.sin(-Math.PI / halfSize);
      let currentPhaseShiftReal = 1;
      let currentPhaseShiftImag = 0;
      for (let fftStep = 0; fftStep < halfSize; fftStep++) {
        let i = fftStep;
        while (i < bufferSize) {
          const off = i + halfSize;
          const tr = currentPhaseShiftReal * real[off] - currentPhaseShiftImag * imag[off];
          const ti = currentPhaseShiftReal * imag[off] + currentPhaseShiftImag * real[off];
          real[off] = real[i] - tr;
          imag[off] = imag[i] - ti;
          real[i] += tr;
          imag[i] += ti;
          i += halfSize << 1;
        }
        const tmpReal = currentPhaseShiftReal;
        currentPhaseShiftReal = tmpReal * phaseShiftStepReal - currentPhaseShiftImag * phaseShiftStepImag;
        currentPhaseShiftImag = tmpReal * phaseShiftStepImag + currentPhaseShiftImag * phaseShiftStepReal;
      }
      halfSize = halfSize << 1;
    }
    return { real: real.slice(0, bufferSize / 2 + 1), imag: imag.slice(0, bufferSize / 2 + 1) };
  }
}
// ===================== FIM FFT =====================

// ===================== INÍCIO ChordDetector.js =====================
const QUALITIES = { Major: 'major' };
const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B'
];
class ChordDetector {
  constructor() {
    this.bias = 1.16;
    this.rootNote = null;
    this.quality = null;
    this.intervals = 0;
    this.chordName = '';
    this.chromagram = new Array(12).fill(0);
    this.chord = new Array(12).fill(0);
    this.chordProfiles = Array.from({ length: 12 }, () => new Array(12).fill(0));
    this.makeChordProfiles();
    this.chromaBuffer = [];
    this.chromaBufferSize = 95;
    this.lastDetectionTime = 0;
    this.detectionIntervalMs = 350;
  }
  detectChord(chroma) {
    this.chromaBuffer.push([...chroma]);
    if (this.chromaBuffer.length > this.chromaBufferSize) this.chromaBuffer.shift();
    const now = Date.now();
    if (now - this.lastDetectionTime >= this.detectionIntervalMs) {
      const avgChroma = new Array(12).fill(0);
      for (const c of this.chromaBuffer) for (let i = 0; i < 12; i++) avgChroma[i] += c[i];
      for (let i = 0; i < 12; i++) avgChroma[i] /= this.chromaBuffer.length;
      const chromaEnergy = avgChroma.reduce((a, b) => a + b, 0);
      const MIN_CHORD_ENERGY = 75;
      const sorted = [...avgChroma].map((v, i) => ({v, i})).sort((a, b) => b.v - a.v);
      const maxVal = sorted[0].v;
      const maxIdx = sorted[0].i;
      const secondVal = sorted[1].v;
      const ISOLATED_NOTE_FACTOR = 3;
      const ISOLATED_NOTE_THRESHOLD = 0.1;
      if (maxVal > ISOLATED_NOTE_THRESHOLD && maxVal > ISOLATED_NOTE_FACTOR * secondVal) {
        this.rootNote = maxIdx;
        this.quality = QUALITIES.Major;
        this.intervals = 0;
        this.lastDetectionTime = now;
        return;
      }
      if (chromaEnergy < MIN_CHORD_ENERGY) {
        this.rootNote = null;
        this.quality = null;
        this.intervals = 0;
        this.lastDetectionTime = now;
        return;
      }
      this.classifyChromagram(avgChroma);
      this.lastDetectionTime = now;
    }
  }
  getChordName() {
    if (this.rootNote === null || this.quality === null) return 'Nada';
    let name = NOTE_NAMES[this.rootNote];
    return name;
  }
  classifyChromagram(chromaVec) {
    let chroma = chromaVec ? [...chromaVec] : [...this.chromagram];
    const sorted = [...chroma].map((v, i) => ({v, i})).sort((a, b) => b.v - a.v);
    const maxVal = sorted[0].v;
    const maxIdx = sorted[0].i;
    const secondVal = sorted[1].v;
    const ISOLATED_NOTE_FACTOR = 3;
    const ISOLATED_NOTE_THRESHOLD = 0.1;
    if (maxVal > ISOLATED_NOTE_THRESHOLD && maxVal > ISOLATED_NOTE_FACTOR * secondVal) {
      this.rootNote = maxIdx;
      this.quality = QUALITIES.Major;
      this.intervals = 0;
      return;
    }
    for (let i = 0; i < 12; i++) {
      const fifth = (i + 7) % 12;
      chroma[fifth] -= 0.1 * chroma[i];
      if (chroma[fifth] < 0) chroma[fifth] = 0;
    }
    for (let j = 0; j < 12; j++) {
      this.chord[j] = this.calculateChordScore(chroma, this.chordProfiles[j], this.bias, 3);
    }
    const chordindex = this.minimumIndex(this.chord, 12);
    if (chordindex < 12) {
      this.rootNote = chordindex;
      this.quality = QUALITIES.Major;
      this.intervals = 0;
    } else {
      this.rootNote = null;
      this.quality = null;
      this.intervals = 0;
    }
  }
  calculateChordScore(chroma, chordProfile, biasToUse, N) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += (1 - chordProfile[i]) * (chroma[i] * chroma[i]);
    }
    const delta = Math.sqrt(sum) / ((12 - N) * biasToUse);
    return delta;
  }
  minimumIndex(array, arrayLength) {
    let minValue = 1e6;
    let minIndex = 0;
    for (let i = 0; i < arrayLength; i++) {
      if (array[i] < minValue) {
        minValue = array[i];
        minIndex = i;
      }
    }
    return minIndex;
  }
  makeChordProfiles() {
    let j = 0;
    const v1 = 1, v2 = 1, v3 = 1;
    for (j = 0; j < 12; j++) {
      for (let t = 0; t < 12; t++) {
        this.chordProfiles[j][t] = 0;
      }
    }
    j = 0;
    for (let i = 0; i < 12; i++, j++) {
      this.chordProfiles[j][i % 12] = v1;
      this.chordProfiles[j][(i + 4) % 12] = v2;
      this.chordProfiles[j][(i + 7) % 12] = v3;
    }
  }
}
// ===================== FIM ChordDetector.js =====================

// ===================== INÍCIO content.js principal =====================
let cifraLines = [];
let isTracking = false;
let audioContext, analyser, source, chromagram, chordDetector, listenAnimationId;
let capoFret = null;

// Variáveis de acompanhamento
let currentLineIndex = 0;
let currentChordIndex = 0;
let aguardandoPrimeiroAcorde = true;
let timeoutId = null;
let ultimoAcordeDetectado = null;
let timestampUltimaAusencia = null;
let timestampUltimoAcordeTocado = null;
let aguardandoProximaLinha = false;
let timestampAguardandoProximaLinha = null;

const MAX_PULO_ACORDES = 2;

function detectCapoFret() {
  const capoSpan = document.getElementById('cifra_capo');
  if (capoSpan) {
    const match = capoSpan.innerText.match(/(\d+)ª casa/);
    capoFret = match ? parseInt(match[1], 10) : null;
    console.log('Capo:', capoFret);
  } else {
    capoFret = null;
  }
}

function injectControlElements() {
  // Cria o container
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed', bottom: '0', left: '0', zIndex: 9999,
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    gap: '5px', padding: '0 5px 5px 5px', background: 'none',
  });

  // Botão
  const btn = document.createElement('button');
  btn.id = 'tracking-btn';
  btn.innerText = 'Começar';
  Object.assign(btn.style, {
    height: '32px', minWidth: '80px', padding: '0 12px',
    backgroundColor: '#1565c0', color: '#fff',
    border: 'none', borderRadius: '8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '15px', fontWeight: 'bold', cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
  });

  // Info
  const info = document.createElement('div');
  info.id = 'chord-info';
  info.innerText = 'Acorde detectado: --';
  Object.assign(info.style, {
    height: '32px', minWidth: '160px', padding: '0 12px',
    backgroundColor: '#eee', border: '1px solid #ccc',
    borderRadius: '8px', fontSize: '15px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 'bold', color: '#222',
  });

  container.appendChild(btn);
  container.appendChild(info);
  document.body.appendChild(container);

  btn.onclick = async () => {
    if (isTracking) {
      stopTracking();
      stopAudioDetection();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startTracking();
        startAudioDetection(stream);
      } catch {
        alert('Permissão de microfone negada. Libere nas configurações.');
      }
    }
  };
}

function parseCifraLines() {
  const pre = document.querySelector('.cifra_cnt pre');
  if (!pre) return [];
  const chords = Array.from(pre.querySelectorAll('b')).filter(b => !b.closest('.tablatura'));
  const tops = new Map();
  chords.forEach(chord => {
    const top = chord.getBoundingClientRect().top;
    if (!tops.has(top)) tops.set(top, []);
    tops.get(top).push(chord);
  });
  // Transforma cada acorde em objeto { el, tocado }
  return Array.from(tops.values()).map(line => line.map(el => ({ el, tocado: false })));
}

function highlightLine(lineIdx) {
  cifraLines.forEach((line, i) => {
    line.forEach((acordeObj, j) => {
      if (i === lineIdx) {
        Object.assign(acordeObj.el.style, {
          backgroundColor: acordeObj.tocado ? '#1565c0' : '#1565c0', //TROCAR COR
          color: '#fff',
          borderRadius: '4px',
          padding: '0px 4px'
        });
      } else {
        Object.assign(acordeObj.el.style, {
          backgroundColor: '',
          color: '',
          borderRadius: '',
          padding: ''
        });
      }
    });
  });
  // SCROLL SUAVE PARA A LINHA ATUAL
  const linha = cifraLines[lineIdx];
  if (linha && linha.length > 0) {
    const el = linha[0].el;
    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY + rect.top - window.innerHeight * 0.5;
    window.scrollTo({ top: scrollY, behavior: 'smooth' });
  }
}

function updateChordInfo(detected) {
  const info = document.getElementById('chord-info');
  if (capoFret && capoFret > 0 && detected && detected !== 'Nada') {
    // Mostra o acorde detectado real e o transposto
    const transposto = transporAcorde(detected, -capoFret);
    info.innerText = `Acorde detectado: ${detected} (${transposto} com capo ${capoFret})`;
  } else {
    info.innerText = `Acorde detectado: ${detected || '--'}`;
  }
}

function acordeCorresponde(detectado, cifra) {
  if (!detectado || !cifra) return false;
  // Se houver capo, transpõe o acorde detectado para trás capoFret semitons
  let detectadoTransposto = detectado;
  if (capoFret && capoFret > 0) {
    detectadoTransposto = transporAcorde(detectado, -capoFret);
  }
  return cifra.toUpperCase().includes(detectadoTransposto.toUpperCase()) || detectadoTransposto.toUpperCase().includes(cifra.toUpperCase());
}

// Função para transpor acordes maiores (ex: A, G, F#) para cima/baixo de acordo com o capo
function transporAcorde(acorde, semitons) {
  const notas = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  // Extrai a nota base (ex: A de A7, G de Gm)
  const match = acorde.match(/^([A-G]#?)/i);
  if (!match) return acorde;
  const nota = match[1].toUpperCase();
  const idx = notas.indexOf(nota);
  if (idx === -1) return acorde;
  let novoIdx = (idx + semitons) % 12;
  if (novoIdx < 0) novoIdx += 12;
  // Substitui a nota base pela transposta
  return acorde.replace(/^([A-G]#?)/i, notas[novoIdx]);
}

function avancarAcorde(forced = false) {
  const linha = cifraLines[currentLineIndex] || [];
  if (linha[currentChordIndex]) linha[currentChordIndex].tocado = true;
  currentChordIndex++;
  if (currentChordIndex >= linha.length) {
    // Ao chegar no último acorde, entra em modo aguardando próxima linha
    currentChordIndex = linha.length - 1;
    aguardandoProximaLinha = true;
    timestampAguardandoProximaLinha = Date.now();
    highlightLine(currentLineIndex);
    return;
  }
  if (currentLineIndex < cifraLines.length) {
    highlightLine(currentLineIndex);
    if (!forced) resetarTimer();
  } else {
    stopTracking();
  }
}

function resetarTimer() {
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = setTimeout(() => {
    avancarAcorde(true);
    timestampUltimoAcordeTocado = Date.now();
  }, 7000);
}

function enableAcordeClickNavigation() {
  cifraLines.forEach((line, i) => {
    line.forEach((acordeObj, j) => {
      acordeObj.el.onclick = () => {
        // Marca todos os anteriores como tocados
        for (let l = 0; l < cifraLines.length; l++) {
          for (let a = 0; a < cifraLines[l].length; a++) {
            cifraLines[l][a].tocado = (l < i) || (l === i && a <= j);
          }
        }
        currentLineIndex = i;
        currentChordIndex = j;
        aguardandoPrimeiroAcorde = false; // Garante que não volta para o início
        aguardandoProximaLinha = false;
        timestampAguardandoProximaLinha = null;
        highlightLine(currentLineIndex);
        // Reinicia timer e acompanhamento a partir daqui
        if (isTracking) {
          if (timeoutId) clearTimeout(timeoutId);
          timestampUltimoAcordeTocado = Date.now();
          resetarTimer();
        }
      };
    });
  });
}

function disableAcordeClickNavigation() {
  cifraLines.forEach(line => line.forEach(acordeObj => {
    acordeObj.el.onclick = null;
  }));
}

function startTracking() {
  cifraLines = parseCifraLines();
  isTracking = true;
  currentLineIndex = 0;
  currentChordIndex = 0;
  aguardandoPrimeiroAcorde = true;
  ultimoAcordeDetectado = null;
  timestampUltimaAusencia = null;
  timestampUltimoAcordeTocado = null;
  aguardandoProximaLinha = false;
  timestampAguardandoProximaLinha = null;
  cifraLines.forEach(line => line.forEach(a => a.tocado = false));
  document.getElementById('tracking-btn').innerText = 'Parar';
  document.getElementById('tracking-btn').style.backgroundColor = '#2e7d32';
  highlightLine(currentLineIndex);
  enableAcordeClickNavigation();
}

function stopTracking() {
  isTracking = false;
  if (timeoutId) clearTimeout(timeoutId);
  document.getElementById('tracking-btn').innerText = 'Começar';
  document.getElementById('tracking-btn').style.backgroundColor = '#1565c0';
  updateChordInfo('--');
  stopAudioDetection();
  currentLineIndex = 0;
  currentChordIndex = 0;
  aguardandoPrimeiroAcorde = true;
  ultimoAcordeDetectado = null;
  timestampUltimaAusencia = null;
  timestampUltimoAcordeTocado = null;
  aguardandoProximaLinha = false;
  timestampAguardandoProximaLinha = null;
  capoFret = null;
  cifraLines.forEach(line => line.forEach(a => {
    a.tocado = false;
    Object.assign(a.el.style, {
      backgroundColor: '',
      color: '',
      borderRadius: '',
      padding: ''
    });
  }));
  disableAcordeClickNavigation();
}

function getProximosAcordes(idxLinha, idxAcorde, maxPulo) {
  // Retorna um array de objetos {linha, acorde, obj} dos próximos maxPulo acordes
  const result = [];
  let l = idxLinha;
  let a = idxAcorde + 1;
  while (result.length < maxPulo && l < cifraLines.length) {
    const linha = cifraLines[l];
    while (a < linha.length && result.length < maxPulo) {
      result.push({ linha: l, acorde: a, obj: linha[a] });
      a++;
    }
    l++;
    a = 0;
  }
  return result;
}

function startAudioDetection(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 8192;
  source.connect(analyser);
  chromagram = new Chromagram(analyser, audioContext.sampleRate);
  chordDetector = new ChordDetector();

  function loop() {
    if (!isTracking) return;
    chromagram.update();
    if (chromagram.isReady()) {
      const chroma = chromagram.getChromagram();
      chordDetector.detectChord(chroma);
      const detectado = chordDetector.getChordName();
      updateChordInfo(detectado);
      if (!detectado || detectado === 'Nada') return listenAnimationId = requestAnimationFrame(loop);
      const linhaAtual = cifraLines[currentLineIndex] || [];
      const acordeEsperado = linhaAtual[currentChordIndex]?.el.textContent.trim();
      // 1. Espera o primeiro acorde correto OU permite pulo dos primeiros acordes
      if (aguardandoPrimeiroAcorde) {
        highlightLine(currentLineIndex);
        const agora = Date.now();
        // Tocar o primeiro acorde
        if (acordeCorresponde(detectado, acordeEsperado)) {
          aguardandoPrimeiroAcorde = false;
          timestampUltimoAcordeTocado = agora;
          resetarTimer();
          return listenAnimationId = requestAnimationFrame(loop);
        }
        // Pulo dos primeiros acordes (até MAX_PULO_ACORDES)
        let idxLinha = currentLineIndex;
        let idxAcorde = currentChordIndex;
        const proximos = getProximosAcordes(idxLinha, idxAcorde, MAX_PULO_ACORDES);
        for (let pulo = 1; pulo <= proximos.length; pulo++) {
          const prox = proximos[pulo - 1];
          if (acordeCorresponde(detectado, prox.obj.el.textContent.trim())) {
            const tolerancia = pulo * 1000;
            if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > tolerancia) {
              // Marca todos os anteriores como tocados
              let l = currentLineIndex, a = currentChordIndex;
              for (let i = 0; i < pulo; i++) {
                if (a >= cifraLines[l].length) { l++; a = 0; }
                if (l < cifraLines.length && a < cifraLines[l].length) {
                  cifraLines[l][a].tocado = true;
                  a++;
                }
              }
              // Atualiza índices
              currentLineIndex = prox.linha;
              currentChordIndex = prox.acorde;
              aguardandoPrimeiroAcorde = false;
              timestampUltimoAcordeTocado = agora;
              highlightLine(currentLineIndex);
              resetarTimer();
              return listenAnimationId = requestAnimationFrame(loop);
            }
          }
        }
        return listenAnimationId = requestAnimationFrame(loop);
      }
      const agora = Date.now();
      // 2. Se detectou o acorde esperado, avança normalmente (tolerância 1s)
      if (!aguardandoProximaLinha && acordeCorresponde(detectado, acordeEsperado)) {
        if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > 500) {
          avancarAcorde();
          timestampUltimoAcordeTocado = agora;
        }
        return listenAnimationId = requestAnimationFrame(loop);
      }
      // 3. Tolerância para pulo de até MAX_PULO_ACORDES acordes (mesma linha ou atravessando linhas)
      if (!aguardandoProximaLinha) {
        const proximos = getProximosAcordes(currentLineIndex, currentChordIndex, MAX_PULO_ACORDES);
        for (let pulo = 1; pulo <= proximos.length; pulo++) {
          const prox = proximos[pulo - 1];
          if (acordeCorresponde(detectado, prox.obj.el.textContent.trim())) {
            const tolerancia = pulo * 1500;
            if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > tolerancia) {
              for (let i = 0; i < pulo; i++) avancarAcorde();
              timestampUltimoAcordeTocado = agora;
            }
            return listenAnimationId = requestAnimationFrame(loop);
          }
        }
      }
      // 4. Se está aguardando próxima linha, tolerar pulo de até MAX_PULO_ACORDES acordes na(s) próxima(s) linha(s)
      if (aguardandoProximaLinha && currentLineIndex < cifraLines.length - 1) {
        const proximos = getProximosAcordes(currentLineIndex + 1, -1, MAX_PULO_ACORDES);
        for (let pulo = 1; pulo <= proximos.length; pulo++) {
          const prox = proximos[pulo - 1];
          const tolerancia = pulo * 1500;
          if (acordeCorresponde(detectado, prox.obj.el.textContent.trim()) && agora - timestampAguardandoProximaLinha > tolerancia) {
            // Marca todos os anteriores como tocados
            let l = currentLineIndex + 1, a = 0, count = 0;
            while (count < pulo) {
              if (a >= cifraLines[l].length) { l++; a = 0; }
              if (l < cifraLines.length && a < cifraLines[l].length) {
                cifraLines[l][a].tocado = true;
                a++; count++;
              } else {
                break;
              }
            }
            currentLineIndex = prox.linha;
            currentChordIndex = prox.acorde;
            aguardandoProximaLinha = false;
            timestampAguardandoProximaLinha = null;
            highlightLine(currentLineIndex);
            timestampUltimoAcordeTocado = agora;
            resetarTimer();
            return listenAnimationId = requestAnimationFrame(loop);
          }
        }
      }
      ultimoAcordeDetectado = detectado;
    }
    listenAnimationId = requestAnimationFrame(loop);
  }
  loop();
}

function stopAudioDetection() {
  if (audioContext) audioContext.close();
  cancelAnimationFrame(listenAnimationId);
  chromagram = null;
  chordDetector = null;
}

// Detecta o capo ao carregar
detectCapoFret();

injectControlElements();
// ===================== FIM content.js principal =====================