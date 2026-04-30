import { io } from 'socket.io-client';

const TRANSCRIPTION_API_URL = import.meta.env.VITE_TRANSCRIPTION_API_URL || 'http://localhost:5000';
const PREFERRED_AUDIO_DEVICE_HINTS = (
  import.meta.env.VITE_PREFERRED_AUDIO_DEVICE_HINTS ||
  'audiobox,presonus,usb 96'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const PREFERRED_AUDIO_DEVICE_EXACT_NAME = String(
  import.meta.env.VITE_PREFERRED_AUDIO_DEVICE_EXACT_NAME || 'line (2- audiobox usb 96)'
)
  .trim()
  .toLowerCase();
const PREFERRED_AUDIO_DEVICE_STORAGE_KEY = 'dr_ai_preferred_audio_device_v1';

function normalizeDeviceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pickPreferredDevice(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return null;

  // Strict lock: prefer exactly one configured device name.
  if (PREFERRED_AUDIO_DEVICE_EXACT_NAME) {
    return (
      devices.find((d) => normalizeDeviceName(d?.name) === PREFERRED_AUDIO_DEVICE_EXACT_NAME) ||
      null
    );
  }

  // Fallback lock: score by hints, then pick only one best match.
  const scored = devices
    .map((device) => {
      const normalizedName = normalizeDeviceName(device?.name);
      const score = PREFERRED_AUDIO_DEVICE_HINTS.reduce(
        (acc, hint) => (normalizedName.includes(hint) ? acc + hint.length : acc),
        0
      );
      return { device, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.device?.index ?? 0) - Number(b.device?.index ?? 0);
    });

  return scored[0]?.device || null;
}

function makeDeviceFingerprint(device) {
  return {
    name: normalizeDeviceName(device?.name),
    max_input_channels: Number(device?.max_input_channels ?? 0),
    default_samplerate: Number(device?.default_samplerate ?? 0),
    hostapi_name: normalizeDeviceName(device?.hostapi_name || ''),
  };
}

function getStoredPreferredFingerprint() {
  try {
    const raw = window.localStorage.getItem(PREFERRED_AUDIO_DEVICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      name: normalizeDeviceName(parsed.name),
      max_input_channels: Number(parsed.max_input_channels ?? 0),
      default_samplerate: Number(parsed.default_samplerate ?? 0),
      hostapi_name: normalizeDeviceName(parsed.hostapi_name || ''),
    };
  } catch {
    return null;
  }
}

function scoreFingerprintMatch(device, fingerprint) {
  if (!fingerprint || !fingerprint.name) return -1;
  const current = makeDeviceFingerprint(device);

  // Name must match exactly (normalized) to avoid selecting similarly named variants.
  if (current.name !== fingerprint.name) return -1;

  let score = 100;
  if (fingerprint.max_input_channels > 0 && current.max_input_channels === fingerprint.max_input_channels) {
    score += 20;
  }
  if (fingerprint.default_samplerate > 0 && current.default_samplerate === fingerprint.default_samplerate) {
    score += 20;
  }
  if (fingerprint.hostapi_name && current.hostapi_name === fingerprint.hostapi_name) {
    score += 20;
  }
  return score;
}

class TranscriptionService {
  constructor() {
    this.socket = null;
    this.sessionId = null;
    this.isRecording = false;
    this.listeners = new Set();
  }

  /**
   * Connect to the transcription WebSocket server
   */
  connect() {
    if (this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.socket = io(TRANSCRIPTION_API_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to transcription server');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Failed to connect to transcription server:', error);
        reject(error);
      });

      this.socket.on('transcription_update', (data) => {
        this.notifyListeners('update', data);
      });

      this.socket.on('transcription_complete', (data) => {
        this.notifyListeners('complete', data);
        this.isRecording = false;
      });
    });
  }

  /**
   * Start transcription
   */
  async start(sessionId = null, options = {}) {
    if (this.isRecording) {
      throw new Error('Transcription is already running');
    }

    await this.connect();

    this.sessionId = sessionId || `session_${Date.now()}`;
    this.isRecording = true;

    const payload = { session_id: this.sessionId };
    if (Object.prototype.hasOwnProperty.call(options, 'deviceIndex')) {
      payload.device_index = options.deviceIndex;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'channels')) {
      payload.channels = options.channels;
    }

    try {
      const response = await fetch(`${TRANSCRIPTION_API_URL}/api/transcription/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start transcription');
      }

      const data = await response.json();
      console.log('🎙️ Transcription started:', data);
      return data;
    } catch (error) {
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * List available input devices from transcription backend
   */
  async getInputDevices() {
    const response = await fetch(`${TRANSCRIPTION_API_URL}/api/transcription/devices`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to fetch audio input devices');
    }
    const data = await response.json();
    const devices = Array.isArray(data.devices) ? data.devices : [];
    // Keep all backend-reported input devices (no name-collapsing), because
    // some interfaces expose multiple valid variants with the same label.
    const normalizedDevices = devices
      .filter((d) => {
        const name = String(d?.name || '').trim();
        return !!name;
      })
      .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0));

    const storedFingerprint = getStoredPreferredFingerprint();
    let preferredDevice = null;
    let preferredSource = 'none';

    if (storedFingerprint) {
      const ranked = normalizedDevices
        .map((device) => ({
          device,
          score: scoreFingerprintMatch(device, storedFingerprint),
        }))
        .filter((entry) => entry.score >= 100)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return Number(a.device?.index ?? 0) - Number(b.device?.index ?? 0);
        });
      preferredDevice = ranked[0]?.device || null;
      preferredSource = preferredDevice ? 'stored' : 'none';
    }

    if (!preferredDevice && !storedFingerprint) {
      preferredDevice = pickPreferredDevice(normalizedDevices);
      preferredSource = preferredDevice ? 'fallback' : 'none';
    } else if (!preferredDevice && storedFingerprint) {
      preferredSource = 'stored_unmatched';
    }

    const preferredIndex = preferredDevice ? Number(preferredDevice.index) : null;

    return normalizedDevices.map((device) => ({
      ...device,
      preferred: preferredIndex != null && Number(device.index) === preferredIndex,
      preferred_source: preferredSource,
    }));
  }

  setPreferredInputDevice(device) {
    const fingerprint = makeDeviceFingerprint(device);
    if (!fingerprint.name) {
      throw new Error('Cannot save preferred device without a valid name');
    }
    window.localStorage.setItem(PREFERRED_AUDIO_DEVICE_STORAGE_KEY, JSON.stringify(fingerprint));
    return fingerprint;
  }

  clearPreferredInputDevice() {
    window.localStorage.removeItem(PREFERRED_AUDIO_DEVICE_STORAGE_KEY);
  }

  hasStoredPreferredInputDevice() {
    return !!getStoredPreferredFingerprint();
  }

  /**
   * Stop transcription
   */
  async stop() {
    if (!this.isRecording || !this.sessionId) {
      return null;
    }

    console.log('⏹️ Stopping transcription, session_id=', this.sessionId);

    try {
      const response = await fetch(`${TRANSCRIPTION_API_URL}/api/transcription/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: this.sessionId }),
      });

      if (!response.ok) {
        let errorBody = {};
        try {
          errorBody = await response.json();
        } catch (e) {
          console.error('Failed to parse error response from stop endpoint', e);
        }
        console.error('🛑 Stop returned non-OK:', response.status, errorBody);
        throw new Error((errorBody && (errorBody.error || errorBody.message)) || `Failed to stop transcription (status ${response.status}) - session_id=${this.sessionId}`);
      }

      const data = await response.json();
      console.log('🛑 Transcription stopped:', data);
      this.isRecording = false;
      return data;
    } catch (error) {
      console.error('Error stopping transcription:', error);
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * Get transcription status
   */
  async getStatus() {
    if (!this.sessionId) {
      return { active: false };
    }

    try {
      const response = await fetch(
        `${TRANSCRIPTION_API_URL}/api/transcription/status?session_id=${this.sessionId}`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting status:', error);
      return { active: false, error: error.message };
    }
  }

  /**
   * Add a listener for transcription events
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of an event
   */
  notifyListeners(event, data) {
    this.listeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Error in transcription listener:', error);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isRecording = false;
    this.sessionId = null;
    this.listeners.clear();
  }
}

// Export a singleton instance
export const transcriptionService = new TranscriptionService();
