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
import { compareAllModels, getConsensusResult } from "@/services/aiService";
import { transcriptionService } from "@/services/transcriptionService";

// Show Patient/Doctor in UI; backend console keeps Mic 1 / Mic 2
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
    // Vital signs
    bp_systolic: "",
    bp_diastolic: "",
    heart_rate: "",
    respiratory_rate: "",
    temperature: "",
    spo2: "",
    // Physical measurements
    height: "",
    weight: "",
    bmi: ""
  });
  const [units, setUnits] = useState('metric'); // 'metric' or 'imperial'
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({
    openai: 'pending',
    ollama: 'pending'
  });
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStartingTranscription, setIsStartingTranscription] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);
  const [showNewPatientDialog, setShowNewPatientDialog] = useState(false);
  const transcriptionListenerRef = useRef(null);
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
      transcriptionListenerRef.current = transcriptionService.addListener((event, data) => {
        if (event === 'update') {
          // Append new transcription text with newline after each segment (Patient/Doctor in UI)
          const displayText = formatTranscriptionForDisplay(data.text);
          setVisitData(prev => ({
            ...prev,
            transcription: prev.transcription 
              ? `${prev.transcription}\n\n${displayText}`.trim()
              : displayText
          }));
        } else if (event === 'complete') {
          // Final transcript received (Patient/Doctor in UI)
          const displayFull = formatTranscriptionForDisplay(data.full_text || "");
          setVisitData(prev => ({
            ...prev,
            transcription: displayFull || prev.transcription
          }));
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
      setIsTranscribing(true);
    } catch (error) {
      console.error('Failed to start transcription:', error);
      setTranscriptionError(error.message || 'Failed to start transcription. Make sure the transcription server is running.');
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

  const analyzeTranscription = async () => {
    if (!visitData.transcription || !selectedPatientId) return;
    
    // Validate required vitals
    if (!visitData.bp_systolic || !visitData.bp_diastolic || !visitData.heart_rate) {
      alert("Please enter required vital signs: Blood Pressure and Heart Rate");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress({ openai: 'running', ollama: 'running' });

    try {
      // Run multi-model analysis 
      const results = await compareAllModels(visitData, (model, status) => {
        console.log(`${model}: ${status}`);
        setAnalysisProgress(prev => ({ ...prev, [model]: status }));
      });

      // Get consensus result from successful models 
      const consensus = await getConsensusResult(results, visitData.transcription);

      if (!consensus) {
        alert("All AI models failed. Please check your configuration and try again.");
        setIsAnalyzing(false);
        return;
      }

      // Create visit with all analysis data including vitals
      const visitNumber = existingVisits.length + 1;
      
      createVisitMutation.mutate({
        patient_id: selectedPatientId,
        visit_number: visitNumber,
        ...visitData,
        // Store consensus results 
        keyword_analysis: consensus.keyword_analysis,
        sentiment_analysis: consensus.sentiment_analysis,
        semantic_analysis: consensus.semantic_analysis,
        ai_assessment: consensus.ai_assessment,
        // Store all model results for comparison 
        ai_comparison: results
      });

    } catch (error) {
      console.error("Analysis error:", error);
      alert("Error analyzing transcription. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };
        
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
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

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <FileText className="w-4 h-4" />
              Visit Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Patient Selection */}
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
                  className="flex items-center gap-2 border-teal-200 hover:bg-teal-50"
                  size="sm"
                >
                  <UserPlus className="w-4 h-4" />
                  New
                </Button>
              </div>
              {selectedPatientId && (
                <p className="text-xs text-teal-600">
                  Visit #{existingVisits.length + 1} for this patient
                </p>
              )}
            </div>

            {/* Visit Date */}
            <div className="space-y-2">
              <Label htmlFor="visit_date" className="text-sm font-medium text-teal-900">Visit Date *</Label>
              <Input
                id="visit_date"
                type="date"
                value={visitData.visit_date}
                onChange={(e) => setVisitData({...visitData, visit_date: e.target.value})}
              />
            </div>

            {/* Chief Complaint */}
            <div className="space-y-2">
              <Label htmlFor="chief_complaint" className="text-sm font-medium text-teal-900">Chief Complaint</Label>
              <Input
                id="chief_complaint"
                placeholder="e.g., Shortness of breath"
                value={visitData.chief_complaint}
                onChange={(e) => setVisitData({...visitData, chief_complaint: e.target.value})}
              />
            </div>
          </CardContent>
        </Card>

        {/* Vital Signs & Physical Measurements */}
        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base text-teal-900">
                <Activity className="w-4 h-4" />
                Vital Signs & Physical Measurements
              </CardTitle>
              {/* Unit Toggle */}
              <div className="flex items-center gap-2 text-sm">
                <Button
                  variant={units === 'metric' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUnits('metric')}
                  className="h-7 text-xs"
                >
                  Metric
                </Button>
                <Button
                  variant={units === 'imperial' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUnits('imperial')}
                  className="h-7 text-xs"
                >
                  Imperial
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Vital Signs - Required */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-teal-900">Vital Signs</h3>
              
              {/* Blood Pressure - Required */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bp_systolic" className="text-xs font-medium text-teal-900">
                    Systolic BP * <span className="text-gray-500">(mmHg)</span>
                  </Label>
                  <Input
                    id="bp_systolic"
                    type="number"
                    placeholder="120"
                    value={visitData.bp_systolic}
                    onChange={(e) => setVisitData({...visitData, bp_systolic: e.target.value})}
                    className={visitData.bp_systolic && (parseInt(visitData.bp_systolic) < 90 || parseInt(visitData.bp_systolic) > 140) ? 'border-yellow-500' : ''}
                  />
                  {visitData.bp_systolic && parseInt(visitData.bp_systolic) > 140 && (
                    <p className="text-xs text-yellow-600">⚠️ Elevated</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bp_diastolic" className="text-xs font-medium text-teal-900">
                    Diastolic BP * <span className="text-gray-500">(mmHg)</span>
                  </Label>
                  <Input
                    id="bp_diastolic"
                    type="number"
                    placeholder="80"
                    value={visitData.bp_diastolic}
                    onChange={(e) => setVisitData({...visitData, bp_diastolic: e.target.value})}
                    className={visitData.bp_diastolic && (parseInt(visitData.bp_diastolic) < 60 || parseInt(visitData.bp_diastolic) > 90) ? 'border-yellow-500' : ''}
                  />
                  {visitData.bp_diastolic && parseInt(visitData.bp_diastolic) > 90 && (
                    <p className="text-xs text-yellow-600">⚠️ Elevated</p>
                  )}
                </div>
              </div>

              {/* Heart Rate - Required */}
              <div className="space-y-1">
                <Label htmlFor="heart_rate" className="text-xs font-medium text-teal-900">
                  Heart Rate * <span className="text-gray-500">(bpm)</span>
                </Label>
                <Input
                  id="heart_rate"
                  type="number"
                  placeholder="72"
                  value={visitData.heart_rate}
                  onChange={(e) => setVisitData({...visitData, heart_rate: e.target.value})}
                  className={visitData.heart_rate && (parseInt(visitData.heart_rate) < 60 || parseInt(visitData.heart_rate) > 100) ? 'border-yellow-500' : ''}
                />
                {visitData.heart_rate && (
                  <p className="text-xs text-gray-500">
                    {parseInt(visitData.heart_rate) < 60 ? '⚠️ Bradycardia' : 
                     parseInt(visitData.heart_rate) > 100 ? '⚠️ Tachycardia' : 
                     '✓ Normal'}
                  </p>
                )}
              </div>

              {/* Optional Vitals */}
              <div className="grid grid-cols-3 gap-3">
                {/* Respiratory Rate */}
                <div className="space-y-1">
                  <Label htmlFor="respiratory_rate" className="text-xs font-medium text-gray-700">
                    Respiratory Rate <span className="text-gray-500">(/min)</span>
                  </Label>
                  <Input
                    id="respiratory_rate"
                    type="number"
                    placeholder="16"
                    value={visitData.respiratory_rate}
                    onChange={(e) => setVisitData({...visitData, respiratory_rate: e.target.value})}
                  />
                </div>

                {/* Temperature */}
                <div className="space-y-1">
                  <Label htmlFor="temperature" className="text-xs font-medium text-gray-700">
                    Temp <span className="text-gray-500">({units === 'metric' ? '°C' : '°F'})</span>
                  </Label>
                  <Input
                    id="temperature"
                    type="number"
                    step="0.1"
                    placeholder={units === 'metric' ? '37.0' : '98.6'}
                    value={visitData.temperature}
                    onChange={(e) => setVisitData({...visitData, temperature: e.target.value})}
                  />
                </div>

                {/* SpO2 */}
                <div className="space-y-1">
                  <Label htmlFor="spo2" className="text-xs font-medium text-gray-700">
                    SpO₂ <span className="text-gray-500">(%)</span>
                  </Label>
                  <Input
                    id="spo2"
                    type="number"
                    placeholder="98"
                    value={visitData.spo2}
                    onChange={(e) => setVisitData({...visitData, spo2: e.target.value})}
                    className={visitData.spo2 && parseInt(visitData.spo2) < 95 ? 'border-yellow-500' : ''}
                  />
                </div>
              </div>
            </div>

            {/* Physical Measurements */}
            <div className="space-y-3 pt-3 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-teal-900">Physical Measurements</h3>
              
              <div className="grid grid-cols-2 gap-3">
                {/* Height */}
                <div className="space-y-1">
                  <Label htmlFor="height" className="text-xs font-medium text-gray-700">
                    Height <span className="text-gray-500">({units === 'metric' ? 'cm' : 'in'})</span>
                  </Label>
                  <Input
                    id="height"
                    type="number"
                    step={units === 'metric' ? '1' : '0.1'}
                    placeholder={units === 'metric' ? '170' : '67'}
                    value={visitData.height}
                    onChange={(e) => {
                      const newHeight = e.target.value;
                      setVisitData(prev => {
                        const updated = {...prev, height: newHeight};
                        // Auto-calculate BMI if both height and weight exist
                        if (newHeight && prev.weight) {
                          const h = units === 'metric' ? parseFloat(newHeight) / 100 : parseFloat(newHeight) * 0.0254;
                          const w = units === 'metric' ? parseFloat(prev.weight) : parseFloat(prev.weight) * 0.453592;
                          updated.bmi = (w / (h * h)).toFixed(1);
                        }
                        return updated;
                      });
                    }}
                  />
                </div>

                {/* Weight */}
                <div className="space-y-1">
                  <Label htmlFor="weight" className="text-xs font-medium text-gray-700">
                    Weight <span className="text-gray-500">({units === 'metric' ? 'kg' : 'lbs'})</span>
                  </Label>
                  <Input
                    id="weight"
                    type="number"
                    step={units === 'metric' ? '0.1' : '0.1'}
                    placeholder={units === 'metric' ? '70' : '154'}
                    value={visitData.weight}
                    onChange={(e) => {
                      const newWeight = e.target.value;
                      setVisitData(prev => {
                        const updated = {...prev, weight: newWeight};
                        // Auto-calculate BMI if both height and weight exist
                        if (prev.height && newWeight) {
                          const h = units === 'metric' ? parseFloat(prev.height) / 100 : parseFloat(prev.height) * 0.0254;
                          const w = units === 'metric' ? parseFloat(newWeight) : parseFloat(newWeight) * 0.453592;
                          updated.bmi = (w / (h * h)).toFixed(1);
                        }
                        return updated;
                      });
                    }}
                  />
                </div>
              </div>

              {/* BMI Display */}
              {visitData.bmi && (
                <div className="p-3 bg-gray-50 rounded border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">BMI:</span>
                    <span className="text-lg font-bold text-teal-900">{visitData.bmi}</span>
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

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <FileText className="w-4 h-4" />
              Clinical Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Transcription */}
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
                AI will analyze with OpenAI GPT-4 and Ollama Llama (if running)
              </p>
            </div>

            {/* Physician Notes */}
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

        {/* Analysis Progress */}
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

        {/* Submit Button */}
        <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-teal-900 mb-1">Ready to Analyze</h3>
                <p className="text-xs text-teal-700">
                  Multi-model analysis (OpenAI + Ollama)
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

        {/* New Patient Dialog */}
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