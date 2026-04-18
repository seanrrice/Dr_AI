import {
  demoAiAssessment2,
  demoTranscriptionNlp2,
  demoVisitSnapshot2,
  DEMO_REPORT_VISIT_ID_2,
  DEMO_REPORT_PATIENT_ID_2,
} from '@/data/reportSummaryDemoData';
import { buildMichaelSerialStorageVisits } from '@/data/michaelSerialVisitStorageSeeds';

const STORAGE_KEYS = {
  PATIENTS: 'smart_exam_room_patients',
  VISITS: 'smart_exam_room_visits'
};

// Load data from localStorage
const loadFromStorage = (key) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return [];
  }
};

// Save data to localStorage
const saveToStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
};

// Initialize data
let patients = loadFromStorage(STORAGE_KEYS.PATIENTS);
let visits = loadFromStorage(STORAGE_KEYS.VISITS);

// Generate unique ID
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const DATE_SORT_FIELDS = new Set(['visit_date', 'created_date', 'updated_date']);

// Helper to sort array (dates compared as time so ordering is correct across patients)
const sortArray = (array, sortField) => {
  if (!sortField) return array;

  const descending = sortField.startsWith('-');
  const field = descending ? sortField.slice(1) : sortField;

  return [...array].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    if (DATE_SORT_FIELDS.has(field) && aVal != null && bVal != null) {
      const at = new Date(aVal).getTime();
      const bt = new Date(bVal).getTime();
      if (!Number.isNaN(at) && !Number.isNaN(bt)) {
        return descending ? bt - at : at - bt;
      }
    }
    if (descending) {
      return bVal > aVal ? 1 : -1;
    }
    return aVal > bVal ? 1 : -1;
  });
};

export const api = {
  entities: {
    Patient: {
      list: async (sortOrder = '-created_date') => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return sortArray(patients, sortOrder);
      },
      
      filter: async (criteria) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return patients.filter(patient => {
          return Object.entries(criteria).every(([key, value]) => {
            return patient[key] === value;
          });
        });
      },
      
      create: async (data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        const newPatient = {
          ...data,
          id: generateId(),
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString()
        };
        patients.push(newPatient);
        saveToStorage(STORAGE_KEYS.PATIENTS, patients);
        return newPatient;
      },
      
      update: async (id, data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        const index = patients.findIndex(p => p.id === id);
        if (index !== -1) {
          patients[index] = {
            ...patients[index],
            ...data,
            updated_date: new Date().toISOString()
          };
          saveToStorage(STORAGE_KEYS.PATIENTS, patients);
          return patients[index];
        }
        throw new Error('Patient not found');
      },
      
      delete: async (id) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        patients = patients.filter(p => p.id !== id);
        saveToStorage(STORAGE_KEYS.PATIENTS, patients);
        return { success: true };
      }
    },
    
    Visit: {
      list: async (sortOrder = '-visit_date', limit) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        let sorted = sortArray(visits, sortOrder);
        if (limit) {
          sorted = sorted.slice(0, limit);
        }
        return sorted;
      },
      
      filter: async (criteria, sortOrder) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        let filtered = visits.filter(visit => {
          return Object.entries(criteria).every(([key, value]) => {
            return visit[key] === value;
          });
        });
        if (sortOrder) {
          filtered = sortArray(filtered, sortOrder);
        }
        return filtered;
      },
      
      create: async (data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        const newVisit = {
          ...data,
          id: generateId(),
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString()
        };
        visits.push(newVisit);
        saveToStorage(STORAGE_KEYS.VISITS, visits);
        return newVisit;
      },
      
      update: async (id, data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        const index = visits.findIndex(v => v.id === id);
        if (index !== -1) {
          visits[index] = {
            ...visits[index],
            ...data,
            updated_date: new Date().toISOString()
          };
          saveToStorage(STORAGE_KEYS.VISITS, visits);
          return visits[index];
        }
        throw new Error('Visit not found');
      },
      
      delete: async (id) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        visits = visits.filter(v => v.id !== id);
        saveToStorage(STORAGE_KEYS.VISITS, visits);
        return { success: true };
      }
    }
  },
  
  // clear all data
  clearAllData: () => {
    patients = [];
    visits = [];
    localStorage.removeItem(STORAGE_KEYS.PATIENTS);
    localStorage.removeItem(STORAGE_KEYS.VISITS);
  }
};

/** Seeded demo patients — same ids as `reportSummaryDemoData` for report wiring. */
const SEED_PATIENT_DEMO_1 = {
  id: 'patient-demo-1',
  first_name: 'Elena',
  last_name: 'Brooks',
  date_of_birth: '1974-09-21',
  gender: 'female',
  medical_record_number: 'MRN-RS-2048',
  primary_diagnosis: 'Exertional shortness of breath under treatment (improving)',
  created_date: '2025-01-15T10:00:00Z',
  updated_date: '2025-01-15T10:00:00Z',
};

const SEED_PATIENT_DEMO_2 = {
  id: DEMO_REPORT_PATIENT_ID_2,
  first_name: 'Sarah',
  last_name: 'Martinez',
  date_of_birth: '1986-04-10',
  gender: 'female',
  medical_record_number: 'MRN-12345',
  primary_diagnosis: 'Fibromyalgia syndrome (working diagnosis)',
  created_date: '2025-10-01T10:00:00Z',
  updated_date: '2025-10-01T10:00:00Z',
};

/** Four visits for the breathing-recovery demo patient — ids and vitals match `demoSerialVisitSnapshots`. */
const MICHAEL_SERIAL_VISITS_SEED = buildMichaelSerialStorageVisits();

const snap2 = demoVisitSnapshot2;
const nlp2 = demoTranscriptionNlp2;

const SEED_VISIT_DEMO_2 = {
  id: DEMO_REPORT_VISIT_ID_2,
  patient_id: DEMO_REPORT_PATIENT_ID_2,
  visit_number: 1,
  visit_date: snap2.visit_date,
  chief_complaint: snap2.chief_complaint,
  bp_systolic: snap2.bp_systolic,
  bp_diastolic: snap2.bp_diastolic,
  heart_rate: snap2.heart_rate,
  respiratory_rate: snap2.respiratory_rate,
  temperature: snap2.temperature,
  temperature_unit: snap2.temperature_unit,
  spo2: snap2.spo2,
  height: snap2.height,
  weight: snap2.weight,
  bmi: snap2.bmi,
  transcription: nlp2.transcription,
  physician_notes: nlp2.physician_notes,
  keyword_analysis: nlp2.keyword_analysis,
  sentiment_analysis: nlp2.sentiment_analysis,
  semantic_analysis: nlp2.semantic_analysis,
  ai_assessment: demoAiAssessment2,
  created_date: '2025-10-29T15:00:00Z',
  updated_date: '2025-10-29T15:00:00Z',
};

const SEED_PATIENTS = [SEED_PATIENT_DEMO_1, SEED_PATIENT_DEMO_2];
const SEED_VISITS = [...MICHAEL_SERIAL_VISITS_SEED, SEED_VISIT_DEMO_2];

/**
 * Removes extra local rows for the seeded Sarah demo (same chief complaint, wrong id),
 * e.g. duplicate Oct 28 + Oct 29 visits both tied to patient-demo-2 from earlier test data.
 * Keeps the canonical visit-demo-2 row only for that complaint.
 */
function dedupeSeededSarahPainVisits() {
  const canonId = DEMO_REPORT_VISIT_ID_2;
  const complaint = SEED_VISIT_DEMO_2.chief_complaint;
  const dupes = visits.filter(
    (v) =>
      v.patient_id === DEMO_REPORT_PATIENT_ID_2 &&
      v.id !== canonId &&
      v.chief_complaint === complaint
  );
  if (dupes.length === 0) return false;
  const drop = new Set(dupes.map((v) => v.id));
  visits = visits.filter((v) => !drop.has(v.id));
  return true;
}

/**
 * Fix or insert canonical demo rows if ids exist but point at the wrong patient or stale fields
 * (e.g. visit-demo-1 was overwritten so both rows show Sarah).
 */
function healCanonicalDemoRows() {
  let changed = false;

  const healPatient = (seed) => {
    const idx = patients.findIndex((p) => p.id === seed.id);
    if (idx === -1) {
      patients.push({ ...seed });
      changed = true;
      return;
    }
    const cur = patients[idx];
    if (cur.first_name !== seed.first_name || cur.last_name !== seed.last_name || cur.medical_record_number !== seed.medical_record_number) {
      patients[idx] = { ...seed };
      changed = true;
    }
  };

  const healVisit = (seed) => {
    const idx = visits.findIndex((v) => v.id === seed.id);
    if (idx === -1) {
      visits.push({ ...seed });
      changed = true;
      return;
    }
    const cur = visits[idx];
    const needsRewrite =
      cur.patient_id !== seed.patient_id ||
      cur.chief_complaint !== seed.chief_complaint ||
      cur.visit_date !== seed.visit_date ||
      cur.transcription !== seed.transcription ||
      JSON.stringify(cur.keyword_analysis || {}) !== JSON.stringify(seed.keyword_analysis || {}) ||
      JSON.stringify(cur.sentiment_analysis || {}) !== JSON.stringify(seed.sentiment_analysis || {}) ||
      JSON.stringify(cur.semantic_analysis || {}) !== JSON.stringify(seed.semantic_analysis || {});

    if (needsRewrite) {
      visits[idx] = { ...seed };
      changed = true;
    }
  };

  healPatient(SEED_PATIENT_DEMO_1);
  healPatient(SEED_PATIENT_DEMO_2);
  MICHAEL_SERIAL_VISITS_SEED.forEach((row) => healVisit(row));
  healVisit(SEED_VISIT_DEMO_2);
  return changed;
}

/** Merge demo rows when missing so existing browsers gain new demos without clearing storage. */
function ensureDemoSeed() {
  let changed = false;
  for (const p of SEED_PATIENTS) {
    if (!patients.some((x) => x.id === p.id)) {
      patients.push({ ...p });
      changed = true;
    }
  }
  for (const v of SEED_VISITS) {
    if (!visits.some((x) => x.id === v.id)) {
      visits.push({ ...v });
      changed = true;
    }
  }
  if (healCanonicalDemoRows()) {
    changed = true;
  }
  if (dedupeSeededSarahPainVisits()) {
    changed = true;
  }
  if (changed) {
    saveToStorage(STORAGE_KEYS.PATIENTS, patients);
    saveToStorage(STORAGE_KEYS.VISITS, visits);
  }
}

ensureDemoSeed();