/**
 * Where the assessment editor and gradebook talk to the API. Admins use /admin/…; a speaker
 * teaching the course uses the same screens under /speaker/courses/:courseId/…, where every id
 * is checked against that course.
 */
export interface AssessmentEndpoints {
  list: string;
  order: string;
  gradebookCsv: string;
  one: (id: string) => string;
  submissions: (id: string) => string;
  submission: (id: string) => string;
  file: (id: string) => string;
  grade: (id: string) => string;
}

export function adminAssessmentEndpoints(courseId: string): AssessmentEndpoints {
  return {
    list: `/admin/courses/${courseId}/assessments`,
    order: `/admin/courses/${courseId}/assessments/order`,
    gradebookCsv: `/admin/courses/${courseId}/gradebook.csv`,
    one: (id) => `/admin/assessments/${id}`,
    submissions: (id) => `/admin/assessments/${id}/submissions`,
    submission: (id) => `/admin/submissions/${id}`,
    file: (id) => `/admin/submissions/${id}/file`,
    grade: (id) => `/admin/submissions/${id}/grade`,
  };
}

/** The speaker portal: everything under one course. */
export function speakerAssessmentEndpoints(courseId: string): AssessmentEndpoints {
  const base = `/teach/courses/${courseId}`;
  return {
    list: `${base}/assessments`,
    order: `${base}/assessments/order`,
    gradebookCsv: `${base}/gradebook.csv`,
    one: (id) => `${base}/assessments/${id}`,
    submissions: (id) => `${base}/assessments/${id}/submissions`,
    submission: (id) => `${base}/submissions/${id}`,
    file: (id) => `${base}/submissions/${id}/file`,
    grade: (id) => `${base}/submissions/${id}/grade`,
  };
}
