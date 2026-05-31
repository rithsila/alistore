import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260531123948 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "stock_movement" ("id" text not null, "variant_id" text not null, "type" text check ("type" in ('in', 'out', 'adjust')) not null, "quantity" integer not null, "reason" text not null, "order_id" text null, "created_by" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stock_movement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stock_movement_deleted_at" ON "stock_movement" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "stock_movement" cascade;`);
  }

}
