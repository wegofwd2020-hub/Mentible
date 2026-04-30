export interface Level {
  value: string;
  label: string;
  description: string;
}

export const LEVELS: Level[] = [
  {
    value: "student",
    label: "Student",
    description: "Grade 12",
  },
  {
    value: "professional",
    label: "Professional",
    description: "Working professional",
  },
  {
    value: "expert",
    label: "Expert",
    description: "Deep specialist",
  },
];

export const DEFAULT_LEVEL = "student";
