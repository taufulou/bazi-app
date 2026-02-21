-- AlterTable
ALTER TABLE "birth_profiles" ADD COLUMN     "is_leap_month" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_lunar_date" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lunar_birth_date" TEXT;
