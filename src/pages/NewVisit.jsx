import React, { useState } from "react";
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
import { ArrowLeft, FileText, Brain, Loader2, UserPlus, CheckCircle, XCircle, Clock } from "lucide-react";
import { compareAllModels, getConsensusResult } from "@/services/aiService";

export default function NewVisit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitData, setVisitData] = useState({
    visit_date: new Date().toISOString().split('T')[0],
    chief_complaint: "",
    transcription: "",
    physician_notes: ""
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({
    openai: 'pending',
    ollama: 'pending'
  });
  const [showNewPatientDialog, setShowNewPatientDialog] = useState(false);
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

  const analyzeTranscription = async () => {
    if (!visitData.transcription || !selectedPatientId) return;

    setIsAnalyzing(true);
    setAnalysisProgress({ openai: 'running', ollama: 'running' });

    try {
      // Run multi-model analysis (OpenAI + Ollama only)
      const results = await compareAllModels(visitData.transcription, (model, status) => {
        console.log(`${model}: ${status}`);
        setAnalysisProgress(prev => ({ ...prev, [model]: status }));
      });

      // Get consensus result from successful models 
      const consensus = await getConsensusResult(results, visitData.transcription);

      if (!consensus) {  // ✅ FIXED: Changed from consensusData to consensus
        alert("All AI models failed. Please check your configuration and try again.");
        setIsAnalyzing(false);
        return;
      }

      // Create visit with all analysis data
      const visitNumber = existingVisits.length + 1;
      
      createVisitMutation.mutate({
        patient_id: selectedPatientId,
        visit_number: visitNumber,
        ...visitData,
        // Store consensus results 
        keyword_analysis: consensus.keyword_analysis,      // ✅ FIXED
        sentiment_analysis: consensus.sentiment_analysis,  // ✅ FIXED
        semantic_analysis: consensus.semantic_analysis,    // ✅ FIXED
        ai_assessment: consensus.ai_assessment,            // ✅ FIXED
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

            {/* Transcription */}
            <div className="space-y-2">
              <Label htmlFor="transcription" className="text-sm font-medium text-teal-900">Patient Transcription *</Label>
              <Textarea
                id="transcription"
                placeholder="Type patient's spoken words here..."
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