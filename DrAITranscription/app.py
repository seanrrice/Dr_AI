from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import threading
from transcription_module import TranscriptionSession, load_global_model

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active transcription sessions
active_sessions = {}

@app.route('/api/transcription/start', methods=['POST'])
def start_transcription():
    """Start a new transcription session."""
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')
    print(f"[API] /api/transcription/start called with session_id={session_id}")
    
    if session_id in active_sessions:
        return jsonify({'error': 'Session already active'}), 400
    
    session = TranscriptionSession()
    active_sessions[session_id] = session
    print(f"[API] Active sessions after start: {list(active_sessions.keys())}")
    
    def on_transcription(text):
        """Callback when transcription is received."""
        if session_id in active_sessions:
            socketio.emit('transcription_update', {
                'session_id': session_id,
                'text': text,
                'full_text': active_sessions[session_id].get_full_transcript()
            })
    
    session.callback = on_transcription
    
    # Start transcription in a separate thread
    thread = threading.Thread(target=session.start, daemon=True)
    thread.start()
    
    return jsonify({
        'success': True,
        'session_id': session_id,
        'message': 'Transcription started'
    })

@app.route('/api/transcription/stop', methods=['POST'])
def stop_transcription():
    """Stop an active transcription session."""
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')
    print(f"[API] /api/transcription/stop called with session_id={session_id}")
    print(f"[API] Active sessions before stop: {list(active_sessions.keys())}")
    
    if session_id not in active_sessions:
        print(f"[API] Session {session_id} not found")
        return jsonify({'error': 'Session not found', 'session_id': session_id, 'active_sessions': list(active_sessions.keys())}), 404
    
    session = active_sessions[session_id]
    session.stop()
    
    full_transcript = session.get_full_transcript()
    del active_sessions[session_id]
    
    socketio.emit('transcription_complete', {
        'session_id': session_id,
        'full_text': full_transcript
    })
    
    print(f"[API] Active sessions after stop (before delete): {list(active_sessions.keys())}")
    return jsonify({
        'success': True,
        'session_id': session_id,
        'full_text': full_transcript
    })

@app.route('/api/transcription/status', methods=['GET'])
def get_status():
    """Get status of transcription sessions."""
    session_id = request.args.get('session_id', 'default')
    
    if session_id in active_sessions:
        session = active_sessions[session_id]
        return jsonify({
            'active': session.is_running,
            'session_id': session_id,
            'transcript_count': len(session.transcripts)
        })
    
    return jsonify({
        'active': False,
        'session_id': session_id
    })

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection."""
    print('Client connected')
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection."""
    print('Client disconnected')

if __name__ == '__main__':
    print("🎙️ Starting transcription server on http://localhost:5000")
    print("📝 API endpoints:")
    print("   POST /api/transcription/start - Start transcription")
    print("   POST /api/transcription/stop - Stop transcription")
    print("   GET  /api/transcription/status - Get status")
    # Try to preload the Whisper model once at server startup to avoid per-session delays
    try:
        ok = load_global_model()
        if not ok:
            print("[app] Warning: GLOBAL model preload failed; sessions will attempt to load model on first use")
    except Exception as e:
        print(f"[app] Exception while preloading GLOBAL model: {e}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)

