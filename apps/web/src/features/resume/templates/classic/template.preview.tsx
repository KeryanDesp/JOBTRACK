import type { ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { Fragment } from 'react';
import { formatMonthYear } from '@/lib/dates';
import { formatDateRange, formatLanguageLevel, formatSkillLevel } from '../../lib/format';
import { resumeSections } from '../../lib/sections';

/**
 * Jumeau HTML du modèle Classique (`template.pdf.tsx`) : mêmes sections, même
 * ordre (`resumeSections`, testé pour parité), à l'échelle A4 réelle
 * (`210mm × 297mm`). Toujours clair (`bg-white`/`text-neutral-*` explicites,
 * jamais les tokens de thème `bg-background`/`text-foreground`) : c'est un
 * document papier, pas une surface de l'application — il ne doit jamais
 * suivre le thème sombre (spec §7).
 */
export function Preview({ content }: { content: ResumeContent }) {
  const sections = resumeSections(content);
  const { identity } = content;
  const contactLine = [identity.email, identity.phone, [identity.city, identity.country].filter(Boolean).join(', ')]
    .filter((part): part is string => Boolean(part && part.trim() !== ''))
    .join('  ·  ');

  return (
    <div
      className="w-[210mm] min-h-[297mm] bg-white p-[16mm] font-serif text-neutral-900"
      style={{ colorScheme: 'light' }}
    >
      <header className="mb-8 border-b border-neutral-300 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          {identity.firstName} {identity.lastName}
        </h1>
        {identity.title && <p className="mt-1 text-base text-neutral-700">{identity.title}</p>}
        {contactLine !== '' && <p className="mt-2 text-xs text-neutral-600">{contactLine}</p>}
        {identity.links && identity.links.length > 0 && (
          <p className="mt-1 text-xs text-neutral-600">
            {identity.links.map((link, index) => (
              <Fragment key={link.url}>
                {index > 0 && '  ·  '}
                <a href={link.url} className="underline">
                  {link.label}
                </a>
              </Fragment>
            ))}
          </p>
        )}
      </header>

      {sections.includes('summary') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.summary}
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-line text-neutral-800">{content.summary}</p>
        </section>
      )}

      {sections.includes('experiences') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.experiences}
          </h2>
          <ul className="space-y-4">
            {content.experiences.map((experience) => (
              <li key={experience.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-neutral-900">
                    {experience.role} <span className="font-normal text-neutral-600">— {experience.company}</span>
                  </p>
                  <p className="shrink-0 text-xs text-neutral-500">
                    {formatDateRange(experience.startDate, experience.endDate, experience.isCurrent)}
                  </p>
                </div>
                {experience.location && <p className="text-xs text-neutral-500">{experience.location}</p>}
                {experience.highlights.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-neutral-800">
                    {experience.highlights.map((highlight, index) => (
                      <li key={index}>{highlight}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.includes('educations') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.educations}
          </h2>
          <ul className="space-y-2">
            {content.educations.map((education) => (
              <li key={education.id} className="flex items-baseline justify-between gap-2">
                <p className="text-sm text-neutral-900">
                  <span className="font-semibold">{education.degree}</span>
                  {education.field ? ` — ${education.field}` : ''}{' '}
                  <span className="text-neutral-600">· {education.school}</span>
                </p>
                <p className="shrink-0 text-xs text-neutral-500">{formatDateRange(education.startDate, education.endDate)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.includes('skills') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.skills}
          </h2>
          <p className="text-sm text-neutral-800">
            {content.skills.map((skill, index) => (
              <Fragment key={skill.id}>
                {index > 0 && '  ·  '}
                {skill.name} <span className="text-neutral-500">({formatSkillLevel(skill.level)})</span>
              </Fragment>
            ))}
          </p>
        </section>
      )}

      {sections.includes('languages') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.languages}
          </h2>
          <p className="text-sm text-neutral-800">
            {content.languages.map((language, index) => (
              <Fragment key={language.id}>
                {index > 0 && '  ·  '}
                {language.name} <span className="text-neutral-500">({formatLanguageLevel(language.level)})</span>
              </Fragment>
            ))}
          </p>
        </section>
      )}

      {sections.includes('certifications') && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.certifications}
          </h2>
          <ul className="space-y-1">
            {content.certifications.map((certification) => (
              <li key={certification.id} className="flex items-baseline justify-between gap-2">
                <p className="text-sm text-neutral-900">
                  <span className="font-semibold">{certification.name}</span>{' '}
                  <span className="text-neutral-600">· {certification.issuer}</span>
                </p>
                {certification.issuedAt && (
                  <p className="shrink-0 text-xs text-neutral-500">{formatMonthYear(certification.issuedAt)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.includes('projects') && (
        <section>
          <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            {RESUME_SECTION_LABELS.projects}
          </h2>
          <ul className="space-y-2">
            {content.projects.map((project) => (
              <li key={project.id}>
                <p className="text-sm font-semibold text-neutral-900">{project.name}</p>
                {project.url && (
                  <a href={project.url} className="text-xs text-blue-700 underline">
                    {project.url}
                  </a>
                )}
                {project.description && <p className="text-sm text-neutral-800">{project.description}</p>}
                {project.technologies.length > 0 && (
                  <p className="text-xs text-neutral-500">{project.technologies.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
