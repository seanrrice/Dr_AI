import React, { useState } from "react";
import { api } from "@/api/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, TrendingUp, User, Trash2 } from "lucide-react";
import { format, differenceInYears } from "date-fns";

export default function Patients() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState({ open: false, patient: null });
  const [newPatient, setNewPatient] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    medical_record_number: "",
    primary_diagnosis: "",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.entities.Patient.list('-created_date'),
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => api.entities.Visit.list(),
  });

  const createPatientMutation = useMutation({
    mutationFn: (patientData) => api.entities.Patient.create(patientData),
    onSuccess: () => {
      queryClient.invalidateQueries(['patients']);
      setShowAddDialog(false);
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

  const deletePatientMutation = useMutation({
    mutationFn: async (patientId) => {
      // First, delete all visits associated with this patient
      const patientVisits = visits.filter(v => v.patient_id === patientId);
      await Promise.all(
        patientVisits.map(visit => api.entities.Visit.delete(visit.id))
      );
      // Then delete the patient
      return api.entities.Patient.delete(patientId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['patients']);
      queryClient.invalidateQueries(['visits']);
      setDeleteConfirmDialog({ open: false, patient: null });
    },
  });

  const handleCreatePatient = () => {
    createPatientMutation.mutate(newPatient);
  };

  const handleDeletePatient = () => {
    if (deleteConfirmDialog.patient) {
      deletePatientMutation.mutate(deleteConfirmDialog.patient.id);
    }
  };

  const calculateAge = (dob) => {
    return differenceInYears(new Date(), new Date(dob));
  };

  const getPatientVisitCount = (patientId) => {
    return visits.filter(v => v.patient_id === patientId).length;
  };

  const filteredPatients = patients.filter(patient => {
    const searchLower = searchQuery.toLowerCase();
    return (
      patient.first_name?.toLowerCase().includes(searchLower) ||
      patient.last_name?.toLowerCase().includes(searchLower) ||
      patient.medical_record_number?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Patient Management</h1>
            <p className="text-slate-600">Track and analyze patient progress over time</p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add New Patient
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add New Patient</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">First Name *</Label>
                  <Input
                    id="first_name"
                    value={newPatient.first_name}
                    onChange={(e) => setNewPatient({...newPatient, first_name: e.target.value})}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last Name *</Label>
                  <Input
                    id="last_name"
                    value={newPatient.last_name}
                    onChange={(e) => setNewPatient({...newPatient, last_name: e.target.value})}
                    placeholder="Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of Birth *</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={newPatient.date_of_birth}
                    onChange={(e) => setNewPatient({...newPatient, date_of_birth: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender</Label>
                  <Select value={newPatient.gender} onValueChange={(value) => setNewPatient({...newPatient, gender: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select gender" />
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
                  <Label htmlFor="mrn">Medical Record Number</Label>
                  <Input
                    id="mrn"
                    value={newPatient.medical_record_number}
                    onChange={(e) => setNewPatient({...newPatient, medical_record_number: e.target.value})}
                    placeholder="MRN-12345"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="diagnosis">Primary Diagnosis</Label>
                  <Input
                    id="diagnosis"
                    value={newPatient.primary_diagnosis}
                    onChange={(e) => setNewPatient({...newPatient, primary_diagnosis: e.target.value})}
                    placeholder="e.g., Dyspnea"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    value={newPatient.notes}
                    onChange={(e) => setNewPatient({...newPatient, notes: e.target.value})}
                    placeholder="Additional patient information"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleCreatePatient} disabled={!newPatient.first_name || !newPatient.last_name || !newPatient.date_of_birth}>
                  Create Patient
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <Card className="bg-white border-none shadow-lg mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <Input
                placeholder="Search by name or medical record number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Patients List */}
        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-slate-900">
              All Patients ({filteredPatients.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-slate-500">Loading patients...</div>
            ) : filteredPatients.length === 0 ? (
              <div className="text-center py-12">
                <User className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 mb-4">No patients found</p>
                <Button onClick={() => setShowAddDialog(true)}>Add First Patient</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPatients.map((patient) => (
                  <div key={patient.id} className="relative group">
                    <Link
                      to={createPageUrl(`PatientAnalysis?id=${patient.id}`)}
                      className="block"
                    >
                      <div className="p-5 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-blue-300 hover:shadow-md transition-all">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                              {patient.first_name[0]}{patient.last_name[0]}
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900">
                                {patient.first_name} {patient.last_name}
                              </h3>
                              <p className="text-sm text-slate-500">
                                Age {calculateAge(patient.date_of_birth)}
                              </p>
                            </div>
                          </div>
                        </div>
                        {patient.medical_record_number && (
                          <p className="text-xs text-slate-500 mb-2">MRN: {patient.medical_record_number}</p>
                        )}
                        {patient.primary_diagnosis && (
                          <p className="text-sm text-slate-700 mb-3">{patient.primary_diagnosis}</p>
                        )}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <TrendingUp className="w-4 h-4" />
                            <span>{getPatientVisitCount(patient.id)} visits</span>
                          </div>
                          <span className="text-xs text-slate-400">
                            Added {format(new Date(patient.created_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                      </div>
                    </Link>
                    {/* Delete Button */}
                    <Button
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteConfirmDialog({ open: true, patient });
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmDialog.open} onOpenChange={(open) => setDeleteConfirmDialog({ open, patient: null })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Patient</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete {deleteConfirmDialog.patient?.first_name} {deleteConfirmDialog.patient?.last_name}?
                This will permanently delete the patient and all associated visit records ({getPatientVisitCount(deleteConfirmDialog.patient?.id || '')} visits).
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setDeleteConfirmDialog({ open: false, patient: null })}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDeletePatient}
                disabled={deletePatientMutation.isPending}
              >
                {deletePatientMutation.isPending ? 'Deleting...' : 'Delete Patient'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}