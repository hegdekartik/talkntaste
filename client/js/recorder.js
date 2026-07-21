/**
 * recorder.js — Browser audio recording with waveform visualization
 */

export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.chunks = [];
    this.startTime = null;
    this.timerInterval = null;
    this.animationFrame = null;
    this.isRecording = false;

    // Config
    this.maxDuration = 180; // 3 minutes in seconds
    this.warningDuration = 150; // 2:30 warning

    // Callbacks
    this.onTimeUpdate = null;
    this.onWarning = null;
    this.onMaxReached = null;
  }

  /**
   * Request mic permission and start recording.
   * @returns {Promise<void>}
   */
  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      // Set up audio context for waveform
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // Determine supported mime type
      const mimeType = this._getSupportedMimeType();
      const options = { audioBitsPerSecond: 128000 };
      if (mimeType) options.mimeType = mimeType;

      // Start recording
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.start(250); // Collect data every 250ms
      this.isRecording = true;
      this.startTime = Date.now();

      // Start timer
      this._startTimer();

      // Haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied. Please allow access in your browser settings.');
      }
      throw new Error(`Could not access microphone: ${error.message}`);
    }
  }

  /**
   * Stop recording and return the audio blob.
   * @returns {Promise<{ blob: Blob, duration: number }>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType;
        const blob = new Blob(this.chunks, { type: mimeType });
        const duration = (Date.now() - this.startTime) / 1000;

        this._cleanup();

        // Haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate([30, 30, 30]);
        }

        resolve({ blob, duration });
      };

      this.mediaRecorder.stop();
      this.isRecording = false;
    });
  }

  /**
   * Get frequency data for waveform visualization.
   * @returns {Uint8Array|null}
   */
  getFrequencyData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  /**
   * Draw waveform on a canvas element.
   * @param {HTMLCanvasElement} canvas
   */
  drawWaveform(canvas) {
    if (!this.isRecording) return;

    const ctx = canvas.getContext('2d');
    const data = this.getFrequencyData();
    if (!data) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.3;

    ctx.clearRect(0, 0, width, height);

    // Draw circular waveform around the mic button
    const bars = 64;
    const step = Math.floor(data.length / bars);

    for (let i = 0; i < bars; i++) {
      const value = data[i * step] / 255;
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const barHeight = value * radius * 0.6 + 2;

      const x1 = centerX + Math.cos(angle) * (radius + 5);
      const y1 = centerY + Math.sin(angle) * (radius + 5);
      const x2 = centerX + Math.cos(angle) * (radius + 5 + barHeight);
      const y2 = centerY + Math.sin(angle) * (radius + 5 + barHeight);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.3 + value * 0.7})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    this.animationFrame = requestAnimationFrame(() => this.drawWaveform(canvas));
  }

  /** Start the waveform animation loop */
  startWaveform(canvas) {
    this.drawWaveform(canvas);
  }

  /** Stop the waveform animation loop */
  stopWaveform() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /** Get a supported mime type for recording */
  _getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac',
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Let browser pick default
  }

  /** Start the recording timer */
  _startTimer() {
    this.timerInterval = setInterval(() => {
      if (!this.startTime) return;
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);

      if (this.onTimeUpdate) {
        this.onTimeUpdate(elapsed);
      }

      // Warning at 2:30
      if (elapsed >= this.warningDuration && elapsed < this.maxDuration) {
        if (this.onWarning) {
          this.onWarning(this.maxDuration - elapsed);
        }
      }

      // Auto-stop at 3:00
      if (elapsed >= this.maxDuration) {
        if (this.onMaxReached) {
          this.onMaxReached();
        }
      }
    }, 1000);
  }

  /** Clean up all resources */
  _cleanup() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    this.stopWaveform();

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.isRecording = false;
    this.startTime = null;
    this.chunks = [];
  }
}

/**
 * Format seconds into M:SS display.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
