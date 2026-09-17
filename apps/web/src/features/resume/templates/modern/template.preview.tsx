import type { ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { formatMonthYear } from '@/lib/dates';
import { formatDateRange, formatLanguageLevel, formatSkillLevel } from '../../lib/format';
import { resumeSections } from '../../lib/sections';

/**
 * Jumeau HTML du modèle Moderne (`template.pdf.tsx`) : bandeau d'en-tête en
 * deux colonnes (identité / contact) puis corps en deux colonnes (contenu
 * principal / barre latérale compétences-langues). L'ordre du **document**
 * (celui que lit un lecteur d'écran, et celui vérifié par le test de parité)
 * suit malgré tout l'ordre global de `resumeSections` — résumé puis
 * expériences puis formations avant compétences/langues — la barre latérale
 * est simplement placée après le contenu principal dans le flux, pas avant :
 * visuellement une « barre latérale » à droite, pas nécessairement à gauche.
 * Toujours clair (spec §7) : classes neutres explicites, jamais les tokens de
 * thème.
 */
export function Preview({ content }: { content: ResumeContent }) {
  const sections = resumeSections(content);
  const { identity } = content;
  const contactLines = [identity.email, identity.phone, [identity.city, identity.country].filter(Boolean).join(', ')].filter(
    (part): part is string => Boolean(part && part.trim() !== ''),
  );

  const hasMain = sections.includes('summary') || sections.includes('experiences') || sections.includes('educations');
  const hasSidebar = sections.includes('skills') || sections.includes('languages');

  return (
    <div className="w-[210mm] min-h-[297mm] bg-white font-sans text-neutral-900" style={{ colorScheme: 'light' }}>
      <header className="flex items-start justify-between gap-6 bg-neutral-900 px-[14mm] py-[10mm] text-white">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {identity.firstName} {identity.lastName}
          </h1>
          {identity.title && <p className="mt-1 text-lg text-neutral-300">{identity.title}</p>}
        </div>
        {contactLines.length > 0 && (
          <ul className="shrink-0 text-right text-xs text-neutral-300">
            {contactLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </header>

      <div className="flex">
        {hasMain && (
          <main className="flex-1 space-y-6 p-[10mm]">
            {sections.includes('summary') && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">{RESUME_SECTION_LABELS.summary}</h2>
                <p className="text-sm leading-relaxed whitespace-pre-line text-neutral-800">{content.summary}</p>
              </section>
            )}

            {sections.includes('experiences') && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
                  {RESUME_SECTION_LABELS.experiences}
                </h2>
                <ul className="space-y-4">
                  {content.experiences.map((experience) => (
                    <li key={experience.id}>
                      <p className="text-sm font-semibold text-neutral-900">{experience.role}</p>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs text-neutral-600">{experience.company}</p>
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
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
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
          </main>
        )}

        {hasSidebar && (
          <aside className="w-[65mm] shrink-0 space-y-6 border-l border-neutral-200 bg-neutral-50 p-[10mm]">
            {sections.includes('skills') && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">{RESUME_SECTION_LABELS.skills}</h2>
                <ul className="space-y-1">
                  {content.skills.map((skill) => (
                    <li key={skill.id} className="text-sm text-neutral-800">
                      {skill.name} <span className="text-xs text-neutral-500">· {formatSkillLevel(skill.level)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {sections.includes('languages') && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
                  {RESUME_SECTION_LABELS.languages}
                </h2>
                <ul className="space-y-1">
                  {content.languages.map((language) => (
                    <li key={language.id} className="text-sm text-neutral-800">
                      {language.name} <span className="text-xs text-neutral-500">· {formatLanguageLevel(language.level)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>

      {sections.includes('certifications') && (
        <section className="px-[14mm] pb-6">
          <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">{RESUME_SECTION_LABELS.certifications}</h2>
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
        <section className="px-[14mm] pb-[14mm]">
          <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">{RESUME_SECTION_LABELS.projects}</h2>
          <ul className="space-y-2">
            {content.projects.map((project) => (
              <li key={project.id}>
                <p className="text-sm font-semibold text-neutral-900">{project.name}</p>
                {project.description && <p className="text-sm text-neutral-800">{project.description}</p>}
                {project.technologies.length > 0 && <p className="text-xs text-neutral-500">{project.technologies.join(' · ')}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
