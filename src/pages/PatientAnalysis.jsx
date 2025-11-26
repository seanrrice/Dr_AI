import React from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingDown, TrendingUp, User, Calendar, FileText } from "lucide-react";
import { format, differenceInYears } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";

export default function PatientAnalysis() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const patientId = urlParams.get('id');

  const { data: patient, isLoading: patientLoading } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const patients = await api.entities.Patient.filter({ id: patientId });
      return patients[0];
    },
    enabled: !!patientId
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ['visits', patientId],
    queryFn: () => api.entities.Visit.filter({ patient_id: patientId }, 'visit_date'),
    enabled: !!patientId
  });

  if (patientLoading || visitsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-slate-500">Loading patient data...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-slate-500">Patient not found</div>
      </div>
    );
  }

  // Prepare trend data
  const keywordTrendData = visits.map((visit, idx) => ({
    visit: `Visit ${visit.visit_number}`,
    date: format(new Date(visit.visit_date), 'MMM d'),
    keywords: Object.keys(visit.keyword_analysis?.diagnostic_keywords || {}).length,
    keywordPercentage: visit.keyword_analysis?.keyword_percentage || 0
  }));

  const sentimentTrendData = visits.map((visit) => ({
    visit: `Visit ${visit.visit_number}`,
    date: format(new Date(visit.visit_date), 'MMM d'),
    sentiment: visit.sentiment_analysis?.sentiment_score || 0,
    distress: visit.sentiment_analysis?.distress_level === 'high' ? 3 : 
              visit.sentiment_analysis?.distress_level === 'medium' ? 2 : 1
  }));

  // Get most common keywords across all visits
  const allKeywords = {};
  visits.forEach(visit => {
    const keywords = visit.keyword_analysis?.diagnostic_keywords || {};
    Object.entries(keywords).forEach(([word, count]) => {
      allKeywords[word] = (allKeywords[word] || 0) + count;
    });
  });

  const topKeywords = Object.entries(allKeywords)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl("Patients"))}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-900">Patient Trend Analysis</h1>
            <p className="text-slate-600">Tracking progress and patterns over time</p>
          </div>
        </div>

        {/* Patient Info Card */}
        <Card className="bg-white border-none shadow-lg mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-bold text-3xl">
                {patient.first_name[0]}{patient.last_name[0]}
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {patient.first_name} {patient.last_name}
                </h2>
                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Age {differenceInYears(new Date(), new Date(patient.date_of_birth))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    DOB: {format(new Date(patient.date_of_birth), 'MMM d, yyyy')}
                  </div>
                  {patient.medical_record_number && (
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      MRN: {patient.medical_record_number}
                    </div>
                  )}
                </div>
                {patient.primary_diagnosis && (
                  <Badge className="mt-3 bg-blue-100 text-blue-800">{patient.primary_diagnosis}</Badge>
                )}
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-slate-900">{visits.length}</div>
                <div className="text-sm text-slate-600">Total Visits</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {visits.length === 0 ? (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 mb-4">No visits recorded for this patient yet</p>
              <Link to={createPageUrl("NewVisit")}>
                <Button>Record First Visit</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Keyword Trend Chart */}
            <Card className="bg-white border-none shadow-lg mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Diagnostic Keyword Trends
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={keywordTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="keywords" stroke="#3b82f6" strokeWidth={2} name="Keyword Count" />
                    <Line type="monotone" dataKey="keywordPercentage" stroke="#10b981" strokeWidth={2} name="Keyword %" />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-sm text-slate-500 mt-4 text-center">
                  Tracking frequency of diagnostic terms used during patient consultations
                </p>
              </CardContent>
            </Card>

            {/* Sentiment Trend Chart */}
            <Card className="bg-white border-none shadow-lg mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5" />
                  Sentiment & Distress Trends
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={sentimentTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="sentiment" stroke="#8b5cf6" strokeWidth={2} name="Sentiment Score" />
                    <Line type="monotone" dataKey="distress" stroke="#ef4444" strokeWidth={2} name="Distress Level" />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-sm text-slate-500 mt-4 text-center">
                  Monitoring emotional state and patient distress levels over time
                </p>
              </CardContent>
            </Card>

            {/* Top Keywords Chart */}
            {topKeywords.length > 0 && (
              <Card className="bg-white border-none shadow-lg mb-6">
                <CardHeader>
                  <CardTitle>Most Frequent Diagnostic Keywords</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topKeywords}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="word" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-sm text-slate-500 mt-4 text-center">
                    Cumulative frequency of diagnostic terms across all visits
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Visit History */}
            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle>Visit History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {visits.map((visit) => (
                    <Link
                      key={visit.id}
                      to={createPageUrl(`VisitDetails?id=${visit.id}`)}
                      className="block"
                    >
                      <div className="p-4 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-blue-300 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-semibold text-slate-900">Visit #{visit.visit_number}</h3>
                            <p className="text-sm text-slate-600">{visit.chief_complaint || 'No chief complaint'}</p>
                          </div>
                          <span className="text-sm text-slate-500">
                            {format(new Date(visit.visit_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          {visit.keyword_analysis && (
                            <Badge variant="outline">
                              {Object.keys(visit.keyword_analysis.diagnostic_keywords || {}).length} keywords
                            </Badge>
                          )}
                          {visit.sentiment_analysis && (
                            <Badge className={
                              visit.sentiment_analysis.overall_sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                              visit.sentiment_analysis.overall_sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }>
                              {visit.sentiment_analysis.overall_sentiment}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}