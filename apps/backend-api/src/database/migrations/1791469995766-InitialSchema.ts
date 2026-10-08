import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1791469995766 implements MigrationInterface {
  name = 'InitialSchema1791469995766';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_status_enum" AS ENUM('ONLINE', 'OFFLINE', 'BLOCKED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "active_sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_token_id" uuid, "hwid" character varying(255) NOT NULL, "ip_address" character varying(45), "client_version" character varying(20), "status" "public"."user_status_enum" NOT NULL DEFAULT 'OFFLINE', "connected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_heartbeat" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "disconnected_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8adff44cf2b22fd7ac602019bf6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_active_sessions_hwid" ON "active_sessions"  ("hwid") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_active_sessions_status" ON "active_sessions"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."token_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "token_value" character varying(64) NOT NULL, "status" "public"."token_status_enum" NOT NULL DEFAULT 'ACTIVE', "max_uses" integer NOT NULL DEFAULT '1', "current_uses" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_6f781aefa5c2901e1e1f418ff16" UNIQUE ("token_value"), CONSTRAINT "PK_63764db9d9aaa4af33e07b2f4bf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_tokens_owner" ON "user_tokens"  ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_tokens_value" ON "user_tokens"  ("token_value") `,
    );
    await queryRunner.query(
      `CREATE TABLE "owners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "full_name" character varying(100), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_df4ef717018c5dc7bd3f4ab0de5" UNIQUE ("email"), CONSTRAINT "PK_42838282f2e6b216301a70b02d6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "owner_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "token_hash" character varying(255) NOT NULL, "name" character varying(100) NOT NULL DEFAULT 'Primary Master Token', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_f40c81abfb1c1e1eb174d90f904" UNIQUE ("token_hash"), CONSTRAINT "PK_4f7d8e079342ab462afcc28883b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "session_vault" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "encrypted_payload" text NOT NULL, "checksum" character varying(64) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_bc0bdf41f4cb4e856d66085ec10" UNIQUE ("owner_id"), CONSTRAINT "REL_bc0bdf41f4cb4e856d66085ec1" UNIQUE ("owner_id"), CONSTRAINT "PK_40786539b4fe6272d4805204e18" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "active_sessions" ADD CONSTRAINT "FK_91dd5599687322e7e974d53efd5" FOREIGN KEY ("user_token_id") REFERENCES "user_tokens"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" ADD CONSTRAINT "FK_206e51926e3bce68ccfa904f7d9" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "owner_tokens" ADD CONSTRAINT "FK_4838c148076de2844ebc8175eb5" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_vault" ADD CONSTRAINT "FK_bc0bdf41f4cb4e856d66085ec10" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_vault" DROP CONSTRAINT "FK_bc0bdf41f4cb4e856d66085ec10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "owner_tokens" DROP CONSTRAINT "FK_4838c148076de2844ebc8175eb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" DROP CONSTRAINT "FK_206e51926e3bce68ccfa904f7d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "active_sessions" DROP CONSTRAINT "FK_91dd5599687322e7e974d53efd5"`,
    );
    await queryRunner.query(`DROP TABLE "session_vault"`);
    await queryRunner.query(`DROP TABLE "owner_tokens"`);
    await queryRunner.query(`DROP TABLE "owners"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_tokens_value"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_tokens_owner"`);
    await queryRunner.query(`DROP TABLE "user_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."token_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_active_sessions_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_active_sessions_hwid"`);
    await queryRunner.query(`DROP TABLE "active_sessions"`);
    await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
  }
}
