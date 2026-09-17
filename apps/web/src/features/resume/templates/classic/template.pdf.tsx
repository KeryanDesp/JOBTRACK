import type { ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatMonthYear } from '@/lib/dates';
import { formatDateRange, formatLanguageLevel, formatSkillLevel } from '../../lib/format';
import { resumeSections } from '../../lib/sections';

/**
 * Ce module est le seul point d'entrée de `@react-pdf/renderer` pour le
 * modèle Classique — il n'est jamais importé statiquement (`templates.ts` le
 * charge via `import()` dans `loadPdf`), pour que la bibliothèque (~500 ko)
 * ne pèse jamais sur le bundle initial (spec §7).
 */
const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 40, fontFamily: 'Times-Roman', fontSize: 10, color: '#171717' },
  header: { borderBottomWidth: 1, borderBottomColor: '#d4d4d4', paddingBottom: 12, marginBottom: 16 },
  name: { fontSize: 20, fontFamily: 'Times-Bold' },
  jobTitle: { fontSize: 12, color: '#404040', marginTop: 2 },
  contact: { fontSize: 9, color: '#525252', marginTop: 4 },
  section: { marginBottom: 14 },
  heading: {
    fontSize: 9,
    fontFamily: 'Times-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#737373',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    paddingBottom: 4,
    marginBottom: 8,
  },
  paragraph: { fontSize: 10, lineHeight: 1.4, color: '#262626' },
  entry: { marginBottom: 8 },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  entryTitle: { fontSize: 10, fontFamily: 'Times-Bold' },
  entrySubtitle: { fontSize: 10, color: '#525252' },
  entryDate: { fontSize: 9, color: '#737373' },
  entryLocation: { fontSize: 9, color: '#737373', marginBottom: 2 },
  bullet: { flexDirection: 'row', marginTop: 2 },
  bulletMark: { fontSize: 10, marginRight: 4, color: '#262626' },
  bulletText: { fontSize: 10, color: '#262626', flex: 1 },
  inlineList: { fontSize: 10, color: '#262626' },
  footer: { position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#a3a3a3' },
});

export function Pdf({ content }: { content: ResumeContent }) {
  const sections = resumeSections(content);
  const { identity } = content;
  const contactLine = [identity.email, identity.phone, [identity.city, identity.country].filter(Boolean).join(', ')]
    .filter((part): part is string => Boolean(part && part.trim() !== ''))
    .join('   ·   ');

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.name}>
            {identity.firstName} {identity.lastName}
          </Text>
          {identity.title && <Text style={styles.jobTitle}>{identity.title}</Text>}
          {contactLine !== '' && <Text style={styles.contact}>{contactLine}</Text>}
        </View>

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
                <View style={styles.entryRow}>
                  <Text style={styles.entryTitle}>
                    {experience.role} <Text style={styles.entrySubtitle}>— {experience.company}</Text>
                  </Text>
                  <Text style={styles.entryDate}>{formatDateRange(experience.startDate, experience.endDate, experience.isCurrent)}</Text>
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

        {sections.includes('skills') && (
          <View style={styles.section}>
            <Text style={styles.heading}>{RESUME_SECTION_LABELS.skills}</Text>
            <Text style={styles.inlineList}>
              {content.skills.map((skill, index) => `${index > 0 ? '   ·   ' : ''}${skill.name} (${formatSkillLevel(skill.level)})`).join('')}
            </Text>
          </View>
        )}

        {sections.includes('languages') && (
          <View style={styles.section}>
            <Text style={styles.heading}>{RESUME_SECTION_LABELS.languages}</Text>
            <Text style={styles.inlineList}>
              {content.languages
                .map((language, index) => `${index > 0 ? '   ·   ' : ''}${language.name} (${formatLanguageLevel(language.level)})`)
                .join('')}
            </Text>
          </View>
        )}

        {sections.includes('certifications') && (
          <View style={styles.section} wrap>
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
          <View style={styles.section} wrap>
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
