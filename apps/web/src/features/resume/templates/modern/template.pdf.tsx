import type { ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatMonthYear } from '@/lib/dates';
import { formatDateRange, formatLanguageLevel, formatSkillLevel } from '../../lib/format';
import { resumeSections } from '../../lib/sections';

/**
 * Seul point d'entrée de `@react-pdf/renderer` pour le modèle Moderne, chargé
 * paresseusement (voir `template.pdf.tsx` du modèle Classique pour le détail
 * du raisonnement, identique ici).
 */
const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, color: '#171717' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#171717',
    color: '#ffffff',
    paddingHorizontal: 40,
    paddingVertical: 28,
  },
  name: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  jobTitle: { fontSize: 13, color: '#d4d4d4', marginTop: 2 },
  contact: { fontSize: 9, color: '#d4d4d4', textAlign: 'right' },
  body: { flexDirection: 'row' },
  main: { flex: 1, paddingHorizontal: 24, paddingVertical: 20 },
  sidebar: { width: 170, backgroundColor: '#fafafa', paddingHorizontal: 20, paddingVertical: 20, borderLeftWidth: 1, borderLeftColor: '#e5e5e5' },
  fullWidth: { paddingHorizontal: 40, paddingBottom: 16 },
  section: { marginBottom: 14 },
  heading: { fontSize: 9, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1, color: '#737373', marginBottom: 8 },
  paragraph: { fontSize: 10, lineHeight: 1.4, color: '#262626' },
  entry: { marginBottom: 8 },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  entryTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  entrySubtitle: { fontSize: 9, color: '#525252' },
  entryDate: { fontSize: 9, color: '#737373' },
  entryLocation: { fontSize: 9, color: '#737373', marginBottom: 2 },
  bullet: { flexDirection: 'row', marginTop: 2 },
  bulletMark: { fontSize: 10, marginRight: 4, color: '#262626' },
  bulletText: { fontSize: 10, color: '#262626', flex: 1 },
  sidebarItem: { fontSize: 10, color: '#262626', marginBottom: 4 },
  sidebarMeta: { fontSize: 8, color: '#737373' },
  footer: { position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#a3a3a3' },
});

export function Pdf({ content }: { content: ResumeContent }) {
  const sections = resumeSections(content);
  const { identity } = content;
  const contactLines = [identity.email, identity.phone, [identity.city, identity.country].filter(Boolean).join(', ')].filter(
    (part): part is string => Boolean(part && part.trim() !== ''),
  );

  const hasMain = sections.includes('summary') || sections.includes('experiences') || sections.includes('educations');
  const hasSidebar = sections.includes('skills') || sections.includes('languages');

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.name}>
              {identity.firstName} {identity.lastName}
            </Text>
            {identity.title && <Text style={styles.jobTitle}>{identity.title}</Text>}
          </View>
          {contactLines.length > 0 && (
            <View>
              {contactLines.map((line) => (
                <Text key={line} style={styles.contact}>
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.body}>
          {hasMain && (
            <View style={styles.main}>
              {sections.includes('summary') && (
                <View style={styles.section}>
                  <Text style={styles.heading}>{RESUME_SECTION_LABELS.summary}</Text>
                  <Text style={styles.paragraph}>{content.summary}</Text>
                </View>
              )}

              {sections.includes('experiences') && (
                <View style={styles.section} wrap>
                  <Text style={styles.heading}>{RESUME_SECTION_LABELS.experiences}</Text>
                  {content.experiences.map((experience) => (
                    <View key={experience.id} style={styles.entry} wrap={false}>
                      <Text style={styles.entryTitle}>{experience.role}</Text>
                      <View style={styles.entryRow}>
                        <Text style={styles.entrySubtitle}>{experience.company}</Text>
                        <Text style={styles.entryDate}>
                          {formatDateRange(experience.startDate, experience.endDate, experience.isCurrent)}
                        </Text>
                      </View>
                      {experience.location && <Text style={styles.entryLocation}>{experience.location}</Text>}
                      {experience.highlights.map((highlight, index) => (
                        <View key={index} style={styles.bullet}>
                          <Text style={styles.bulletMark}>•</Text>
                          <Text style={styles.bulletText}>{highlight}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}

              {sections.includes('educations') && (
                <View style={styles.section} wrap>
                  <Text style={styles.heading}>{RESUME_SECTION_LABELS.educations}</Text>
                  {content.educations.map((education) => (
                    <View key={education.id} style={styles.entryRow} wrap={false}>
                      <Text style={styles.entryTitle}>
                        {education.degree}
                        {education.field ? ` — ${education.field}` : ''} <Text style={styles.entrySubtitle}>· {education.school}</Text>
                      </Text>
                      <Text style={styles.entryDate}>{formatDateRange(education.startDate, education.endDate)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {hasSidebar && (
            <View style={styles.sidebar}>
              {sections.includes('skills') && (
                <View style={styles.section}>
                  <Text style={styles.heading}>{RESUME_SECTION_LABELS.skills}</Text>
                  {content.skills.map((skill) => (
                    <Text key={skill.id} style={styles.sidebarItem}>
                      {skill.name} <Text style={styles.sidebarMeta}>· {formatSkillLevel(skill.level)}</Text>
                    </Text>
                  ))}
                </View>
              )}

              {sections.includes('languages') && (
                <View style={styles.section}>
                  <Text style={styles.heading}>{RESUME_SECTION_LABELS.languages}</Text>
                  {content.languages.map((language) => (
                    <Text key={language.id} style={styles.sidebarItem}>
                      {language.name} <Text style={styles.sidebarMeta}>· {formatLanguageLevel(language.level)}</Text>
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {sections.includes('certifications') && (
          <View style={[styles.fullWidth, styles.section]} wrap>
            <Text style={styles.heading}>{RESUME_SECTION_LABELS.certifications}</Text>
            {content.certifications.map((certification) => (
              <View key={certification.id} style={styles.entryRow} wrap={false}>
                <Text style={styles.entryTitle}>
                  {certification.name} <Text style={styles.entrySubtitle}>· {certification.issuer}</Text>
                </Text>
                {certification.issuedAt && <Text style={styles.entryDate}>{formatMonthYear(certification.issuedAt)}</Text>}
              </View>
            ))}
          </View>
        )}

        {sections.includes('projects') && (
          <View style={styles.fullWidth} wrap>
            <Text style={styles.heading}>{RESUME_SECTION_LABELS.projects}</Text>
            {content.projects.map((project) => (
              <View key={project.id} style={styles.entry} wrap={false}>
                <Text style={styles.entryTitle}>{project.name}</Text>
                {project.description && <Text style={styles.paragraph}>{project.description}</Text>}
                {project.technologies.length > 0 && <Text style={styles.entryDate}>{project.technologies.join(' · ')}</Text>}
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
