import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
// Date calendaire au format AAAA-MM-JJ uniquement : les colonnes sont en @db.Date,
// et accepter un datetime avec fuseau réintroduirait l'ambiguïté « quel minuit ».
const isoDate = z.string().date('Date invalide (AAAA-MM-JJ attendu).');

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
  lastName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
  phone: optionalText(30),
  city: optionalText(80),
  country: optionalText(80),
  title: optionalText(120),
  summary: optionalText(2000),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
});

export const jobPreferencesSchema = z.object({
  desiredRoles: z.array(z.string().trim().min(1)).max(10),
  desiredCategories: z.array(z.string().trim().min(1)).max(10),
  salaryMin: z.coerce.number().int().min(0).max(1_000_000).optional(),
  salaryMax: z.coerce.number().int().min(0).max(1_000_000).optional(),
  currency: z.string().length(3).default('EUR'),
  locations: z.array(z.string().trim().min(1)).max(10),
  searchRadiusKm: z.coerce.number().int().min(0).max(500).default(25),
  remoteModes: z.array(z.enum(['ONSITE', 'HYBRID', 'REMOTE'])),
  contractTypes: z.array(
    z.enum(['CDI', 'CDD', 'INTERNSHIP', 'APPRENTICESHIP', 'FREELANCE', 'PART_TIME']),
  ),
  availability: optionalText(80),
  experienceLevel: z.enum(['STUDENT', 'JUNIOR', 'MID', 'SENIOR', 'LEAD']).optional(),
});

export const experienceSchema = z
  .object({
    company: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    role: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    location: optionalText(120),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    isCurrent: z.boolean().default(false),
    description: optionalText(2000),
  })
  .refine((value) => value.isCurrent || value.endDate, {
    message: 'Indiquez une date de fin ou cochez « poste actuel ».',
    path: ['endDate'],
  });

export const educationSchema = z.object({
  school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  field: optionalText(120),
  startDate: isoDate,
  endDate: isoDate.optional().nullable(),
  description: optionalText(2000),
});

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  category: z.enum(['TECHNICAL', 'SOFT', 'TOOL', 'OTHER']).default('TECHNICAL'),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('INTERMEDIATE'),
});

export const languageSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']),
});

export const certificationSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuedAt: isoDate,
  expiresAt: isoDate.optional().nullable(),
  credentialUrl: z.string().url('URL invalide.').optional().or(z.literal('')),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: z.string().url('URL invalide.').optional().or(z.literal('')),
  technologies: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const reorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type JobPreferencesInput = z.infer<typeof jobPreferencesSchema>;
export type ExperienceInput = z.infer<typeof experienceSchema>;
export type EducationInput = z.infer<typeof educationSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type LanguageInput = z.infer<typeof languageSchema>;
export type CertificationInput = z.infer<typeof certificationSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
