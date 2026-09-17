import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { LetterDocumentProps } from '../../lib/letter-templates';
import { registerPdfHyphenation } from '../../lib/pdf-hyphenation';

/**
 * Seul point d'entrée de `@react-pdf/renderer` pour la lettre — jamais importé
 * statiquement (`lib/letter-templates.ts` le charge via `import()` dans
 * `loadLetterPdf`), pour que la bibliothèque (~500 ko) ne pèse jamais sur le
 * bundle initial (spec §7).
 */
registerPdfHyphenation();

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 48, paddingHorizontal: 48, fontFamily: 'Times-Roman', fontSize: 11, color: '#171717' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 },
  senderName: { fontSize: 11 },
  senderCity: { fontSize: 11, marginTop: 2 },
  date: { fontSize: 11, color: '#404040' },
  recipientBlock: { marginBottom: 28 },
  recipientLine: { fontSize: 11 },
  subject: { fontSize: 11, fontFamily: 'Times-Bold', marginBottom: 20 },
  greeting: { fontSize: 11, marginBottom: 14 },
  paragraph: { fontSize: 11, lineHeight: 1.5, marginBottom: 12, color: '#262626' },
  closing: { fontSize: 11, marginTop: 12 },
  signature: { fontSize: 11, fontFamily: 'Times-Bold', marginTop: 6 },
});

export function Pdf({ content, senderName, senderCity, company, dateLine }: LetterDocumentProps) {
  const hasRecipientBlock = Boolean(content.recipient) || Boolean(company);

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.senderName}>{senderName}</Text>
            {senderCity && <Text style={styles.senderCity}>{senderCity}</Text>}
          </View>
          <Text style={styles.date}>{dateLine}</Text>
        </View>

        {hasRecipientBlock && (
          <View style={styles.recipientBlock}>
            {content.recipient && <Text style={styles.recipientLine}>{content.recipient}</Text>}
            {company && <Text style={styles.recipientLine}>{company}</Text>}
          </View>
        )}

        <Text style={styles.subject}>Objet : {content.subject}</Text>
        <Text style={styles.greeting}>{content.greeting}</Text>

        {content.paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}

        <Text style={styles.closing}>{content.closing}</Text>
        <Text style={styles.signature}>{content.signature}</Text>
      </Page>
    </Document>
  );
}
