/**
 * apiClient.js  —  Doctor AI
 *
 * All patient + visit CRUD now talks to Flask (port 5000).
 * Method signatures are identical to the old localStorage version so
 * no page components need to change.
 *
 * No hardcoded demo patient data is used.
 */

const FLASK = 'http://localhost:5000';

// ─── helpers ────────────────────────────────────────────────────────────────

async function flaskGet(path) {
  const res = await fetch(`${FLASK}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function flaskPost(path, body) {
  const res = await fetch(`${FLASK}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function flaskPatch(path, body) {
  const res = await fetch(`${FLASK}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json();
}

async function flaskDelete(path) {
  const res = await fetch(`${FLASK}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

const DATE_SORT_FIELDS = new Set(['visit_date', 'created_date', 'updated_date']);

function sortArray(array, sortField) {
  if (!sortField) return array;
  const descending = sortField.startsWith('-');
  const field = descending ? sortField.slice(1) : sortField;
  return [...array].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    if (DATE_SORT_FIELDS.has(field) && aVal != null && bVal != null) {
      const at = new Date(aVal).getTime();
      const bt = new Date(bVal).getTime();
      if (!Number.isNaN(at) && !Number.isNaN(bt)) return descending ? bt - at : at - bt;
    }
    if (descending) return bVal > aVal ? 1 : -1;
    return aVal > bVal ? 1 : -1;
  });
}

// ─── API ────────────────────────────────────────────────────────────────────

export const api = {
  entities: {
    Patient: {
      list: async (sortOrder = '-created_date') => {
        const patients = await flaskGet('/api/patients');
        return sortArray(patients, sortOrder);
      },

      filter: async (criteria) => {
        const patients = await flaskGet('/api/patients');
        return patients.filter((p) =>
          Object.entries(criteria).every(([k, v]) => p[k] === v)
        );
      },

      create: async (data) => {
        return flaskPost('/api/patients', data);
      },

      update: async (id, data) => {
        return flaskPatch(`/api/patients/${id}`, data);
      },

      delete: async (id) => {
        return flaskDelete(`/api/patients/${id}`);
      },
    },

    Visit: {
      list: async (sortOrder = '-visit_date', limit) => {
        const visits = await flaskGet('/api/visits');
        let sorted = sortArray(visits, sortOrder);
        if (limit) sorted = sorted.slice(0, limit);
        return sorted;
      },

      filter: async (criteria, sortOrder) => {
        const visits = await flaskGet('/api/visits');
        let filtered = visits.filter((v) =>
          Object.entries(criteria).every(([k, val]) => v[k] === val)
        );
        if (sortOrder) filtered = sortArray(filtered, sortOrder);
        return filtered;
      },

      create: async (data) => {
        return flaskPost('/api/visits', data);
      },

      update: async (id, data) => {
        return flaskPatch(`/api/visits/${id}`, data);
      },

      delete: async (id) => {
        return flaskDelete(`/api/visits/${id}`);
      },
    },
  },

  clearAllData: async () => {
    await flaskPost('/api/dev/clear', {});
  },
};