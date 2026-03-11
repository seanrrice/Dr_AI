import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Mic, MicOff, Loader2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import io from 'socket.io-client';

const PYTHON_BACKEND_URL = 'http://localhost:5001';

export default function AudioRecorder({ onTranscriptionUpdate, onSpeakerSegments }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [speakers, setSpeakers] = useState(new Set());
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');

  const socketRef = useRef(null);
  const fullTranscriptRef = useRef('');

  useEffect(() => {
    // Connect to Python backend
    console.log('🔌 Connecting to Python transcription server...');
    const socket = io(PYTHON_BACKEND_URL, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(' Connected to Python transcription server');
      setStatus('Connected to server');
    });

    socket.on('disconnect', () => {
      console.log(' Disconnected from server');
      setStatus('Disconnected');
    });

    socket.on('status', (data) => {
      console.log(' Status:', data.message);
      setStatus(data.message);
    });

    socket.on('interim', (data) => {
      setStatus(data.message);
    });

    socket.on('transcript', (data) => {
      console.log(' Transcript received:', data);
      
      const { speaker, text, start_time, end_time } = data;
      const speakerLabel = speaker || 'Unknown';
      
      // Add speaker to detected speakers set
      setSpeakers(prev => new Set([...prev, speakerLabel]));
      
      // Format transcript with timestamp and speaker
      const formattedText = `[${start_time} → ${end_time}] ${speakerLabel}: ${text}`;
      
      // Update full transcript
      fullTranscriptRef.current = fullTranscriptRef.current 
        ? `${fullTranscriptRef.current}\n${formattedText}`
        : formattedText;
      
      setCurrentTranscript(fullTranscriptRef.current);
      
      // Send to parent component (NewVisit.jsx)
      onTranscriptionUpdate(fullTranscriptRef.current);
      
      // Send speaker segment data
      if (onSpeakerSegments) {
        onSpeakerSegments({
          speaker: speakerLabel,
          text,
          start_time,
          end_time,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('error', (data) => {
      console.error(' Error from server:', data.message);
      setError(data.message);
    });

    // Cleanup on unmount
    return () => {
      console.log(' Disconnecting from server...');
      socket.disconnect();
    };
  }, [onTranscriptionUpdate, onSpeakerSegments]);

  const startRecording = () => {
    if (!socketRef.current || !socketRef.current.connected) {
      setError('Not connected to transcription server. Make sure Python backend is running on port 5001.');
      return;
    }

    setIsRecording(true);
    setError(null);
    fullTranscriptRef.current = '';
    setCurrentTranscript('');
    setSpeakers(new Set());
    
    // Tell Python backend to start recording
    socketRef.current.emit('start_recording');
    console.log(' Recording started');
  };

  const stopRecording = () => {
    if (socketRef.current) {
      socketRef.current.emit('stop_recording');
    }
    setIsRecording(false);
    console.log(' Recording stopped');
  };

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-900">Real-Time Audio Recording</h3>
              {isRecording && (
                <Badge className="bg-red-500 animate-pulse">
                  <div className="w-2 h-2 bg-white rounded-full mr-2" />
                  Recording
                </Badge>
              )}
              {status && !isRecording && (
                <Badge variant="outline" className="text-xs">
                  {status}
                </Badge>
              )}
            </div>
            
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isConnecting}
              variant={isRecording ? "destructive" : "default"}
              className={isRecording ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}
            >
              {isRecording ? (
                <>
                  <MicOff className="w-4 h-4 mr-2" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </>
              )}
            </Button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              <p className="font-semibold mb-1">Error:</p>
              <p>{error}</p>
              <div className="mt-3 p-3 bg-white rounded border border-red-300 text-xs">
                <p className="font-semibold mb-2">Make sure Python backend is running:</p>
                <code className="block bg-gray-100 px-2 py-1 rounded">
                  cd python-backend<br/>
                  venv\Scripts\activate<br/>
                  python AudioTranscribe.py
                </code>
              </div>
            </div>
          )}

          {/* Speaker Detection */}
          {speakers.size > 0 && (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-600" />
              <span className="text-sm text-slate-600">
                Detected speakers: {Array.from(speakers).join(', ')}
              </span>
            </div>
          )}

          {/* Real-time Transcript Display */}
          {isRecording && (
            <div className="bg-white rounded-lg p-4 border border-blue-200 max-h-60 overflow-y-auto">
              <div className="text-sm text-slate-700 font-mono whitespace-pre-wrap leading-relaxed">
                {currentTranscript || 'Listening... speak now!'}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="text-xs text-slate-500 space-y-1">
            <p> Automatic speaker detection and timestamps</p>
            <p> Transcript automatically syncs to text box below</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}