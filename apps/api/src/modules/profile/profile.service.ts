import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobPreferencesInput, ProfileInput } from '@jobtrack/shared';
import type { JobPreferences, Profile } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Résout le profil de l'utilisateur courant. Toute opération sur une ressource de profil part d'ici : c'est ce qui garantit l'isolation. */
  async resolveProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw this.notFound();
    return profile.id;
  }

  async get(userId: string): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw this.notFound();
    return profile;
  }

  /** `null` efface un champ, une clé absente ne l'écrit pas : le schéma partagé le garantit. */
  async update(userId: string, input: ProfileInput): Promise<Profile> {
    await this.resolveProfileId(userId);
    return this.prisma.profile.update({ where: { userId }, data: input });
  }

  async getPreferences(userId: string): Promise<JobPreferences> {
    const profileId = await this.resolveProfileId(userId);
    // Créées à l'inscription, mais on reste tolérant à un profil importé.
    return this.prisma.jobPreferences.upsert({ where: { profileId }, create: { profileId }, update: {} });
  }

  async updatePreferences(userId: string, input: JobPreferencesInput): Promise<JobPreferences> {
    const profileId = await this.resolveProfileId(userId);
    // `searchRadiusKm` est un entier NOT NULL en base (défaut 25) : contrairement aux autres
    // champs numériques du schéma partagé, cette colonne n'a pas de valeur « effacée ». Une
    // chaîne vide validée par optionalNumber (générique à tous les champs numériques) produit
    // tout de même `null` ; on la traite comme une absence de changement, pas comme une erreur.
    const { searchRadiusKm, ...rest } = input;
    const data = { ...rest, searchRadiusKm: searchRadiusKm ?? undefined };
    return this.prisma.jobPreferences.upsert({ where: { profileId }, create: { ...data, profileId }, update: data });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'PROFILE_NOT_FOUND', message: 'Profil introuvable.' });
  }
}
