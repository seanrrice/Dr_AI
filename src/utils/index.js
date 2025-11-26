import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Create page URL for navigation
export const createPageUrl = (page) => {
  if (page.startsWith('/')) {
    return page;
  }

  const [pageName, queryString] = page.split('?');

  const routeMap = {
    'Dashboard': '/dashboard',
    'Patients': '/patients',
    'NewVisit': '/new-visit',
    'VisitDetails': '/visit-details',
    'PatientAnalysis': '/patient-analysis',
    'Login': '/login'
  };

  const basePath = routeMap[pageName] || `/${pageName.toLowerCase()}`;
  return queryString ? `${basePath}?${queryString}` : basePath;
};
