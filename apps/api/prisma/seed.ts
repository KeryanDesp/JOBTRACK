import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../src/modules/auth/argon2.options';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('DemoJobTrack2026!', ARGON2_OPTIONS);

  // Le profil de démo est recréé de zéro à chaque seed : toute modification
  // faite à la main sur ce compte est perdue. C'est voulu pour une fixture.
  await prisma.user.deleteMany({ where: { email: 'demo@jobtrack.local' } });

  await prisma.user.create({
    data: {
      email: 'demo@jobtrack.local',
      passwordHash,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: 'Camille',
          lastName: 'Démo',
          title: 'Développeuse Full Stack (profil de démonstration)',
          summary:
            'Profil fictif servant au développement local de JobTrack. Aucune de ces données ne décrit une personne réelle.',
          city: 'Metz',
          country: 'France',
          yearsExperience: 3,
          preferences: {
            create: {
              desiredRoles: ['Développeur Full Stack', 'Business Analyst'],
              desiredCategories: ['Développement', 'Data'],
              salaryMin: 45000,
              salaryMax: 60000,
              locations: ['Metz', 'Nancy', 'Luxembourg'],
              searchRadiusKm: 50,
              remoteModes: ['HYBRID', 'REMOTE'],
              contractTypes: ['CDI'],
              experienceLevel: 'MID',
            },
          },
          experiences: {
            create: [
              {
                company: 'Entreprise Exemple',
                role: 'Développeuse Full Stack',
                location: 'Metz',
                startDate: new Date('2023-09-01'),
                isCurrent: true,
                description: 'Expérience fictive de démonstration.',
                sortOrder: 0,
              },
            ],
          },
          educations: {
            create: [
              {
                school: 'École Exemple',
                degree: 'Master Informatique',
                field: 'Génie logiciel',
                startDate: new Date('2021-09-01'),
                endDate: new Date('2023-06-30'),
                sortOrder: 0,
              },
            ],
          },
          skills: {
            create: [
              { name: 'React', category: 'TECHNICAL', level: 'ADVANCED', sortOrder: 0 },
              { name: 'TypeScript', category: 'TECHNICAL', level: 'ADVANCED', sortOrder: 1 },
              { name: 'PostgreSQL', category: 'TECHNICAL', level: 'INTERMEDIATE', sortOrder: 2 },
            ],
          },
          languages: {
            create: [
              { name: 'Français', level: 'NATIVE', sortOrder: 0 },
              { name: 'Anglais', level: 'C1', sortOrder: 1 },
            ],
          },
        },
      },
    },
  });

  console.log('Seed terminé — compte de démonstration : demo@jobtrack.local');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
