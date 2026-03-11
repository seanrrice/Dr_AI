import React, { useState, useEffect, useRef } from "react";
import { api } from "@/api/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, FileText, Brain, Loader2, UserPlus, CheckCircle, XCircle, Clock, Activity, Mic, MicOff } from "lucide-react";
import { compareAllModels, getConsensusResult, analyzeKeywords, analyzeSentiment, analyzeSemantics, extractPatientText } from "@/services/aiService";
import { transcriptionService } from "@/services/transcriptionService";
import { AudioJsonlLogger, makeRelativeTimer } from "@/utils/jsonlLogger"; // ✅ new import
function formatTranscriptionForDisplay(text) {
  if (!text) return text;
  return text.replace(/Mic 1/g, "Patient").replace(/Mic 2/g, "Doctor");
}
export default function NewVisit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitData, setVisitData] = useState({
    visit_date: new Date().toISOString().split('T')[0],
    chief_complaint: "",
    transcription: "",
    physician_notes: "",
    bp_systolic: "",
    bp_diastolic: "",
    heart_rate: "",
    respiratory_rate: "",
    temperature: "",
    spo2: "",
    height: "",
    weight: "",
    bmi: ""
  });
  const [speakerSegments, setSpeakerSegments] = useState([]);
  const [units, setUnits] = useState('metric');
  const [tempUnit, setTempUnit] = useState('fahrenheit'); 
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);
  const transcriptionListenerRef = useRef(null);
  const jsonlLoggerRef = useRef(null);    // ✅ JSONL logger instance
  const windowStartRef = useRef(null);   // ✅ tracks each window's start time
  const [analysisProgress, setAnalysisProgress] = useState({
    openai: 'pending',
    ollama: 'pending'
  });
  const [isStartingTranscription, setIsStartingTranscription] = useState(false);
  const [showNewPatientDialog, setShowNewPatientDialog] = useState(false);
  // Camera refs and state for dual feeds
  const video1Ref = useRef(null);
  const video2Ref = useRef(null);
  const canvas1Ref = useRef(null);
  const canvas2Ref = useRef(null);
  const cameraStreamRef = useRef(null);
  const animationRef = useRef(null);
  const [camerasActive, setCamerasActive] = useState(false);
  const [newPatient, setNewPatient] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    medical_record_number: "",
    primary_diagnosis: "",
    notes: ""
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-created_date'),
  });

  const { data: existingVisits = [] } = useQuery({
    queryKey: ['visits', selectedPatientId],
    queryFn: () => api.entities.Visit.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  // Preconnect to transcription server so Start Recording is faster
  useEffect(() => {
    transcriptionService.connect().catch(() => {});
  }, []);

  // Cleanup transcription on unmount
  useEffect(() => {
    return () => {
      if (isTranscribing) {
        transcriptionService.stop().catch(console.error);
      }
      if (transcriptionListenerRef.current) {
        transcriptionListenerRef.current();
      }
      transcriptionService.disconnect();
      // stop camera streams if active
      try {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((t) => t.stop());
          cameraStreamRef.current = null;
        }
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      } catch (err) {
        console.warn('Error cleaning up camera streams', err);
      }
    };
  }, []);

  // Start both camera feeds (for now both attach the default webcam stream)
  const startCameras = async () => {
    try {
      if (cameraStreamRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      cameraStreamRef.current = stream;
      if (video1Ref.current) {
        video1Ref.current.srcObject = stream;
        video1Ref.current.play().catch(() => {});
      }
      if (video2Ref.current) {
        // attach same stream for prototype/demo purposes
        video2Ref.current.srcObject = stream;
        video2Ref.current.play().catch(() => {});
      }
      setCamerasActive(true);
      // start a lightweight overlay loop
      const loop = () => {
        try {
          [
            { video: video1Ref.current, canvas: canvas1Ref.current },
            { video: video2Ref.current, canvas: canvas2Ref.current }
          ].forEach(({ video, canvas }, idx) => {
            if (!video || !canvas) return;
            const ctx = canvas.getContext('2d');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // simple overlay: timestamp and active badge
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(8, 8, 160, 28);
            ctx.fillStyle = '#fff';
            ctx.font = '12px Inter, ui-sans-serif, system-ui';
            ctx.fillText(new Date().toLocaleTimeString(), 16, 26);
            // label corner
            ctx.fillStyle = idx === 0 ? 'rgba(16,185,129,0.9)' : 'rgba(14,165,233,0.9)';
            ctx.beginPath();
            ctx.arc(canvas.width - 18, 18, 8, 0, Math.PI * 2);
            ctx.fill();
          });
        } catch (err) {
          // ignore overlay errors
        }
        animationRef.current = requestAnimationFrame(loop);
      };
      animationRef.current = requestAnimationFrame(loop);
    } catch (err) {
      console.error('Could not start cameras', err);
      alert('Unable to access camera. Make sure the site is served over HTTPS or use localhost and grant permissions.');
    }
  };

  const stopCameras = () => {
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      if (video1Ref.current) video1Ref.current.srcObject = null;
      if (video2Ref.current) video2Ref.current.srcObject = null;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    } catch (err) {
      console.warn('Error stopping cameras', err);
    }
    setCamerasActive(false);
  };

  // Handle transcription updates
  useEffect(() => {
    if (isTranscribing) {
      transcriptionListenerRef.current = transcriptionService.addListener(async (event, data) => {
        if (event === 'update') {
          const displayText = formatTranscriptionForDisplay(data.text);
          setVisitData(prev => ({
            ...prev,
            transcription: prev.transcription
              ? `${prev.transcription}\n\n${displayText}`.trim()
              : displayText
          }));
          if (jsonlLoggerRef.current && data.text) {
            const logger = jsonlLoggerRef.current;
            const now = Date.now();
            const toRel = makeRelativeTimer(logger.t0);
            const tStart = toRel(windowStartRef.current);
            const tEnd = toRel(now);
            windowStartRef.current = now;
            const patientText = extractPatientText(data.text) || data.text;
            const keywordAnalysis = analyzeKeywords(patientText);
            const sentimentAnalysis = await analyzeSentiment(patientText);
            const semanticAnalysis = analyzeSemantics(patientText);
            logger.logWindow({ tStart, tEnd, wordCount: data.text.trim().split(/\s+/).length, keywordAnalysis, sentimentAnalysis, semanticAnalysis });
          }

        } else if (event === 'complete') {
          const displayFull = formatTranscriptionForDisplay(data.full_text || "");
          setVisitData(prev => ({ ...prev, transcription: displayFull || prev.transcription }));
          setIsTranscribing(false);

        } else if (event === 'error') {
          setTranscriptionError(data.message);
          setIsTranscribing(false);
        }
      });
    }

    return () => {
      if (transcriptionListenerRef.current) {
        transcriptionListenerRef.current();
        transcriptionListenerRef.current = null;
      }
    };
  }, [isTranscribing]);

  const createPatientMutation = useMutation({
    mutationFn: (patientData) => api.entities.Patient.create(patientData),
    onSuccess: (newPatient) => {
      queryClient.invalidateQueries(['patients']);
      setSelectedPatientId(newPatient.id);
      setShowNewPatientDialog(false);
      setNewPatient({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        gender: "",
        medical_record_number: "",
        primary_diagnosis: "",
        notes: ""
      });
    },
  });

  const createVisitMutation = useMutation({
    mutationFn: async (data) => {
      const visit = await api.entities.Visit.create(data);
      return visit;
    },
    onSuccess: (visit) => {
      queryClient.invalidateQueries(['visits']);
      navigate(createPageUrl(`VisitDetails?id=${visit.id}`));
    },
  });

  const handleCreatePatient = () => {
    createPatientMutation.mutate(newPatient);
  };

  const handleStartTranscription = async () => {
    try {
      setTranscriptionError(null);
      setIsStartingTranscription(true);
      await transcriptionService.start();

      // Initialize the JSONL logger for this recording session
      const t0 = Date.now();
      jsonlLoggerRef.current = new AudioJsonlLogger({
        visitId: selectedPatientId || `session_${t0}`,
        patientId: selectedPatientId || 'unknown',
        t0,
      });
      windowStartRef.current = t0;

      setIsTranscribing(true);
    } catch (error) {
      console.error('Failed to start transcription:', error);
      setTranscriptionError(error.message || 'Failed to start transcription. Make sure the Python backend is running on port 5001.');
      setIsTranscribing(false);
    } finally {
      setIsStartingTranscription(false);
    }
  };

  const handleStopTranscription = async () => {
    try {
      const result = await transcriptionService.stop();
      if (result && result.full_text) {
        setVisitData(prev => ({
          ...prev,
          transcription: formatTranscriptionForDisplay(result.full_text)
        }));
      }
      setIsTranscribing(false);
      setTranscriptionError(null);
    } catch (error) {
      console.error('Failed to stop transcription:', error);
      setTranscriptionError(error.message || 'Failed to stop transcription');
      setIsTranscribing(false);
    }
  };

  const handleSpeakerSegments = (segment) => {
    setSpeakerSegments(prev => [...prev, segment]);
  };

  const analyzeTranscription = async () => {
    if (!visitData.transcription || !selectedPatientId) return;
    
    if (!visitData.bp_systolic || !visitData.bp_diastolic || !visitData.heart_rate) {
      alert("Please enter required vital signs: Blood Pressure and Heart Rate");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress({ openai: 'running', ollama: 'running' });

    try {
      const results = await compareAllModels(visitData, (model, status) => {
        console.log(`${model}: ${status}`);
        setAnalysisProgress(prev => ({ ...prev, [model]: status }));
      });

      const consensus = await getConsensusResult(results, visitData.transcription);

      if (!consensus) {
        alert("All AI models failed. Please check your configuration and try again.");
        setIsAnalyzing(false);
        return;
      }

      // Write summary record and flush audio.jsonl to backend
      /*if (jsonlLoggerRef.current) {
        jsonlLoggerRef.current.logSummary();
        try {
          await jsonlLoggerRef.current.flush('http://localhost:5001');
          console.log(' audio.jsonl flushed to backend');
        } catch (err) {
          console.warn('⚠️ Could not flush audio.jsonl (backend may be offline):', err.message);
          // non-fatal — visit still saves normally
        }
        jsonlLoggerRef.current = null;
      }*/
     // If no live recording was done, create a one-shot logger from manual text
      if (!jsonlLoggerRef.current && visitData.transcription) {
        const t0 = Date.now();
        jsonlLoggerRef.current = new AudioJsonlLogger({
          visitId: selectedPatientId,
          patientId: selectedPatientId,
          t0,
        });
        const patientText = extractPatientText(visitData.transcription) || visitData.transcription;
        const keywordAnalysis   = analyzeKeywords(patientText);
        const sentimentAnalysis = await analyzeSentiment(patientText);
        const semanticAnalysis  = analyzeSemantics(patientText);
        jsonlLoggerRef.current.logWindow({
          tStart: 0,
          tEnd: parseFloat((visitData.transcription.trim().split(/\s+/).length / 2.5).toFixed(3)),
          wordCount: patientText.trim().split(/\s+/).length,
          keywordAnalysis,
          sentimentAnalysis,
          semanticAnalysis,
        });
      }

      if (jsonlLoggerRef.current) {
        jsonlLoggerRef.current.logSummary();
        jsonlLoggerRef.current.download();
        jsonlLoggerRef.current = null;
      }


      const visitNumber = existingVisits.length + 1;
      
      createVisitMutation.mutate({
        patient_id: selectedPatientId,
        visit_number: visitNumber,
        ...visitData,
        temperature_unit: tempUnit, 
        speaker_segments: speakerSegments,
        keyword_analysis: consensus.keyword_analysis,
        sentiment_analysis: consensus.sentiment_analysis,
        semantic_analysis: consensus.semantic_analysis,
        ai_assessment: consensus.ai_assessment,
        ai_comparison: results
      });

    } catch (error) {
      console.error("Analysis error:", error);
      alert("Error analyzing transcription. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const calculateBMI = (weight, height) => {
    if (!weight || !height) return "";
    const bmi = (weight / ((height / 100) ** 2)).toFixed(1);
    return bmi;
  };

  const handleWeightChange = (value) => {
    setVisitData(prev => {
      const newData = { ...prev, weight: value };
      if (prev.height) {
        newData.bmi = calculateBMI(value, prev.height);
      }
      return newData;
    });
  };

  const handleHeightChange = (value) => {
    setVisitData(prev => {
      const newData = { ...prev, height: value };
      if (prev.weight) {
        newData.bmi = calculateBMI(prev.weight, value);
      }
      return newData;
    });
  };
        
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(createPageUrl("Dashboard"))}
              className="border-teal-200 hover:bg-teal-50"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-teal-900 mb-1">New Patient Visit</h1>
              <p className="text-sm text-teal-700">Record and analyze patient consultation</p>
            </div>
          </div>
        </div>

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <FileText className="w-4 h-4" />
              Visit Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="patient" className="text-sm font-medium text-teal-900">Select Patient *</Label>
              <div className="flex gap-2">
                <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose a patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.first_name} {patient.last_name} {patient.medical_record_number && `(MRN: ${patient.medical_record_number})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => setShowNewPatientDialog(true)}
                  className="border-teal-300 hover:bg-teal-50"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  New Patient
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="visit_date" className="text-sm font-medium text-teal-900">Visit Date *</Label>
                <Input
                  id="visit_date"
                  type="date"
                  value={visitData.visit_date}
                  onChange={(e) => setVisitData({...visitData, visit_date: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chief_complaint" className="text-sm font-medium text-teal-900">Chief Complaint</Label>
                <Input
                  id="chief_complaint"
                  placeholder="e.g., Shortness of breath"
                  value={visitData.chief_complaint}
                  onChange={(e) => setVisitData({...visitData, chief_complaint: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-teal-900">Vital Signs *</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bp" className="text-xs">Blood Pressure (mmHg) *</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id="bp"
                      type="number"
                      placeholder="120"
                      value={visitData.bp_systolic}
                      onChange={(e) => setVisitData({...visitData, bp_systolic: e.target.value})}
                      className="text-sm"
                    />
                    <span className="text-gray-400">/</span>
                    <Input
                      type="number"
                      placeholder="80"
                      value={visitData.bp_diastolic}
                      onChange={(e) => setVisitData({...visitData, bp_diastolic: e.target.value})}
                      className="text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="heart_rate" className="text-xs">Heart Rate (bpm) *</Label>
                  <Input
                    id="heart_rate"
                    type="number"
                    placeholder="72"
                    value={visitData.heart_rate}
                    onChange={(e) => setVisitData({...visitData, heart_rate: e.target.value})}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="respiratory_rate" className="text-xs">Respiratory Rate (/min)</Label>
                  <Input
                    id="respiratory_rate"
                    type="number"
                    placeholder="16"
                    value={visitData.respiratory_rate}
                    onChange={(e) => setVisitData({...visitData, respiratory_rate: e.target.value})}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="temperature" className="text-xs">Temperature</Label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={tempUnit === 'fahrenheit' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTempUnit('fahrenheit')}
                        className="h-6 px-2 text-xs"
                      >
                        °F
                      </Button>
                      <Button
                        type="button"
                        variant={tempUnit === 'celsius' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTempUnit('celsius')}
                        className="h-6 px-2 text-xs"
                      >
                        °C
                      </Button>
                    </div>
                  </div>
                  <Input
                    id="temperature"
                    type="number"
                    step="0.1"
                    placeholder={tempUnit === 'fahrenheit' ? '98.6' : '37.0'}
                    value={visitData.temperature}
                    onChange={(e) => setVisitData({...visitData, temperature: e.target.value})}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="spo2" className="text-xs">SpO2 (%)</Label>
                  <Input
                    id="spo2"
                    type="number"
                    placeholder="98"
                    value={visitData.spo2}
                    onChange={(e) => setVisitData({...visitData, spo2: e.target.value})}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-teal-900">Physical Measurements</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={units === 'metric' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setUnits('metric')}
                    className="text-xs"
                  >
                    Metric
                  </Button>
                  <Button
                    type="button"
                    variant={units === 'imperial' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setUnits('imperial')}
                    className="text-xs"
                  >
                    Imperial
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="height" className="text-xs">
                    Height ({units === 'metric' ? 'cm' : 'in'})
                  </Label>
                  <Input
                    id="height"
                    type="number"
                    step="0.1"
                    placeholder={units === 'metric' ? '170' : '67'}
                    value={visitData.height}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weight" className="text-xs">
                    Weight ({units === 'metric' ? 'kg' : 'lbs'})
                  </Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.1"
                    placeholder={units === 'metric' ? '70' : '154'}
                    value={visitData.weight}
                    onChange={(e) => handleWeightChange(e.target.value)}
                    className="text-sm"
                  />
                </div>

                {visitData.bmi && (
                  <div className="space-y-2">
                    <Label className="text-xs">BMI</Label>
                    <div className="text-sm font-semibold text-teal-700 bg-teal-50 rounded px-3 py-2">
                      {visitData.bmi}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {parseFloat(visitData.bmi) < 18.5 ? '⚠️ Underweight' :
                       parseFloat(visitData.bmi) < 25 ? '✓ Normal' :
                       parseFloat(visitData.bmi) < 30 ? '⚠️ Overweight' :
                       '⚠️ Obese'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base text-teal-900">
                <FileText className="w-4 h-4" />
                Live Monitoring
              </CardTitle>
              <div className="flex items-center gap-2">
                {!camerasActive ? (
                  <Button size="sm" variant="outline" onClick={startCameras} className="border-teal-200">Start Cameras</Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={stopCameras}>Stop Cameras</Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {/* Motion Analysis (left) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-teal-900">Motion Analysis</h4>
                  <span className="text-xs text-gray-500">Live</span>
                </div>
                <div className="relative bg-black rounded overflow-hidden" style={{aspectRatio: '4/3'}}>
                  <video ref={video1Ref} className="w-full h-full object-cover" playsInline muted />
                  <canvas ref={canvas1Ref} className="absolute inset-0 w-full h-full pointer-events-none" />
                </div>
                <p className="text-xs text-gray-600">Using webcam (prototype). Motion overlay shown.</p>
              </div>

              {/* Facial Analysis (right) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-teal-900">Facial Analysis</h4>
                  <span className="text-xs text-gray-500">Live</span>
                </div>
                <div className="relative bg-black rounded overflow-hidden" style={{aspectRatio: '4/3'}}>
                  <video ref={video2Ref} className="w-full h-full object-cover" playsInline muted />
                  <canvas ref={canvas2Ref} className="absolute inset-0 w-full h-full pointer-events-none" />
                </div>
                <p className="text-xs text-gray-600">Using webcam (prototype). Facial landmarks / analysis will be added.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4 mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <FileText className="w-4 h-4" />
              Clinical Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="transcription" className="text-sm font-medium text-teal-900">Patient Transcription *</Label>
                <div className="flex items-center gap-2">
                  {isStartingTranscription ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled
                      className="flex items-center gap-2 border-teal-200 bg-teal-50/50"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Starting up...
                    </Button>
                  ) : !isTranscribing ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleStartTranscription}
                      className="flex items-center gap-2 border-teal-200 hover:bg-teal-50"
                    >
                      <Mic className="w-4 h-4" />
                      Start Recording
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleStopTranscription}
                      className="flex items-center gap-2 border-red-200 hover:bg-red-50 text-red-700"
                    >
                      <MicOff className="w-4 h-4" />
                      Stop Recording
                    </Button>
                  )}
                </div>
              </div>
              {isStartingTranscription && (
                <div className="flex items-center gap-2 text-xs text-teal-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Connecting and starting transcription...</span>
                </div>
              )}
              {isTranscribing && !isStartingTranscription && (
                <div className="flex items-center gap-2 text-xs text-blue-600">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span>Recording... Speak clearly into your microphone</span>
                </div>
              )}
              {transcriptionError && (
                <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                  ⚠️ {transcriptionError}
                </div>
              )}
              <Textarea
                id="transcription"
                placeholder="Type patient's spoken words here or use the microphone button to record..."
                value={visitData.transcription}
                onChange={(e) => setVisitData({...visitData, transcription: e.target.value})}
                className="min-h-[180px] font-mono text-sm"
              />
              <p className="text-xs text-teal-600">
                ✓ Real-time transcription with speaker detection and timestamps
              </p>
              <p className="text-xs text-slate-500">
                AI will analyze with OpenAI GPT-4 and Ollama Llama (if running)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="physician_notes" className="text-sm font-medium text-teal-900">Clinical Notes</Label>
              <Textarea
                id="physician_notes"
                placeholder="Additional observations..."
                value={visitData.physician_notes}
                onChange={(e) => setVisitData({...visitData, physician_notes: e.target.value})}
                className="min-h-[100px]"
              />
            </div>
          </CardContent>
        </Card>

        {isAnalyzing && (
          <Card className="border-blue-200 bg-blue-50/50 mb-4">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <h3 className="font-semibold text-blue-900 mb-2">Analyzing with AI Models...</h3>
                
                <div className="flex items-center gap-3">
                  {analysisProgress.openai === 'running' && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  {analysisProgress.openai === 'complete' && <CheckCircle className="w-4 h-4 text-green-600" />}
                  {analysisProgress.openai === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                  {analysisProgress.openai === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                  <span className="text-sm">OpenAI GPT-4</span>
                </div>

                <div className="flex items-center gap-3">
                  {analysisProgress.ollama === 'running' && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  {analysisProgress.ollama === 'complete' && <CheckCircle className="w-4 h-4 text-green-600" />}
                  {analysisProgress.ollama === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                  {analysisProgress.ollama === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                  <span className="text-sm">Ollama Llama</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-teal-900 mb-1">Ready to Analyze</h3>
                <p className="text-xs text-teal-700">
                  Multi-model analysis (OpenAI + Ollama) with inter-word frequency tracking
                </p>
              </div>
              <Button
                onClick={analyzeTranscription}
                disabled={!selectedPatientId || !visitData.transcription || isAnalyzing}
                className="bg-teal-600 hover:bg-teal-700"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Analyze Visit
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showNewPatientDialog} onOpenChange={setShowNewPatientDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <UserPlus className="w-5 h-5" />
                Add New Patient
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-sm">First Name *</Label>
                <Input
                  id="first_name"
                  value={newPatient.first_name}
                  onChange={(e) => setNewPatient({...newPatient, first_name: e.target.value})}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-sm">Last Name *</Label>
                <Input
                  id="last_name"
                  value={newPatient.last_name}
                  onChange={(e) => setNewPatient({...newPatient, last_name: e.target.value})}
                  placeholder="Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob" className="text-sm">Date of Birth *</Label>
                <Input
                  id="dob"
                  type="date"
                  value={newPatient.date_of_birth}
                  onChange={(e) => setNewPatient({...newPatient, date_of_birth: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender" className="text-sm">Gender</Label>
                <Select value={newPatient.gender} onValueChange={(value) => setNewPatient({...newPatient, gender: value})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mrn" className="text-sm">Medical Record Number</Label>
                <Input
                  id="mrn"
                  value={newPatient.medical_record_number}
                  onChange={(e) => setNewPatient({...newPatient, medical_record_number: e.target.value})}
                  placeholder="MRN-12345"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="diagnosis" className="text-sm">Primary Diagnosis</Label>
                <Input
                  id="diagnosis"
                  value={newPatient.primary_diagnosis}
                  onChange={(e) => setNewPatient({...newPatient, primary_diagnosis: e.target.value})}
                  placeholder="e.g., CHF"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowNewPatientDialog(false)}>Cancel</Button>
              <Button 
                size="sm"
                onClick={handleCreatePatient} 
                disabled={!newPatient.first_name || !newPatient.last_name || !newPatient.date_of_birth || createPatientMutation.isPending}
              >
                {createPatientMutation.isPending ? 'Creating...' : 'Create Patient'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}