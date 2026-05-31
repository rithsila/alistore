import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260531123949 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "customer_social_identity" ("id" text not null, "customer_id" text not null, "provider" text not null default 'facebook', "provider_user_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_social_identity_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_social_identity_deleted_at" ON "customer_social_identity" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_social_identity" cascade;`);
  }

}
