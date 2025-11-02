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

// Helper to sort array
const sortArray = (array, sortField) => {
  if (!sortField) return array;
  
  const descending = sortField.startsWith('-');
  const field = descending ? sortField.slice(1) : sortField;
  
  return [...array].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
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

// Initialize with demo data if empty
const initializeDemoData = () => {
  if (patients.length === 0) {
    const demoPatient = {
      id: 'patient-demo-1',
      first_name: 'Sarah',
      last_name: 'Martinez',
      date_of_birth: '1985-06-15',
      gender: 'female',
      medical_record_number: 'MRN-12345',
      primary_diagnosis: 'Fibromyalgia',
      created_date: '2025-01-15T10:00:00Z',
      updated_date: '2025-01-15T10:00:00Z'
    };
    patients.push(demoPatient);
    saveToStorage(STORAGE_KEYS.PATIENTS, patients);
  }
  
  if (visits.length === 0) {
    const demoVisit = {
      id: 'visit-demo-1',
      patient_id: 'patient-demo-1',
      visit_number: 1,
      visit_date: '2025-10-30',
      chief_complaint: 'Pain all over entire body',
      transcription: 'I have pain all over my body - my joints ache, muscles are sore and stiff. Severe headache and nausea. I\'m dizzy when standing. Extreme fatigue and weakness. Can\'t sleep at night. My stomach hurts and I feel bloated. Everything aches and hurts constantly.',
      physician_notes: '',
      keyword_analysis: {
        total_words: 48,
        diagnostic_keywords: {
          pain: 5,
          fatigue: 2,
          weakness: 2,
          nausea: 1,
          dizzy: 1,
          sleep: 1,
          headache: 1,
          joints: 1,
          muscles: 1,
          sore: 1,
          stiff: 1,
          stomach: 1,
          hurts: 2,
          bloated: 1
        },
        keyword_percentage: 27.1,
        top_keywords: [
          { word: 'pain', count: 5, category: 'MUSCULOSKELETAL' },
          { word: 'fatigue', count: 2, category: 'CONSTITUTIONAL' },
          { word: 'weakness', count: 2, category: 'CONSTITUTIONAL' },
          { word: 'nausea', count: 1, category: 'GASTROINTESTINAL' }
        ]
      },
      sentiment_analysis: {
        overall_sentiment: 'negative',
        sentiment_score: -0.85,
        distress_level: 'high',
        emotional_indicators: ['pain', 'fatigue', 'nausea', 'dizziness', 'discomfort', 'soreness', 'insomnia']
      },
      semantic_analysis: {
        key_themes: ['widespread pain', 'fatigue', 'nausea', 'sleep disturbances', 'gastrointestinal issues', 'dizziness'],
        symptom_severity: 'severe',
        functional_impact: 'severe',
        temporal_patterns: 'chronic'
      },
      ai_assessment: {
        suggested_diagnoses: ['Fibromyalgia', 'Chronic Fatigue Syndrome (CFS)', 'Rheumatoid Arthritis'],
        recommended_tests: [
          'Complete Blood Count (CBC)',
          'Thyroid Function Tests (TFTs)',
          'Erythrocyte Sedimentation Rate (ESR)',
          'Comprehensive Metabolic Panel (CMP)',
          'Autoantibody testing (ANA, rheumatoid factor)'
        ],
        treatment_suggestions: [
          'Cognitive Behavioral Therapy (CBT)',
          'Low-dose antidepressants (e.g., amitriptyline)',
          'Physical therapy',
          'Medications for pain management (e.g., NSAIDs, gabapentin)',
          'Lifestyle modifications (diet, exercise)'
        ],
        follow_up_recommendations: 'Schedule a follow-up appointment in 4-6 weeks to evaluate response to treatment and reassess symptoms.'
      },
      created_date: '2025-10-30T14:30:00Z',
      updated_date: '2025-10-30T14:30:00Z'
    };
    visits.push(demoVisit);
    saveToStorage(STORAGE_KEYS.VISITS, visits);
  }
};

initializeDemoData();