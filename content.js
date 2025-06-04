class Chromagram {
  constructor(analyserNode, sampleRate = 44100) {
    // Configurações fundamentais
    this.referenceFrequency = 130.81278265;
    this.bufferSize = 8192;
    this.numHarmonics = 2;
    this.numOctaves = 2;
    this.numBinsToSearch = 2;
    this.chromaCalculationInterval = 4096;
    
    // Frequências das notas
    this.noteFrequencies = Array.from({ length: 12 }, (_, i) => 
      this.referenceFrequency * Math.pow(2, i / 12)
    );
    
    // Buffers e estado
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferWritePos = 0;
    this.numSamplesSinceLastCalculation = 0;
    
    // Processamento FFT
    this.fftSize = this.bufferSize;
    this.fft = new FFT(this.fftSize);
    this.magnitudeSpectrum = new Float32Array(this.bufferSize / 2 + 1);
    
    // Janelamento
    this.window = this.createHammingWindow();
    
    // Saída
    this.chromagram = new Float32Array(12);
    this.chromaReady = false;
    
    // Downsampling
    this.downsampleFactor = 4;
    this.inputAudioFrameSize = analyserNode.fftSize;
    this.downsampledInputAudioFrame = new Float32Array(
      Math.floor(this.inputAudioFrameSize / this.downsampleFactor)
    );
    this.downSampledAudioFrameSize = this.downsampledInputAudioFrame.length;
    
    // Filtro IIR
    this.iirCoeffs = { b0: 0.2929, b1: 0.5858, b2: 0.2929, a1: 0, a2: 0.1716 };
    this.iirState = { x_1: 0, x_2: 0, y_1: 0, y_2: 0 };
    
    // Dependências externas
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
    
    // Desloca o buffer
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
    
    // Filtragem IIR
    for (let i = 0; i < this.inputAudioFrameSize; i++) {
      const filtered = inputAudioFrame[i] * b0 + x_1 * b1 + x_2 * b2 - y_1 * a1 - y_2 * a2;
      [x_2, x_1] = [x_1, inputAudioFrame[i]];
      [y_2, y_1] = [y_1, filtered];
    }
    this.iirState = { x_1, x_2, y_1, y_2 };
    
    // Downsampling
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
      this.magnitudeSpectrum[i] = Math.hypot(real[i], imag[i]);
    }
  }

  createHammingWindow() {
    return Float32Array.from({ length: this.bufferSize }, (_, n) => 
      0.54 - 0.46 * Math.cos((2 * Math.PI * n) / this.bufferSize)
    );
  }

  getChromagram() {
    return this.chromagram;
  }

  isReady() {
    return this.chromaReady;
  }
}

// ===================== FFT SIMPLIFICADA =====================
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
    
    // Preenche os buffers real e imaginário
    reverseTable.forEach((idx, i) => {
      real[i] = buffer[idx];
      imag[i] = 0;
    });

    // Executa o algoritmo FFT
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
        
        // Atualiza o fator de fase
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
// ===================== FIM FFT =====================

// ===================== CHORDDETECTOR SIMPLIFICADO =====================
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_PROFILE = Array.from({ length: 12 }, (_, root) => 
  [root, (root + 4) % 12, (root + 7) % 12].reduce((acc, idx) => 
    (acc[idx] = 1, acc), new Array(12).fill(0))
);

class ChordDetector {
  constructor() {
    this.reset();
    this.bias = 1.16;
    this.chromaBuffer = [];
    this.chromaBufferSize = 95;
    this.detectionIntervalMs = 350;
  }

  reset() {
    this.rootNote = null;
    this.quality = 'major';
    this.intervals = 0;
  }

  detectChord(chroma) {
    // Atualiza o buffer de croma
    this.chromaBuffer.push([...chroma]);
    if (this.chromaBuffer.length > this.chromaBufferSize) this.chromaBuffer.shift();
    
    // Verifica intervalo de detecção
    const now = Date.now();
    if (now - this.lastDetectionTime < this.detectionIntervalMs) return;
    this.lastDetectionTime = now;
    
    // Calcula croma médio
    const avgChroma = this.calculateAverageChroma();
    
    // Verifica energia mínima
    if (avgChroma.reduce((sum, val) => sum + val, 0) < 75) {
      return this.reset();
    }
    
    // Tenta detecção de nota isolada
    if (this.detectIsolatedNote(avgChroma)) return;
    
    // Classificação completa do acorde
    this.classifyChromagram(avgChroma);
  }

  calculateAverageChroma() {
    const avg = new Array(12).fill(0);
    this.chromaBuffer.forEach(c => c.forEach((val, i) => avg[i] += val));
    return avg.map(val => val / this.chromaBuffer.length);
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
    // Cria cópia modificada do croma
    const modChroma = [...chroma];
    for (let i = 0; i < 12; i++) {
      const fifth = (i + 7) % 12;
      modChroma[fifth] = Math.max(0, modChroma[fifth] - 0.1 * chroma[i]);
    }
    
    // Calcula scores para cada perfil de acorde
    this.chord = CHORD_PROFILE.map(profile => 
      this.calculateChordScore(modChroma, profile, 3)
    );
    
    // Encontra o melhor acorde
    const minScore = Math.min(...this.chord);
    const chordIndex = this.chord.indexOf(minScore);
    
    this.rootNote = chordIndex < 12 ? chordIndex : null;
  }

  calculateChordScore(chroma, chordProfile, N) {
    const sum = chroma.reduce((acc, val, i) => 
      acc + (1 - chordProfile[i]) * (val * val), 0
    );
    return Math.sqrt(sum) / ((12 - N) * this.bias);
  }

  getChordName() {
    return this.rootNote === null ? 'Nada' : NOTE_NAMES[this.rootNote];
  }
}
// ===================== FIM CHORDDETECTOR =====================

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
let timestampUltimoAcordeTocado = null;
let aguardandoProximaLinha = false;
let timestampAguardandoProximaLinha = null;
const MAX_PULO_ACORDES = 2;

// Funções auxiliares
function transporAcorde(acorde, semitons) {
    const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = acorde.match(/^([A-G]#?)/i);
    if (!match) return acorde;
    const nota = match[1].toUpperCase();
    const idx = notas.indexOf(nota);
    if (idx === -1) return acorde;
    let novoIdx = (idx + semitons) % 12;
    if (novoIdx < 0) novoIdx += 12;
    return acorde.replace(/^([A-G]#?)/i, notas[novoIdx]);
}

function acordesIguais(a, b) {
    return a && b && a.toUpperCase() === b.toUpperCase();
}

function acordeCorresponde(detectado, cifra) {
    if (!detectado || !cifra) return false;
    let detectadoTransposto = detectado;
    if (capoFret && capoFret > 0) {
        detectadoTransposto = transporAcorde(detectado, -capoFret);
    }
    return cifra.toUpperCase().includes(detectadoTransposto.toUpperCase()) || 
           detectadoTransposto.toUpperCase().includes(cifra.toUpperCase());
}

// Funções de manipulação do DOM
function detectCapoFret() {
    const capoSpan = document.getElementById('cifra_capo');
    capoFret = capoSpan?.innerText.match(/(\d+)ª casa/)?.[1] || null;
}

function injectControlElements() {
    const container = document.createElement('div');
    Object.assign(container.style, {
        position: 'fixed', bottom: '0', left: '0', zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: '5px', padding: '0 5px 5px 5px'
    });

    const btn = document.createElement('button');
    btn.id = 'tracking-btn';
    btn.innerText = 'Começar';
    Object.assign(btn.style, {
        height: '32px', minWidth: '80px', padding: '0 12px',
        backgroundColor: '#1565c0', color: '#fff', border: 'none',
        borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'
    });

    const info = document.createElement('div');
    info.id = 'chord-info';
    info.innerText = 'Acorde detectado: --';
    Object.assign(info.style, {
        height: '32px', minWidth: '160px', padding: '0 12px',
        backgroundColor: '#eee', border: '1px solid #ccc',
        borderRadius: '8px', fontSize: '15px', fontWeight: 'bold',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
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
    return Array.from(tops.values()).map(line => line.map(el => ({ el, tocado: false })));
}

function highlightLine(lineIdx) {
    cifraLines.forEach((line, i) => {
        line.forEach((acordeObj, j) => {
            if (i === lineIdx) {
                Object.assign(acordeObj.el.style, {
                    backgroundColor: acordeObj.tocado ? '#f70' : '#1565c0',
                    color: '#fff', borderRadius: '4px', padding: '0px 4px'
                });
            } else {
                acordeObj.el.style = '';
            }
        });
    });
    
    if (cifraLines[lineIdx]?.[0]?.el) {
        const rect = cifraLines[lineIdx][0].el.getBoundingClientRect();
        window.scrollTo({
            top: window.scrollY + rect.top - window.innerHeight * 0.5,
            behavior: 'smooth'
        });
    }
}

function updateChordInfo(detected) {
    const info = document.getElementById('chord-info');
    if (capoFret && detected && detected !== 'Nada') {
        const transposto = transporAcorde(detected, -capoFret);
        info.innerText = `Acorde detectado: ${detected} (${transposto} com capo ${capoFret})`;
    } else {
        info.innerText = `Acorde detectado: ${detected || '--'}`;
    }
}

// Funções de navegação e estado
function enableAcordeClickNavigation() {
    cifraLines.forEach((line, i) => {
        line.forEach((acordeObj, j) => {
            acordeObj.el.onclick = () => {
                cifraLines.forEach((l, li) => {
                    l.forEach((a, ai) => {
                        a.tocado = (li < i) || (li === i && ai <= j);
                    });
                });
                currentLineIndex = i;
                currentChordIndex = j;
                aguardandoPrimeiroAcorde = false;
                aguardandoProximaLinha = false;
                timestampAguardandoProximaLinha = null;
                highlightLine(currentLineIndex);
                
                if (isTracking) {
                    clearTimeout(timeoutId);
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

function getProximosAcordes(idxLinha, idxAcorde, maxPulo) {
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

function avancarAcorde(forced = false, pulo = 1) {
    const linha = cifraLines[currentLineIndex] || [];
    if (linha[currentChordIndex]) linha[currentChordIndex].tocado = true;
    
    const proximoAcorde = linha[currentChordIndex + pulo]?.el?.textContent?.trim();
    if (!forced && pulo > 1 && proximoAcorde && 
        acordesIguais(linha[currentChordIndex]?.el.textContent.trim(), proximoAcorde)) {
        return;
    }
    
    currentChordIndex += pulo;
    if (currentChordIndex >= linha.length) {
        currentChordIndex = linha.length - 1;
        aguardandoProximaLinha = true;
        timestampAguardandoProximaLinha = Date.now();
        highlightLine(currentLineIndex);
        return;
    }
    highlightLine(currentLineIndex);
    if (!forced) resetarTimer();
}

function resetarTimer() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
        avancarAcorde(true);
        timestampUltimoAcordeTocado = Date.now();
    }, 7000);
}

// Funções de controle principal
function startTracking() {
    cifraLines = parseCifraLines();
    isTracking = true;
    currentLineIndex = 0;
    currentChordIndex = 0;
    aguardandoPrimeiroAcorde = true;
    ultimoAcordeDetectado = null;
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
    clearTimeout(timeoutId);
    document.getElementById('tracking-btn').innerText = 'Começar';
    document.getElementById('tracking-btn').style.backgroundColor = '#1565c0';
    updateChordInfo('--');
    stopAudioDetection();
    
    currentLineIndex = 0;
    currentChordIndex = 0;
    aguardandoPrimeiroAcorde = true;
    ultimoAcordeDetectado = null;
    timestampUltimoAcordeTocado = null;
    aguardandoProximaLinha = false;
    timestampAguardandoProximaLinha = null;
    capoFret = null;
    
    cifraLines.forEach(line => line.forEach(a => {
        a.tocado = false;
        a.el.style = '';
    }));
    disableAcordeClickNavigation();
}

// Funções de áudio
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
          
          if (!detectado || detectado === 'Nada') {
              listenAnimationId = requestAnimationFrame(loop);
              return;
          }
          
          const linhaAtual = cifraLines[currentLineIndex] || [];
          const acordeEsperado = linhaAtual[currentChordIndex]?.el.textContent.trim();
          const agora = Date.now();
          
          // 1. Lógica de primeiro acorde
          if (aguardandoPrimeiroAcorde) {
              highlightLine(currentLineIndex);
              
              // Acorde esperado no início da música
              if (acordeCorresponde(detectado, acordeEsperado)) {
                  aguardandoPrimeiroAcorde = false;
                  timestampUltimoAcordeTocado = agora;
                  resetarTimer();
                  listenAnimationId = requestAnimationFrame(loop);
                  return;
              }
              
              // Pulo dos primeiros acordes (até MAX_PULO_ACORDES)
              const proximos = getProximosAcordes(currentLineIndex, currentChordIndex, MAX_PULO_ACORDES);
              for (let pulo = 1; pulo <= proximos.length; pulo++) {
                  const prox = proximos[pulo - 1];
                  if (acordeCorresponde(detectado, prox.obj.el.textContent.trim())) {
                      const tolerancia = pulo * 1000;
                      if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > tolerancia) {
                          // Marca acordes pulados como tocados
                          let l = currentLineIndex, a = currentChordIndex;
                          for (let i = 0; i < pulo; i++) {
                              if (a >= cifraLines[l].length) { l++; a = 0; }
                              if (l < cifraLines.length && a < cifraLines[l].length) {
                                  cifraLines[l][a].tocado = true;
                                  a++;
                              }
                          }
                          // Atualiza posição
                          currentLineIndex = prox.linha;
                          currentChordIndex = prox.acorde;
                          aguardandoPrimeiroAcorde = false;
                          timestampUltimoAcordeTocado = agora;
                          highlightLine(currentLineIndex);
                          resetarTimer();
                          listenAnimationId = requestAnimationFrame(loop);
                          return;
                      }
                  }
              }
          }
          // 2. Acorde esperado na linha atual
          else if (!aguardandoProximaLinha && acordeCorresponde(detectado, acordeEsperado)) {
              // Tolerância mínima entre acordes (500ms)
              if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > 500) {
                  avancarAcorde();
                  timestampUltimoAcordeTocado = agora;
              }
          }
          // 3. Pulo de acordes na mesma linha ou entre linhas
          else if (!aguardandoProximaLinha) {
              const proximos = getProximosAcordes(currentLineIndex, currentChordIndex, MAX_PULO_ACORDES);
              for (let pulo = 1; pulo <= proximos.length; pulo++) {
                  const prox = proximos[pulo - 1];
                  if (acordeCorresponde(detectado, prox.obj.el.textContent.trim())) {
                      const tolerancia = pulo * 1500;
                      if (!timestampUltimoAcordeTocado || agora - timestampUltimoAcordeTocado > tolerancia) {
                          // Avança múltiplos acordes
                          for (let i = 0; i < pulo; i++) avancarAcorde();
                          timestampUltimoAcordeTocado = agora;
                      }
                      listenAnimationId = requestAnimationFrame(loop);
                      return;
                  }
              }
          }
          // 4. Aguardando início da próxima linha
          else if (aguardandoProximaLinha && currentLineIndex < cifraLines.length - 1) {
              const proximos = getProximosAcordes(currentLineIndex + 1, -1, MAX_PULO_ACORDES);
              for (let pulo = 1; pulo <= proximos.length; pulo++) {
                  const prox = proximos[pulo - 1];
                  const tolerancia = pulo * 1500;
                  if (acordeCorresponde(detectado, prox.obj.el.textContent.trim()) && 
                      agora - timestampAguardandoProximaLinha > tolerancia) {
                      // Marca acordes anteriores como tocados
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
                      // Atualiza posição para o novo acorde
                      currentLineIndex = prox.linha;
                      currentChordIndex = prox.acorde;
                      aguardandoProximaLinha = false;
                      timestampAguardandoProximaLinha = null;
                      highlightLine(currentLineIndex);
                      timestampUltimoAcordeTocado = agora;
                      resetarTimer();
                      listenAnimationId = requestAnimationFrame(loop);
                      return;
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
    audioContext?.close();
    cancelAnimationFrame(listenAnimationId);
    chromagram = null;
    chordDetector = null;
}

// Inicialização
detectCapoFret();
injectControlElements();
// ===================== FIM content.js principal =====================