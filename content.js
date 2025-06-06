class Chromagram {
  constructor(analyserNode, sampleRate = 44100) {
    this.referenceFrequency = 130.81278265;
    this.bufferSize = 8192;
    this.numHarmonics = 4;
    this.numOctaves = 2;
    this.numBinsToSearch = 2;
    this.chromaCalculationInterval = 4096;
    this.noteFrequencies = Array.from({ length: 12 }, (_, i) =>
      this.referenceFrequency * Math.pow(2, i / 12)
    );
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferWritePos = 0;
    this.numSamplesSinceLastCalculation = 0;
    this.fftSize = this.bufferSize;
    this.fft = new FFT(this.fftSize);
    this.magnitudeSpectrum = new Float32Array(this.bufferSize / 2 + 1);
    this.window = this.createBlackmanHarrisWindow();
    this.chromagram = new Float32Array(12);
    this.chromaReady = false;
    this.downsampleFactor = 4;
    this.inputAudioFrameSize = analyserNode.fftSize;
    this.downsampledInputAudioFrame = new Float32Array(
      Math.floor(this.inputAudioFrameSize / this.downsampleFactor)
    );
    this.downSampledAudioFrameSize = this.downsampledInputAudioFrame.length;
    this.iirCoeffs = { b0: 0.2929, b1: 0.5858, b2: 0.2929, a1: 0, a2: 0.1716 };
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
    this.buffer.copyWithin(0, shift);
    this.buffer.set(this.downsampledInputAudioFrame, this.bufferSize - shift);
    this.numSamplesSinceLastCalculation += inputAudioFrame.length;
    if (this.numSamplesSinceLastCalculation >= this.chromaCalculationInterval) {
      this.calculateChromagram();
      this.numSamplesSinceLastCalculation = 0;
    }
  }

  downSampleFrame(inputAudioFrame) {
    const { b0, b1, b2, a1, a2 } = this.iirCoeffs;
    let { x_1, x_2, y_1, y_2 } = this.iirState;
    for (let i = 0; i < this.inputAudioFrameSize; i++) {
      const filtered = inputAudioFrame[i] * b0 + x_1 * b1 + x_2 * b2 - y_1 * a1 - y_2 * a2;
      [x_2, x_1] = [x_1, inputAudioFrame[i]];
      [y_2, y_1] = [y_1, filtered];
    }
    this.iirState = { x_1, x_2, y_1, y_2 };
    for (let i = 0; i < this.downsampledInputAudioFrame.length; i++) {
      this.downsampledInputAudioFrame[i] = inputAudioFrame[i * this.downsampleFactor];
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
          const centerBin = Math.round((this.noteFrequencies[n] * octave * harmonic) / divisorRatio);
          const minBin = Math.max(0, centerBin - this.numBinsToSearch * harmonic);
          const maxBin = Math.min(this.magnitudeSpectrum.length - 1, centerBin + this.numBinsToSearch * harmonic);
          let maxVal = 0;
          for (let k = minBin; k <= maxBin; k++) {
            if (this.magnitudeSpectrum[k] > maxVal) maxVal = this.magnitudeSpectrum[k];
          }
          noteSum += (maxVal / harmonic) * Math.pow(0.7, harmonic - 1);
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
      this.magnitudeSpectrum[i] = Math.hypot(real[i], imag[i]);
    }
  }

  createBlackmanHarrisWindow() {
    return Float32Array.from({ length: this.bufferSize }, (_, n) => {
      const a0 = 0.35875;
      const a1 = 0.48829;
      const a2 = 0.14128;
      const a3 = 0.01168;
      const phase = (2 * Math.PI * n) / (this.bufferSize - 1);
      return (
        a0 -
        a1 * Math.cos(phase) +
        a2 * Math.cos(2 * phase) -
        a3 * Math.cos(3 * phase)
      );
    });
  }

  getChromagram() {
    return this.chromagram;
  }

  isReady() {
    return this.chromaReady;
  }
}

class FFT {
  constructor(bufferSize) {
    this.bufferSize = bufferSize;
    this.spectrum = new Float32Array(bufferSize / 2);
    this.real = new Float32Array(bufferSize);
    this.imag = new Float32Array(bufferSize);
    this.reverseTable = this.buildReverseTable(bufferSize);
    [this.sinTable, this.cosTable] = this.buildTrigTables(bufferSize);
  }

  buildReverseTable(size) {
    const table = new Uint32Array(size);
    for (let limit = 1, bit = size >> 1; limit < size; limit <<= 1, bit >>= 1) {
      for (let i = 0; i < limit; i++) {
        table[i + limit] = table[i] + bit;
      }
    }
    return table;
  }

  buildTrigTables(size) {
    const sin = new Float32Array(size);
    const cos = new Float32Array(size);
    for (let i = 1; i < size; i++) {
      sin[i] = Math.sin(-Math.PI / i);
      cos[i] = Math.cos(-Math.PI / i);
    }
    return [sin, cos];
  }

  forward(buffer) {
    const { bufferSize, reverseTable, real, imag } = this;
    reverseTable.forEach((idx, i) => {
      real[i] = buffer[idx];
      imag[i] = 0;
    });
    for (let halfSize = 1; halfSize < bufferSize; halfSize <<= 1) {
      const phaseStep = { real: this.cosTable[halfSize], imag: this.sinTable[halfSize] };
      let phaseShift = { real: 1, imag: 0 };
      for (let step = 0; step < halfSize; step++) {
        for (let i = step; i < bufferSize; i += halfSize * 2) {
          const j = i + halfSize;
          const [tr, ti] = [
            phaseShift.real * real[j] - phaseShift.imag * imag[j],
            phaseShift.real * imag[j] + phaseShift.imag * real[j]
          ];
          real[j] = real[i] - tr;
          imag[j] = imag[i] - ti;
          real[i] += tr;
          imag[i] += ti;
        }
        [phaseShift.real, phaseShift.imag] = [
          phaseShift.real * phaseStep.real - phaseShift.imag * phaseStep.imag,
          phaseShift.real * phaseStep.imag + phaseShift.imag * phaseStep.real
        ];
      }
    }
    return {
      real: real.slice(0, bufferSize / 2 + 1),
      imag: imag.slice(0, bufferSize / 2 + 1)
    };
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_PROFILE = Array.from({ length: 12 }, (_, root) =>
  [root, (root + 4) % 12, (root + 7) % 12].reduce((acc, idx) =>
    (acc[idx] = 1, acc), new Array(12).fill(0))
);

class ChordDetector {
  constructor() {
    this.reset();
    this.bias = 1.05;
    this.chromaBuffer = [];
    this.chromaBufferSize = 100;
    this.detectionIntervalMs = 200;
    this.lastDetectionTime = 0;
    this.stabilityBuffer = [];
    this.stabilityLength = 3;
    this.lastStableChord = null;
    this.tonicaPeso = 2.5;
    this.isArpeggioMode = false;
    this.arpeggioDetectionThreshold = 0.35;
    this.arpeggioWindowSize = 6;
  }

  reset() {
    this.rootNote = null;
    this.quality = 'major';
    this.intervals = 0;
    this.stabilityBuffer = [];
    this.lastStableChord = null;
  }

  detectChord(chroma) {
    this.chromaBuffer.push([...chroma]);
    if (this.chromaBuffer.length > this.chromaBufferSize) this.chromaBuffer.shift();
    const now = Date.now();
    if (now - this.lastDetectionTime < this.detectionIntervalMs) return;
    this.lastDetectionTime = now;
    this.isArpeggioMode = this.detectArpeggioMode();
    const avgChroma = this.calculateAverageChroma();
    if (avgChroma.reduce((sum, val) => sum + val, 0) < 50) {
      this.stabilityBuffer = [];
      this.lastStableChord = null;
      return this.reset();
    }
    if (this.detectIsolatedNote(avgChroma)) {
      this.updateStability(this.rootNote);
      return;
    }
    this.classifyChromagram(avgChroma);
    this.updateStability(this.rootNote);
  }

  detectArpeggioMode() {
    const recent = this.chromaBuffer.slice(-this.arpeggioWindowSize);
    const energies = recent.map(c => c.reduce((a, b) => a + b, 0));
    const minE = Math.min(...energies);
    const maxE = Math.max(...energies);
    return minE > 0 && (maxE / minE) >= this.arpeggioDetectionThreshold && maxE - minE > 5;
  }

  calculateAverageChroma() {
    const alpha = this.isArpeggioMode ? 0.75 : 0.5;
    const avg = this.chromaBuffer[0].slice();
    for (let i = 1; i < this.chromaBuffer.length; i++) {
      for (let j = 0; j < 12; j++) {
        avg[j] = alpha * this.chromaBuffer[i][j] + (1 - alpha) * avg[j];
      }
    }
    return avg;
  }

  detectIsolatedNote(chroma) {
    const sorted = [...chroma].map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]);
    const [[maxIdx, maxVal], [, secondVal]] = [sorted[0], sorted[1]];
    if (maxVal > 0.1 && maxVal > 3 * secondVal) {
      this.rootNote = maxIdx;
      return true;
    }
    return false;
  }

  classifyChromagram(chroma) {
    const modChroma = [...chroma];
    for (let i = 0; i < 12; i++) {
      const fifth = (i + 7) % 12;
      modChroma[fifth] = Math.max(0, modChroma[fifth] - 0.1 * chroma[i]);
    }
    modChroma[11] = Math.max(0, modChroma[11] - 0.4 * (modChroma[4] + modChroma[7]));

    this.chord = CHORD_PROFILE.map((profile, rootIdx) =>
      this.calculateChordScore(modChroma, profile, 3, rootIdx)
    );
    const minScore = Math.min(...this.chord);
    const chordIndex = this.chord.indexOf(minScore);
    this.rootNote = chordIndex < 12 ? chordIndex : null;
  }

  calculateChordScore(chroma, chordProfile, N, rootIdx) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const peso = (i === rootIdx) ? this.tonicaPeso : 1;
      sum += (1 - chordProfile[i]) * (chroma[i] * chroma[i]) * peso;
    }
    return Math.sqrt(sum) / ((12 - N) * this.bias);
  }

  updateStability(rootNote) {
    const len = this.isArpeggioMode ? this.stabilityLength + 2 : this.stabilityLength;
    this.stabilityBuffer.push(rootNote);
    if (this.stabilityBuffer.length > len) this.stabilityBuffer.shift();
    const countMap = {};
    for (const c of this.stabilityBuffer) {
      if (c !== null) countMap[c] = (countMap[c] || 0) + 1;
    }
    const stable = Object.entries(countMap).sort((a, b) => b[1] - a[1])[0];
    if (stable && stable[1] >= Math.ceil(len / 2)) {
      this.lastStableChord = parseInt(stable[0]);
    }
  }

  getChordName() {
    if (this.lastStableChord === 11) {
      const chroma = this.chromaBuffer[this.chromaBuffer.length - 1];
      const lowEnergy = chroma[4] + chroma[7];
      if (lowEnergy > chroma[11] * 1.2) return 'Nada';
    }
    return this.lastStableChord === null ? 'Nada' : NOTE_NAMES[this.lastStableChord];
  }
}
// ===================== FIM CHORDDETECTOR =====================

let cifraLines = [], isTracking = false;
let audioContext, analyser, source, chromagram, chordDetector;
let currentLineIndex = 0, currentChordIndex = 0;
let detectionBuffer = [], confirmedChord = null, capoFret = null;

const BUFFER_SIZE = 7, CHORD_CONFIRMATION_THRESHOLD = 0.6;

const transporAcorde = (acorde, semitons) => {
  const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const match = acorde.match(/^([A-G]#?)/i);
  if (!match) return acorde;
  let idx = (notas.indexOf(match[1].toUpperCase()) + semitons + 12) % 12;
  return acorde.replace(/^([A-G]#?)/i, notas[idx]);
};

const acordeCorresponde = (detectado, cifra) => {
  if (!detectado || !cifra) return false;
  const normalize = s => s.replace(/min|MIN/, 'm').replace('maj', '');
  const comCapo = capoFret ? transporAcorde(detectado, -parseInt(capoFret)) : detectado;
  return normalize(cifra).toUpperCase().includes(normalize(comCapo).toUpperCase());
};

const parseCifraLines = () => {
  const pre = document.querySelector('.cifra_cnt pre') || document.querySelector('pre');
  const selector = pre?.querySelectorAll('b') ?? [];
  const tops = new Map();

  selector.forEach(el => {
    if (el.closest('span.tablatura')) return;
    const top = el.getBoundingClientRect().top;
    if (!tops.has(top)) tops.set(top, []);
    tops.get(top).push(el);
  });

  return Array.from(tops.values()).map(line => line.map(el => ({ el, tocado: false })));
};

const aplicarEstilo = (el, cor) => {
  Object.assign(el.style, {
    backgroundColor: cor,
    color: '#fff',
    borderRadius: '4px',
    padding: '0 4px'
  });
};

const highlightLine = (i) => {
  cifraLines.forEach((line, li) =>
    line.forEach(a => {
      a.el.style = '';
      if (li === i) aplicarEstilo(a.el, a.tocado ? '#ff9800' : '#2196f3');
    })
  );

  const rect = cifraLines[i]?.[0]?.el?.getBoundingClientRect();
  if (rect) window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.5, behavior: 'smooth' });
};

const updateChordInfo = (detected) => {
  const info = document.getElementById('chord-info');
  const transposto = capoFret && detected && detected !== 'Nada' ? ` (sem capo: ${transporAcorde(detected, -capoFret)})` : '';
  info.innerText = `Detectado: ${detected || '--'}${transposto}`;
};

const updateDetectionBuffer = (chord) => {
  detectionBuffer.push(chord);
  if (detectionBuffer.length > BUFFER_SIZE) detectionBuffer.shift();
  const freq = detectionBuffer.reduce((acc, c) => (c ? (acc[c] = (acc[c] || 0) + 1, acc) : acc), {});
  const [melhor, contagem] = Object.entries(freq).reduce((a, b) => a[1] > b[1] ? a : b, ['', 0]);
  if (contagem / BUFFER_SIZE >= CHORD_CONFIRMATION_THRESHOLD) {
    confirmedChord = melhor;
    return true;
  }
  return false;
};

const startTracking = () => {
  cifraLines = parseCifraLines();
  isTracking = true;
  currentLineIndex = currentChordIndex = 0;
  detectionBuffer = [], confirmedChord = null;
  document.getElementById('tracking-btn').innerText = 'Parar';
  document.getElementById('tracking-btn').style.backgroundColor = '#2e7d32';
  cifraLines.forEach(line => line.forEach(a => a.tocado = false));
  highlightLine(currentLineIndex);
};

const stopTracking = () => {
  isTracking = false;
  document.getElementById('tracking-btn').innerText = 'Começar';
  document.getElementById('tracking-btn').style.backgroundColor = '#1565c0';
  cifraLines.forEach(l => l.forEach(a => a.el.style = ''));
  cifraLines = [];
  stopAudioDetection();
};

const startAudioDetection = (stream) => {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 8192;
  source.connect(analyser);
  chromagram = new Chromagram(analyser, audioContext.sampleRate);
  chordDetector = new ChordDetector();

  const loop = () => {
    if (!isTracking) return;
    chromagram.update();

    if (chromagram.isReady()) {
      chordDetector.detectChord(chromagram.getChromagram());
      let chord = chordDetector.getChordName();
      updateChordInfo(chord);
      if (!chord || chord === 'Nada') return requestAnimationFrame(loop);
      if (!updateDetectionBuffer(chord)) return requestAnimationFrame(loop);

      const detectado = confirmedChord;
      const linhaAtual = cifraLines[currentLineIndex];
      const acordeAtual = linhaAtual[currentChordIndex]?.el?.textContent?.trim();

      if (acordeCorresponde(detectado, acordeAtual)) {
        linhaAtual[currentChordIndex].tocado = true;
        currentChordIndex++;
        highlightLine(currentLineIndex);
      }

      const todosTocados = linhaAtual.every(a => a.tocado);
      const proxima = cifraLines[currentLineIndex + 1];
      const proxAcorde = proxima?.[0]?.el?.textContent?.trim();

      if (todosTocados && proxima && acordeCorresponde(detectado, proxAcorde)) {
        currentLineIndex++;
        currentChordIndex = 1;
        proxima[0].tocado = true;
        highlightLine(currentLineIndex);
      }
    }

    requestAnimationFrame(loop);
  };

  loop();
};

const stopAudioDetection = () => {
  audioContext?.close();
  chromagram = chordDetector = null;
};

const injectControlElements = () => {
  const css = (el, styles) => Object.assign(el.style, styles);

  const btn = Object.assign(document.createElement('button'), { id: 'tracking-btn', innerText: 'Começar' });
  css(btn, {
    height: '32px', minWidth: '80px', backgroundColor: '#1565c0',
    color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer'
  });

  const info = Object.assign(document.createElement('div'), { id: 'chord-info', innerText: 'Detectado: --' });
  css(info, {
    height: '32px', minWidth: '160px', backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6', borderRadius: '8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  });

  const container = document.createElement('div');
  css(container, {
    position: 'fixed', bottom: '0', left: '0', zIndex: 9999,
    display: 'flex', gap: '5px', padding: '5px'
  });

  container.append(btn, info);
  document.body.append(container);

  btn.onclick = async () => {
    if (isTracking) stopTracking();
    else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startTracking();
        startAudioDetection(stream);
      } catch {
        alert('Permissão de microfone negada.');
      }
    }
  };
};

const detectCapoFret = () => {
  capoFret = null;
  const capoMatch = txt => txt?.match(/(\d+)ª\s*casa/);
  const tryGet = txt => parseInt(capoMatch(txt)?.[1]);

  const capoSpan = document.querySelector('#cifra_capo[data-cy="song-capo"]');
  if (capoSpan) return capoFret = tryGet(capoSpan.innerText);

  for (const span of document.querySelectorAll('span')) {
    if (!span.textContent.includes('Capotraste na')) continue;
    const texto = span.querySelector('b')?.innerText || span.querySelector('a')?.innerText;
    if (texto) return capoFret = tryGet(texto);
  }
};

// Inicialização
detectCapoFret();
injectControlElements();
