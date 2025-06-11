// FFT: Transformada rápida de Fourier para análise espectral do áudio.
class FFT {
  constructor(size) {
    this.size = size;
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    
    // Tabelas pré-calculadas para otimização
    this.reverseTable = this._buildReverseTable(size);
    this.sinTable = new Float32Array(size);
    this.cosTable = new Float32Array(size);
    
    // Pré-calcula valores trigonométricos
    for (let i = 1; i < size; i++) {
      this.sinTable[i] = Math.sin(-Math.PI / i);
      this.cosTable[i] = Math.cos(-Math.PI / i);
    }
  }

  // Constrói tabela de bit-reversal para reordenação eficiente
  _buildReverseTable(size) {
    const table = new Uint32Array(size);
    for (let limit = 1, bit = size >> 1; limit < size; limit <<= 1, bit >>= 1) {
      for (let i = 0; i < limit; i++) {
        table[i + limit] = table[i] + bit;
      }
    }
    return table;
  }

  // Executa FFT usando algoritmo Cooley-Tukey
  forward(buffer) {
    this._initBuffers(buffer);
    this._computeFFT();
    
    // Retorna apenas metade positiva do espectro
    return {
      real: this.real.slice(0, this.size / 2 + 1),
      imag: this.imag.slice(0, this.size / 2 + 1)
    };
  }

  // Inicializa buffers com reordenação bit-reversal
  _initBuffers(buffer) {
    for (let i = 0; i < this.size; i++) {
      this.real[i] = buffer[this.reverseTable[i]];
      this.imag[i] = 0;
    }
  }

  // Executa estágios da FFT com operações butterfly
  _computeFFT() {
    for (let stageSize = 1; stageSize < this.size; stageSize <<= 1) {
      const cos = this.cosTable[stageSize];
      const sin = this.sinTable[stageSize];
      
      let twiddleReal = 1, twiddleImag = 0;
      
      for (let pos = 0; pos < stageSize; pos++) {
        // Aplica butterfly para todas as posições do estágio
        for (let i = pos; i < this.size; i += stageSize * 2) {
          const partner = i + stageSize;
          
          // Multiplica por twiddle factor
          const tempReal = twiddleReal * this.real[partner] - twiddleImag * this.imag[partner];
          const tempImag = twiddleReal * this.imag[partner] + twiddleImag * this.real[partner];
          
          // Operações butterfly
          this.real[partner] = this.real[i] - tempReal;
          this.imag[partner] = this.imag[i] - tempImag;
          this.real[i] += tempReal;
          this.imag[i] += tempImag;
        }
        
        // Rotaciona twiddle factor
        [twiddleReal, twiddleImag] = [
          twiddleReal * cos - twiddleImag * sin,
          twiddleReal * sin + twiddleImag * cos
        ];
      }
    }
  }
}

/**
 * Calcula a intensidade das 12 notas musicais a partir do áudio
 */
class Chromagram {
  constructor(analyserNode, sampleRate = 44100) {
    // Configurações do processamento
    this.config = {
      bufferSize: 8192,
      numHarmonics: 4,
      numOctaves: 2,
      numBinsToSearch: 2,
      chromaInterval: 4096,
      downsample: 4
    };

    // Frequências das 12 notas (C3 = 130.81Hz como base)
    this.noteFreqs = this._generateNoteFrequencies();
    
    // Buffers de processamento
    this.buffer = new Float32Array(this.config.bufferSize);
    this.magnitude = new Float32Array(this.config.bufferSize / 2 + 1);
    this.chromagram = new Float32Array(12);
    
    // FFT e janela
    this.fft = new FFT(this.config.bufferSize);
    this.window = this._createBlackmanHarrisWindow(this.config.bufferSize);
    
    // Downsampling
    this.inputSize = analyserNode.fftSize;
    this.downInput = new Float32Array(Math.floor(this.inputSize / this.config.downsample));
    this.tempInput = new Float32Array(this.inputSize);
    
    // Filtro IIR (passa-baixas para anti-aliasing)
    this.iir = { b0: 0.2929, b1: 0.5858, b2: 0.2929, a1: 0, a2: 0.1716 };
    this.iirState = { x_1: 0, x_2: 0, y_1: 0, y_2: 0 };
    
    // Estado
    this.analyser = analyserNode;
    this.samplingFrequency = sampleRate;
    this.samplesSinceLast = 0;
    this.chromaReady = false;
  }

  // Gera as 12 frequências das notas musicais
  _generateNoteFrequencies() {
    const baseFreq = 130.81278265; // C3
    return Array.from({ length: 12 }, (_, i) => 
      baseFreq * Math.pow(2, i / 12)
    );
  }

  // Cria janela Blackman-Harris para reduzir vazamento espectral
  _createBlackmanHarrisWindow(N) {
    const [a0, a1, a2, a3] = [0.35875, 0.48829, 0.14128, 0.01168];
    return Float32Array.from({ length: N }, (_, n) => {
      const phase = (2 * Math.PI * n) / (N - 1);
      return a0 - a1 * Math.cos(phase) + 
             a2 * Math.cos(2 * phase) - 
             a3 * Math.cos(3 * phase);
    });
  }

  // Atualiza o chromagram com novo frame de áudio
  update() {
    this.analyser.getFloatTimeDomainData(this.tempInput);
    this._processAudioFrame(this.tempInput);
  }

  // Processa frame: downsampling + buffer circular + cálculo
  _processAudioFrame(input) {
    this.chromaReady = false;
    
    this._applylowPassFilter(input);
    this._updateCircularBuffer();
    
    this.samplesSinceLast += input.length;
    
    // Calcula chromagram apenas no intervalo especificado
    if (this.samplesSinceLast >= this.config.chromaInterval) {
      this._calculateChromagram();
      this.samplesSinceLast = 0;
    }
  }

  // Aplica filtro IIR e downsampling
  _applylowPassFilter(input) {
    const { b0, b1, b2, a1, a2 } = this.iir;
    let { x_1, x_2, y_1, y_2 } = this.iirState;

    // Filtro IIR biquad
    for (let i = 0; i < this.inputSize; i++) {
      const filtered = input[i] * b0 + x_1 * b1 + x_2 * b2 - y_1 * a1 - y_2 * a2;
      [x_2, x_1] = [x_1, input[i]];
      [y_2, y_1] = [y_1, filtered];
    }
    
    this.iirState = { x_1, x_2, y_1, y_2 };

    // Downsampling por decimação
    for (let i = 0; i < this.downInput.length; i++) {
      this.downInput[i] = input[i * this.config.downsample];
    }
  }

  // Atualiza buffer circular com novos dados
  _updateCircularBuffer() {
    const shift = this.downInput.length;
    this.buffer.copyWithin(0, shift);
    this.buffer.set(this.downInput, this.config.bufferSize - shift);
  }

  // Calcula intensidade das 12 notas musicais
  _calculateChromagram() {
    this._calculateMagnitudeSpectrum();
    
    const freqResolution = (this.samplingFrequency / this.config.downsample) / this.config.bufferSize;
    
    for (let note = 0; note < 12; note++) {
      this.chromagram[note] = this._calculateNoteIntensity(note, freqResolution);
    }
    
    this.chromaReady = true;
  }

  // Calcula intensidade de uma nota específica
  _calculateNoteIntensity(noteIndex, freqResolution) {
    let totalIntensity = 0;
    
    // Soma contribuições de múltiplas oitavas
    for (let octave = 1; octave <= this.config.numOctaves; octave++) {
      let octaveIntensity = 0;
      
      // Considera harmônicos da nota
      for (let harmonic = 1; harmonic <= this.config.numHarmonics; harmonic++) {
        const targetFreq = this.noteFreqs[noteIndex] * octave * harmonic;
        const intensity = this._findPeakAroundFrequency(targetFreq, freqResolution, harmonic);
        
        // Peso decrescente para harmônicos superiores
        octaveIntensity += (intensity / harmonic) * Math.pow(0.7, harmonic - 1);
      }
      
      totalIntensity += octaveIntensity;
    }
    
    return totalIntensity;
  }

  // Encontra pico de intensidade ao redor de uma frequência
  _findPeakAroundFrequency(targetFreq, freqResolution, harmonic) {
    const centerBin = Math.round(targetFreq / freqResolution);
    const searchRadius = this.config.numBinsToSearch * harmonic;
    
    const minBin = Math.max(0, centerBin - searchRadius);
    const maxBin = Math.min(this.magnitude.length - 1, centerBin + searchRadius);
    
    let maxMagnitude = 0;
    for (let bin = minBin; bin <= maxBin; bin++) {
      if (this.magnitude[bin] > maxMagnitude) {
        maxMagnitude = this.magnitude[bin];
      }
    }
    
    return maxMagnitude;
  }

  // Calcula espectro de magnitude via FFT
  _calculateMagnitudeSpectrum() {
    // Aplica janela para reduzir vazamento espectral
    const windowedBuffer = this.buffer.map((sample, i) => sample * this.window[i]);
    
    // FFT complexa
    const { real, imag } = this.fft.forward(windowedBuffer);
    
    // Magnitude = sqrt(real² + imag²)
    for (let i = 0; i < this.magnitude.length; i++) {
      this.magnitude[i] = Math.hypot(real[i], imag[i]);
    }
  }

  // Getters públicos
  getChromagram() { 
    return this.chromagram; 
  }
  
  isReady() { 
    return this.chromaReady; 
  }
}

//CHORD DETECTOR
class ChordDetector {
  static NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  
  // Perfis de acordes maiores: tônica + terça maior + quinta
  static CHORD_PROFILES = Array.from({ length: 12 }, (_, root) => {
    const profile = new Array(12).fill(0);
    profile[root] = 1;              // Tônica
    profile[(root + 4) % 12] = 1;   // Terça maior
    profile[(root + 7) % 12] = 1;   // Quinta
    return profile;
  });

  constructor() {
    // Configurações de detecção
    this.config = {
      chromaBufferSize: 100,
      detectionInterval: 100,
      stabilityLength: 5,
      arpeggioWindowSize: 6,
      arpeggioThreshold: 0.45,
      tonicWeight: 2,
      bias: 1
    };

    // Estado interno
    this.chromaBuffer = [];
    this.stabilityBuffer = [];
    this.lastDetectionTime = 0;
    this.capoFret = 0;
    this.isArpeggioMode = false;
    
    // Configurações da cifra
    this.cifraChords = new Set();
    this.nextExpectedChord = null;
    this.rootNote = null;
    this.lastStableChord = null;
  }

  // Configura capotraste (transpõe acordes)
  setCapoFret(capo) {
    this.capoFret = parseInt(capo) || 0;
  }

  // Define acordes da cifra com transposição para capo
  setCifraChords(chords) {
    const transposedChords = chords
      .map(chord => this._extractRootNote(chord))
      .filter(Boolean)
      .map(root => this._transposeNote(root));
    
    this.cifraChords = new Set(transposedChords);
    console.log('[Cifra transpostos]', Array.from(this.cifraChords));
  }

  // Define próximo acorde esperado
  setNextExpectedChord(chord) {
    if (!chord) {
      this.nextExpectedChord = null;
      return;
    }
    
    const rootNote = this._extractRootNote(chord);
    this.nextExpectedChord = rootNote ? this._transposeNote(rootNote) : chord;
  }

  // Extrai nota fundamental do acorde (ex: "Am7" -> "A")
  _extractRootNote(chord) {
    const match = chord.match(/^([A-G]#?)/i);
    return match ? match[1].toUpperCase() : null;
  }

  // Transpõe nota considerando capotraste
  _transposeNote(note) {
    if (!this.capoFret) return note;
    
    const index = ChordDetector.NOTE_NAMES.indexOf(note);
    if (index < 0) return note;
    
    const transposedIndex = (index + this.capoFret) % 12;
    return ChordDetector.NOTE_NAMES[transposedIndex];
  }

  // Reseta estado de detecção
  reset() {
    this.rootNote = null;
    this.stabilityBuffer = [];
    this.lastStableChord = null;
  }

  // Detecta acorde a partir do chromagram
  detectChord(chroma) {
    this._updateChromaBuffer(chroma);
    
    if (!this._shouldDetect()) return;
    
    const avgChroma = this._calculateAverageChroma();
    
    // Energia muito baixa = silêncio
    if (this._isSilent(avgChroma)) {
      this.reset();
      return;
    }

    this.isArpeggioMode = this._detectArpeggio();
    
    // Nota isolada ou acorde completo?
    if (this._isIsolatedNote(avgChroma)) {
      this._updateStability(this.rootNote);
    } else {
      this._classifyChord(avgChroma);
      this._updateStability(this.rootNote);
    }
  }

  // Atualiza buffer circular de chromas
  _updateChromaBuffer(chroma) {
    this.chromaBuffer.push([...chroma]);
    if (this.chromaBuffer.length > this.config.chromaBufferSize) {
      this.chromaBuffer.shift();
    }
  }

  // Verifica se deve fazer nova detecção (throttling)
  _shouldDetect() {
    const now = Date.now();
    if (now - this.lastDetectionTime < this.config.detectionInterval) {
      return false;
    }
    this.lastDetectionTime = now;
    return true;
  }

  // Calcula média ponderada dos chromas recentes
  _calculateAverageChroma() {
    if (this.chromaBuffer.length === 0) return new Array(12).fill(0);
    
    const alpha = this.isArpeggioMode ? 0.75 : 0.5;
    const avgChroma = [...this.chromaBuffer[0]];
    
    for (let i = 1; i < this.chromaBuffer.length; i++) {
      for (let j = 0; j < 12; j++) {
        avgChroma[j] = alpha * this.chromaBuffer[i][j] + (1 - alpha) * avgChroma[j];
      }
    }
    
    return avgChroma;
  }

  // Verifica se energia é muito baixa (silêncio)
  _isSilent(chroma) {
    return chroma.reduce((sum, val) => sum + val, 0) < 55;
  }

  // Detecta se está tocando arpejo
  _detectArpeggio() {
    const recentChromas = this.chromaBuffer.slice(-this.config.arpeggioWindowSize);
    const energies = recentChromas.map(c => c.reduce((sum, val) => sum + val, 0));
    
    const minEnergy = Math.min(...energies);
    const maxEnergy = Math.max(...energies);
    
    return minEnergy > 0 && 
           (maxEnergy / minEnergy) >= this.config.arpeggioThreshold && 
           maxEnergy - minEnergy > 5;
  }

  // Verifica se é nota isolada (muito mais forte que as outras)
  _isIsolatedNote(chroma) {
    const sorted = chroma
      .map((value, index) => [index, value])
      .sort((a, b) => b[1] - a[1]);
    
    const [maxIndex, maxValue] = sorted[0];
    const [, secondValue] = sorted[1];
    
    if (maxValue > 0.1 && maxValue > 3 * secondValue) {
      this.rootNote = maxIndex;
      return true;
    }
    
    return false;
  }

  // Classifica acorde considerando cifra e contexto
  _classifyChord(chroma) {
    const processedChroma = this._preprocessChroma(chroma);
    const chordScores = this._calculateChordScores(processedChroma);
    
    let bestChordIndex = this._findBestChord(chordScores);
    
    // Aplica lógica de priorização da cifra
    if (this.cifraChords.size > 0) {
      bestChordIndex = this._applyChordPriority(processedChroma, chordScores, bestChordIndex);
    }
    
    this.rootNote = bestChordIndex < 12 ? bestChordIndex : null;
  }

  // Pré-processa chroma: reduz quintas e ajusta B vs E+G
  _preprocessChroma(chroma) {
    const processed = [...chroma];
    
    // Reduz quintas para evitar confusão
    for (let i = 0; i < 12; i++) {
      const fifthIndex = (i + 7) % 12;
      processed[fifthIndex] = Math.max(0, processed[fifthIndex] - 0.1 * chroma[i]);
    }
    
    // Reduz B se E e G estiverem fortes (evita falso B em vez de Em)
    processed[11] = Math.max(0, processed[11] - 0.4 * (processed[4] + processed[7]));
    
    return processed;
  }

  // Calcula score de cada acorde possível
  _calculateChordScores(chroma) {
    return ChordDetector.CHORD_PROFILES.map((profile, rootIndex) => 
      this._calculateChordScore(chroma, profile, rootIndex)
    );
  }

  // Calcula score individual de um acorde (menor = melhor)
  _calculateChordScore(chroma, chordProfile, rootIndex) {
    let sum = 0;
    
    for (let i = 0; i < 12; i++) {
      const weight = (i === rootIndex) ? this.config.tonicWeight : 1;
      const error = (1 - chordProfile[i]) * (chroma[i] * chroma[i]) * weight;
      sum += error;
    }
    
    return Math.sqrt(sum) / ((12 - 3) * this.config.bias);
  }

  // Encontra acorde com menor score
  _findBestChord(scores) {
    const minScore = Math.min(...scores);
    return scores.indexOf(minScore);
  }

  // Aplica priorização baseada na cifra e contexto
  _applyChordPriority(chroma, scores, bestIndex) {
    const strongestNote = this._findStrongestNote(chroma);
    const cifraScores = this._getCifraChordScores(scores);
    const nextChordScore = this._getNextExpectedScore(scores);
    
    const minScore = Math.min(...scores);
    
    // Prioridade 1: Próximo acorde esperado
    if (nextChordScore && nextChordScore.score <= minScore * 1.01) {
      return nextChordScore.index;
    }

    // Prioridade 3: Nota mais forte se muito dominante
    if (strongestNote.isDominant) {
      return ChordDetector.NOTE_NAMES.indexOf(strongestNote.note);
    }
    
    // Fallback: Melhor da cifra ou original
    return cifraScores.length > 0 ? cifraScores[0].index : bestIndex;
  }

  // Encontra nota mais forte no chroma
  _findStrongestNote(chroma) {
    const sorted = chroma
      .map((value, index) => ({ note: ChordDetector.NOTE_NAMES[index], value, index }))
      .sort((a, b) => b.value - a.value);
    
    const strongest = sorted[0];
    const second = sorted[1];
    
    return {
      ...strongest,
      isDominant: strongest.value > 2 * second.value && strongest.value > 0.2
    };
  }

  // Obtém scores dos acordes da cifra ordenados
  _getCifraChordScores(scores) {
    return Array.from(this.cifraChords)
      .map(note => {
        const index = ChordDetector.NOTE_NAMES.indexOf(note);
        return { note, index, score: scores[index] };
      })
      .sort((a, b) => a.score - b.score);
  }

  // Obtém score do próximo acorde esperado
  _getNextExpectedScore(scores) {
    if (!this.nextExpectedChord) return null;
    
    const index = ChordDetector.NOTE_NAMES.indexOf(this.nextExpectedChord);
    return index >= 0 ? { index, score: scores[index] } : null;
  }

  // Atualiza buffer de estabilidade
  _updateStability(rootNote) {
    const bufferLength = this.isArpeggioMode ? 
      this.config.stabilityLength + 2 : 
      this.config.stabilityLength;
    
    this.stabilityBuffer.push(rootNote);
    if (this.stabilityBuffer.length > bufferLength) {
      this.stabilityBuffer.shift();
    }
    
    this._calculateStableChord(bufferLength);
  }

  // Calcula acorde mais estável por votação
  _calculateStableChord(bufferLength) {
    const votes = {};
    
    for (const chord of this.stabilityBuffer) {
      if (chord !== null) {
        votes[chord] = (votes[chord] || 0) + 1;
      }
    }
    
    const winner = Object.entries(votes)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (winner && winner[1] >= Math.ceil(bufferLength / 2)) {
      this.lastStableChord = parseInt(winner[0]);
    }
  }

  // Retorna nome do acorde detectado
  getChordName() {
    if (this.lastStableChord === null) return 'Nada';
    
    // Tratamento especial para B vs Em
    if (this.lastStableChord === 11) {
      const lastChroma = this.chromaBuffer[this.chromaBuffer.length - 1];
      if (!lastChroma) return 'B';
      
      const emEnergy = lastChroma[4] + lastChroma[7]; // E + G
      const bEnergy = lastChroma[11]; // B
      
      if (emEnergy > bEnergy * 1.2) return 'Nada';
    }
    
    return ChordDetector.NOTE_NAMES[this.lastStableChord];
  }
}
// ===================== FIM CHORDDETECTOR =====================

// ===================== INTERFACE OTIMIZADA =====================

class CifraApp {
  constructor() {
    // Estado principal
    this.cifraLines = [];
    this.isTracking = false;
    this.currentLineIndex = 0;
    this.currentChordIndex = 0;
    
    // Audio e detecção
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.chromagram = null;
    this.chordDetector = null;
    
    // Buffer de detecção
    this.detectionBuffer = [];
    this.confirmedChord = null;
    this.lastChordTime = 0;
    
    // Configurações
    this.capoFret = null;
    this.songKey = null;
    this.BUFFER_SIZE = 5;
    this.CHORD_CONFIRMATION_THRESHOLD = 0.5;
    this.TROCA_ACORDE_MS = 1000;
    
    // Mapeamento bemol para sustenido
    this.bemolParaSustenido = {
      'Bb': 'A#', 'Eb': 'D#', 'Ab': 'G#', 'Db': 'C#', 'Gb': 'F#', 'Cb': 'B', 'Fb': 'E'
    };
    this.notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  }

  destroy() {
    // Cleanup completo
    const btn = document.getElementById('tracking-btn');
    if (btn) btn.parentElement?.remove();
    
    this.cifraLines.forEach(line => line.forEach(a => a.el.onclick = null));
    this.audioContext?.close();
    
    // Reset de estado
    Object.assign(this, {
      audioContext: null, analyser: null, source: null, chromagram: null, chordDetector: null,
      isTracking: false, currentLineIndex: 0, currentChordIndex: 0,
      detectionBuffer: [], confirmedChord: null, lastChordTime: 0
    });
  }

  // DETECÇÃO DE CONFIGURAÇÕES DA MÚSICA
  detectCapoFret() {
    this.capoFret = null;
    const extractFret = (text) => {
      const match = text?.match(/(\d+)ª\s*casa/);
      return match ? parseInt(match[1]) : null;
    };

    // Procura no elemento específico primeiro
    const capoSpan = document.querySelector('#cifra_capo[data-cy="song-capo"]');
    if (capoSpan) {
      this.capoFret = extractFret(capoSpan.innerText);
      if (this.capoFret && this.chordDetector) this.chordDetector.setCapoFret(this.capoFret);
      return this.capoFret;
    }

    // Procura em spans com texto "Capotraste na"
    for (const span of document.querySelectorAll('span')) {
      if (span.textContent.includes('Capotraste na')) {
        const texto = span.querySelector('b')?.innerText || span.querySelector('a')?.innerText;
        if (texto) {
          this.capoFret = extractFret(texto);
          if (this.capoFret && this.chordDetector) this.chordDetector.setCapoFret(this.capoFret);
          return this.capoFret;
        }
      }
    }
  }

  detectSongKey() {
    this.songKey = null;
    
    // Procura no elemento específico
    const tomElement = document.querySelector('#cifra_tom a, #cifra_tom b');
    if (tomElement) {
      const match = tomElement.textContent.trim().match(/^([A-G]#?m?)/i);
      if (match) {
        this.songKey = match[1];
        return;
      }
    }

    // Procura em spans com "Tom"
    for (const span of document.querySelectorAll('span')) {
      if (span.textContent.includes('Tom')) {
        const element = span.querySelector('b') || span.querySelector('a');
        const match = element?.textContent.trim().match(/^([A-G]#?m?)/i);
        if (match) {
          this.songKey = match[1];
          return;
        }
      }
    }
  }

  // PARSING DOS ACORDES DA CIFRA
  parseCifraLines() {
    const pre = document.querySelector('.cifra_cnt pre') || document.querySelector('pre');
    const acordeElements = pre?.querySelectorAll('b') ?? [];
    
    // Agrupa elementos por posição vertical (linha)
    const lineGroups = new Map();
    acordeElements.forEach(el => {
      if (el.closest('span.tablatura')) return; // Ignora tablatura
      
      const top = el.getBoundingClientRect().top;
      if (!lineGroups.has(top)) lineGroups.set(top, []);
      lineGroups.get(top).push(el);
    });

    // Converte para formato interno
    return Array.from(lineGroups.values()).map(line =>
      line.map(el => {
        let texto = el.textContent?.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        let acorde = texto.replace(/^([A-G][b])/, (match) => this.bemolParaSustenido[match] || match);
        return { el, tocado: false, acorde };
      })
    );
  }

  getAllCifraChords() {
    const acordes = new Set();
    this.cifraLines.forEach(line => 
      line.forEach(a => { if (a.acorde) acordes.add(a.acorde); })
    );
    return Array.from(acordes);
  }

  // TRANSPOSIÇÃO E COMPARAÇÃO DE ACORDES
  transporAcorde(acorde, semitons) {
    const match = acorde.match(/^([A-G]#?)/i);
    if (!match) return acorde;
    
    const notaIndex = this.notas.indexOf(match[1].toUpperCase());
    const novoIndex = (notaIndex + semitons + 12) % 12;
    return acorde.replace(/^([A-G]#?)/i, this.notas[novoIndex]);
  }

  acordeCorresponde(detectado, cifra) {
    if (!detectado || !cifra) return false;
    
    const normalize = s => s.replace(/min|MIN/, 'm').replace('maj', '');
    const comCapo = this.capoFret ? this.transporAcorde(detectado, -parseInt(this.capoFret)) : detectado;
    
    return normalize(cifra).toUpperCase().includes(normalize(comCapo).toUpperCase());
  }

  // INTERFACE VISUAL
  highlightLine(lineIndex) {
    this.cifraLines.forEach((line, i) =>
      line.forEach(acorde => {
        acorde.el.style = '';
        if (i === lineIndex) {
          this.aplicarEstilo(acorde.el, acorde.tocado ? '#ff9800' : '#2196f3');
        }
      })
    );

    // Scroll suave para a linha atual
    const firstChordRect = this.cifraLines[lineIndex]?.[0]?.el?.getBoundingClientRect();
    if (firstChordRect) {
      window.scrollTo({
        top: window.scrollY + firstChordRect.top - window.innerHeight * 0.3,
        behavior: 'smooth'
      });
    }
  }

  aplicarEstilo(element, cor) {
    Object.assign(element.style, {
      backgroundColor: cor,
      color: '#fff',
      borderRadius: '4px',
      padding: '0 4px'
    });
  }

  updateChordInfo(detected) {
    const info = document.getElementById('chord-info');
    const transposto = (this.capoFret && detected && detected !== 'Nada') 
      ? ` (sem capo: ${this.transporAcorde(detected, -this.capoFret)})` 
      : '';
    info.innerText = `Detectado: ${detected || '--'}${transposto}`;
  }

  // BUFFER DE CONFIRMAÇÃO DE ACORDES
  updateDetectionBuffer(chord) {
    this.detectionBuffer.push(chord);
    if (this.detectionBuffer.length > this.BUFFER_SIZE) {
      this.detectionBuffer.shift();
    }

    // Conta frequência de cada acorde no buffer
    const frequency = this.detectionBuffer.reduce((acc, c) => {
      if (c) acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {});

    // Encontra o acorde mais frequente
    const [bestChord, count] = Object.entries(frequency)
      .reduce((a, b) => a[1] > b[1] ? a : b, ['', 0]);

    // Confirma se passou do threshold
    if (count / this.BUFFER_SIZE >= this.CHORD_CONFIRMATION_THRESHOLD) {
      this.confirmedChord = bestChord;
      return true;
    }
    return false;
  }

  // CONTROLES DA INTERFACE
  injectControlElements() {
    if (document.getElementById('tracking-btn') || !this.songKey) return;

    const button = Object.assign(document.createElement('button'), {
      id: 'tracking-btn',
      innerText: 'Começar'
    });
    this.applyStyles(button, {
      height: '32px', minWidth: '80px', backgroundColor: '#1565c0',
      color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer'
    });

    const info = Object.assign(document.createElement('div'), {
      id: 'chord-info',
      innerText: 'Detectado: --'
    });
    this.applyStyles(info, {
      height: '32px', minWidth: '160px', backgroundColor: '#f8f9fa',
      border: '1px solid #dee2e6', borderRadius: '8px',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const container = document.createElement('div');
    this.applyStyles(container, {
      display: 'flex', gap: '5px', padding: '5px', zIndex: '0'
    });
    container.append(button, info);

    // Posicionamento responsivo
    this.positionControls(container);

    button.onclick = async () => {
      if (this.isTracking) {
        this.stopTracking();
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.startTracking();
          this.startAudioDetection(stream);
        } catch {
          alert('Permissão de microfone negada.');
        }
      }
    };
  }

  positionControls(container) {
    if (window.innerWidth < 900) {
      const ref = document.querySelector('div._1LnEC.u-full._3J-aD');
      if (ref?.parentElement) {
        Object.assign(container.style, {
          position: 'relative', paddingLeft: '20px'
        });
        ref.parentElement.insertBefore(container, ref.nextSibling);
        return;
      }
    }
    
    // Fallback para posição fixa
    Object.assign(container.style, {
      position: 'fixed', bottom: '0', left: '0',
    });
    document.body.append(container);
  }

  applyStyles(element, styles) {
    Object.assign(element.style, styles);
  }

  // CONTROLE DE TRACKING
  startTracking() {
    this.cifraLines = this.parseCifraLines();
    if (this.chordDetector) this.chordDetector.setCifraChords(this.getAllCifraChords());

    this.isTracking = true;
    this.currentLineIndex = this.currentChordIndex = 0;
    this.detectionBuffer = [];
    this.confirmedChord = null;

    // Atualiza botão
    const btn = document.getElementById('tracking-btn');
    btn.innerText = 'Parar';
    btn.style.backgroundColor = '#2e7d32';

    // Adiciona cliques nos acordes para navegação manual
    this.cifraLines.forEach((line, lineIndex) =>
      line.forEach((acorde, chordIndex) => {
        acorde.tocado = false;
        acorde.el.onclick = () => {
          if (!this.isTracking) return;
          
          // Marca acordes anteriores como tocados
          this.cifraLines[lineIndex].forEach((a, i) => a.tocado = i < chordIndex);
          
          this.currentLineIndex = lineIndex;
          this.currentChordIndex = chordIndex;
          this.detectionBuffer = [];
          this.confirmedChord = null;
          
          // Limpa estilos e destaca linha atual
          this.cifraLines.forEach(l => l.forEach(a => a.el.style = ''));
          this.highlightLine(this.currentLineIndex);
        };
      })
    );

    this.highlightLine(this.currentLineIndex);
  }

  stopTracking() {
    this.isTracking = false;
    
    // Atualiza botão
    const btn = document.getElementById('tracking-btn');
    btn.innerText = 'Começar';
    btn.style.backgroundColor = '#1565c0';
    
    // Limpa estilos
    this.cifraLines.forEach(line => line.forEach(acorde => acorde.el.style = ''));
    this.cifraLines = [];
    this.stopAudioDetection();
  }

  // DETECÇÃO DE ÁUDIO
  startAudioDetection(stream) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 8192;
    this.source.connect(this.analyser);

    this.chromagram = new Chromagram(this.analyser, this.audioContext.sampleRate);
    this.chordDetector = new ChordDetector();
    this.chordDetector.setCapoFret(this.capoFret);
    this.chordDetector.setCifraChords(this.getAllCifraChords());

    const getNextExpectedChord = () => {
      let lineIndex = this.currentLineIndex;
      let chordIndex = this.currentChordIndex;
      
      while (this.cifraLines[lineIndex]) {
        const acorde = this.cifraLines[lineIndex][chordIndex]?.acorde;
        if (acorde) return acorde;
        lineIndex++;
        chordIndex = 0;
      }
      return null;
    };

    this.chordDetector.setNextExpectedChord(getNextExpectedChord());
    this.audioDetectionLoop(getNextExpectedChord);
  }

  audioDetectionLoop(getNextExpectedChord) {
    const loop = () => {
      if (!this.isTracking) return;

      this.chromagram.update();
      this.chordDetector.setNextExpectedChord(getNextExpectedChord());

      if (this.chromagram.isReady()) {
        this.chordDetector.detectChord(this.chromagram.getChromagram());
        const chord = this.chordDetector.getChordName();
        this.updateChordInfo(chord);

        if (chord && chord !== 'Nada' && this.updateDetectionBuffer(chord)) {
          this.processChordMatch(getNextExpectedChord);
        }
      }
      
      requestAnimationFrame(loop);
    };
    loop();
  }

  processChordMatch(getNextExpectedChord) {
    const detectado = this.confirmedChord;
    const linhaAtual = this.cifraLines[this.currentLineIndex];
    const acordeAtual = linhaAtual[this.currentChordIndex]?.acorde;
    const now = Date.now();

    // Avança no acorde atual se corresponder e tempo suficiente passou
    if (this.acordeCorresponde(detectado, acordeAtual) && 
        (now - this.lastChordTime >= this.TROCA_ACORDE_MS)) {
      
      linhaAtual[this.currentChordIndex].tocado = true;
      this.currentChordIndex++;
      this.lastChordTime = now;
      this.highlightLine(this.currentLineIndex);
      this.chordDetector.setNextExpectedChord(getNextExpectedChord());
    }

    // Avança para próxima linha se todos acordes foram tocados
    const todosTocados = linhaAtual.every(a => a.tocado);
    const proximaLinha = this.cifraLines[this.currentLineIndex + 1];
    const proximoAcorde = proximaLinha?.[0]?.acorde;

    if (todosTocados && proximaLinha && 
        this.acordeCorresponde(detectado, proximoAcorde) && 
        (now - this.lastChordTime >= this.TROCA_ACORDE_MS)) {
      
      this.currentLineIndex++;
      this.currentChordIndex = 1;
      proximaLinha[0].tocado = true;
      this.lastChordTime = now;
      this.highlightLine(this.currentLineIndex);
      this.chordDetector.setNextExpectedChord(getNextExpectedChord());
    }
  }

  stopAudioDetection() {
    this.audioContext?.close();
    this.chromagram = this.chordDetector = null;
  }
}

// GERENCIAMENTO DE SPA E INICIALIZAÇÃO
let cifraApp = null;
let lastUrl = location.href;

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    startCifraApp();
  }
}, 500);

function startCifraApp() {
  if (cifraApp?.destroy) cifraApp.destroy();
  
  cifraApp = new CifraApp();
  cifraApp.detectCapoFret();
  cifraApp.detectSongKey();
  cifraApp.cifraLines = cifraApp.parseCifraLines();
  cifraApp.injectControlElements();
}

// Inicialização
startCifraApp();