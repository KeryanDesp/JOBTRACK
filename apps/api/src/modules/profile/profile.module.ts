import { Module } from '@nestjs/common';
import { ProfileCollectionService } from './collection.service';
import { CertificationsController } from './collections/certifications.controller';
import { EducationsController } from './collections/educations.controller';
import { ExperiencesController } from './collections/experiences.controller';
import { LanguagesController } from './collections/languages.controller';
import { ProjectsController } from './collections/projects.controller';
import { SkillsController } from './collections/skills.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [
    ProfileController,
    ExperiencesController,
    EducationsController,
    SkillsController,
    LanguagesController,
    CertificationsController,
    ProjectsController,
  ],
  providers: [ProfileService, ProfileCollectionService],
  exports: [ProfileService],
})
export class ProfileModule {}
