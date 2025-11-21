import { io } from 'socket.io-client';

const TRANSCRIPTION_API_URL = import.meta.env.VITE_TRANSCRIPTION_API_URL || 'http://localhost:5000';

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
  async start(sessionId = null) {
    if (this.isRecording) {
      throw new Error('Transcription is already running');
    }

    await this.connect();

    this.sessionId = sessionId || `session_${Date.now()}`;
    this.isRecording = true;

    try {
      const response = await fetch(`${TRANSCRIPTION_API_URL}/api/transcription/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: this.sessionId }),
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
