import React from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FileText, Activity, Plus, AlertCircle, Brain } from "lucide-react";
import { format, differenceInYears } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();

  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-created_date'),
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ['visits'],
    queryFn: () => api.entities.Visit.list('-visit_date', 10),
  });

  const totalPatients = patients.length;
  const totalVisits = visits.length;
  const recentVisits = visits.slice(0, 5);

  const getPatientById = (patientId) => {
    return patients.find(p => p.id === patientId);
  };

  const calculateAge = (dob) => {
    return differenceInYears(new Date(), new Date(dob));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header*/}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-1">
            Welcome {user?.fullName}
          </h1>
          <p className="text-lg text-slate-600">
            to the Doctor AI Smart Patient Exam Room
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="border-teal-200 bg-white/80 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-teal-700">Total Patients</CardTitle>
              <Users className="w-4 h-4 text-teal-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-teal-900">{totalPatients}</div>
              <p className="text-xs text-teal-600 mt-1">Active records</p>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-white/80 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-emerald-700">Total Visits</CardTitle>
              <FileText className="w-4 h-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-emerald-900">{totalVisits}</div>
              <p className="text-xs text-emerald-600 mt-1">Consultations recorded</p>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-white/80 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-700">AI Analyses</CardTitle>
              <Brain className="w-4 h-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-green-900">
                {visits.filter(v => v.ai_assessment).length}
              </div>
              <p className="text-xs text-green-600 mt-1">AI-powered diagnostics</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-teal-900 mb-1">Record New Visit</h3>
                  <p className="text-sm text-teal-700 mb-4">Start patient consultation with AI analysis</p>
                  <Link to={createPageUrl("NewVisit")}>
                    <Button className="bg-teal-600 hover:bg-teal-700 text-sm h-9">
                      <Plus className="w-4 h-4 mr-2" />
                      New Visit
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-white/80 backdrop-blur">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-emerald-900 mb-1">Patient Management</h3>
                  <p className="text-sm text-emerald-700 mb-4">View all patients and track progress</p>
                  <Link to={createPageUrl("Patients")}>
                    <Button variant="outline" className="text-sm h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                      <Users className="w-4 h-4 mr-2" />
                      View Patients
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Visits */}
        <Card className="border-teal-200 bg-white/80 backdrop-blur">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-base font-semibold text-teal-900">Recent Visits</CardTitle>
              <Link to={createPageUrl("Patients")}>
                <Button variant="ghost" size="sm" className="text-xs text-teal-600 hover:text-teal-800 hover:bg-teal-50">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {visitsLoading ? (
              <div className="text-center py-8 text-teal-600 text-sm">Loading visits...</div>
            ) : recentVisits.length === 0 ? (
              <div className="text-center py-12">
                <AlertCircle className="w-10 h-10 text-teal-300 mx-auto mb-3" />
                <p className="text-sm text-teal-600 mb-4">No visits recorded yet</p>
                <Link to={createPageUrl("NewVisit")}>
                  <Button size="sm" className="bg-teal-600 hover:bg-teal-700">Record First Visit</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentVisits.map((visit) => {
                  const patient = getPatientById(visit.patient_id);
                  return (
                    <Link 
                      key={visit.id}
                      to={createPageUrl(`VisitDetails?id=${visit.id}`)}
                      className="block"
                    >
                      <div className="p-4 border border-teal-200 rounded-lg hover:border-teal-300 hover:bg-teal-50/50 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-medium text-teal-900 text-sm">
                              {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                            </h3>
                            <p className="text-xs text-teal-700">
                              {patient && `Age ${calculateAge(patient.date_of_birth)} • MRN: ${patient.medical_record_number || 'N/A'}`}
                            </p>
                          </div>
                          <span className="text-xs text-teal-600">
                            {format(new Date(visit.visit_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{visit.chief_complaint || 'No chief complaint recorded'}</p>
                        {visit.sentiment_analysis && (
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              visit.sentiment_analysis.overall_sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                              visit.sentiment_analysis.overall_sentiment === 'negative' ? 'bg-amber-100 text-amber-700' :
                              'bg-teal-100 text-teal-700'
                            }`}>
                              {visit.sentiment_analysis.overall_sentiment || 'neutral'}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}